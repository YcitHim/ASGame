/**
 * stores/battle · 战斗状态在 UI 侧的投影（ui/stores README）
 *
 * 只做：调用 core 的 reduce、把事件流交给动画队列、维护纯表现的飘字/屏震。
 * 不写任何数值逻辑——所有数字来自 core 事件载荷。
 */
import { defineStore } from "pinia";
import { createBattleState, pollutionCapFor, reduce, validatePlayCardState, type BattleState } from "@/core/combat";
import { BUFF_DEFINITIONS } from "@/core/buffs";
import type { BuffId } from "@/core/registry/ids";
import { isCombatNode, rollEncounter } from "@/core/map";
import type { Action } from "@/core/actions";
import type { DomainEvent } from "@/core/events";
import { loadGameContent } from "@/data/load";
import { playSfx } from "@/systems/audio";
import { AnimQueue } from "@/ui/anim-queue";
import { buffMeta } from "@/ui/components/buff-meta";
import { useCodexStore } from "@/stores/codex";
import { useRunStore } from "@/stores/run";
import { useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";

/**
 * 飘字（docs/41 §3.2）：结算结果的可视化，只读事件流、不回写状态。
 *  - damage：红色 −N（敌人 / 玩家受击）
 *  - heal：绿色 +N
 *  - block：蓝色 挡N（被格挡的部分）
 *  - guard：「格挡！」（完全格挡，一点血没掉）
 *  - debuff：减益浮名（图标字 + 名称 + 层数）
 */
export type FloaterKind = "damage" | "heal" | "block" | "guard" | "debuff" | "net" | "pact";

/** 教学战斗配置（docs/42）：不挂 run 进度，敌人 / 种子固定，卡组与 HP 由教学局带着走。 */
export interface TutorialBattleConfig {
  readonly chapterId: string;
  readonly seed: number;
  readonly enemies: readonly string[];
  /** 教学用：统一覆盖敌人 HP，保证机制讲完之前它不会先死 */
  readonly enemyHp?: number;
  /** 教学局卡组 */
  readonly deck: readonly { cardId: string; upgraded: boolean }[];
  readonly hp: number;
  readonly maxHp: number;
  readonly relics: readonly string[];
}

export interface Floater {
  readonly id: number;
  readonly targetId: string;
  readonly value: number;
  readonly kind: FloaterKind;
  readonly big: boolean;
  /** 直接显示的文案（guard / debuff 用）；缺省由 kind + value 组合 */
  readonly text?: string;
}

/**
 * 重读数（docs/51 §一）：战斗高光时刻的**事件级大字**飘字。
 *
 * 常规飘字（34px 贴头顶）是信息层，一字不动；这一级是情绪层——
 * 中央偏上出现 = 余光必达。四档触发器见 onAnimEvent。
 */
export type BigFloaterTier = "wound" | "guard" | "heavy" | "finish";

export interface BigFloater {
  readonly id: number;
  readonly text: string;
  readonly tier: BigFloaterTier;
}

/**
 * 阈值**一律按相对口径**（docs/51 §一）：act1 的 20 和 act2 的 20 不是一回事。
 * 下面的绝对值只是「取严不取宽」的下限护栏，不是主口径。
 */
export const BIG_FLOATER = {
  /** 重创：玩家单次受伤 ≥ 最大 HP 的 15% */
  woundRatio: 0.15,
  /** 完全格挡：单发被全挡 ≥ 最大 HP 的 15%（且不低于 10 点） */
  guardRatio: 0.15,
  guardMin: 10,
  /** 重击：玩家单次造成 ≥ 目标最大 HP 的 30%（且不低于 12 点） */
  heavyRatio: 0.3,
  heavyMin: 12,
  /** 同屏只留一个；连续重读数至少间隔 0.4s */
  gapMs: 400,
  /** 停留 1.2s（常规飘字 0.9s） */
  holdMs: 1200,
} as const;

let actionCounter = 0;
let floaterCounter = 0;
let cardPlayedSeq = 0;
const queue = new AnimQueue();

/**
 * 蓄力释放红屏（甲方 2026-10-07）：**释放这一下**才泛红，蓄力途中不提前紧张。
 * 蓄力期间的信息由敌人意图条承担（IntentIcon：蓄力 · N 回合后释放 → 下回合释放·准备防御）。
 */
export const RELEASE_FLASH_MS = 800;
let releaseSeq = 0;

/** 错误提示的存续上限（docs/41 §2.1）：2.5 秒后自动消散，避免跨回合残留。 */
export const MESSAGE_TTL_MS = 2500;
let messageTimer: ReturnType<typeof setTimeout> | null = null;
let messageSerial = 0;

/** 玩家侧的负面状态（教学里判断"敌人给我挂了异常"）：按状态定义的极性派生，不手写清单——
 *  手写清单曾经留着已废弃的 "vulnerable"、漏了现役的 "timid"（docs/46 §2.2 合并案）。 */
function isDebuff(buffId: string): boolean {
  const def = BUFF_DEFINITIONS[buffId as BuffId];
  return def?.polarity === "affliction" || def?.polarity === "curse";
}

/**
 * 卖血飘字合并（docs/41 §4.2）：一张牌的自伤与回血要显示成一次净值变化。
 * 事件流里自伤与回血是两条事件（间隔约 140ms），所以先把自伤挂起，
 * 有回血就合并成「净 ±N」；260ms 内没有回血，就当纯代价牌报「血契 −N」。
 */
const PACT_MERGE_WINDOW_MS = 260;
let pactPending = 0;
let pactTimer: ReturnType<typeof setTimeout> | null = null;

export const useBattleStore = defineStore("battle", {
  state: () => ({
    battle: null as BattleState | null,
    /** 非空 = 当前是教学战斗（docs/42）：不写 run 进度、打完交 tutorial store 接管 */
    tutorialConfig: null as TutorialBattleConfig | null,
    /** 本场战斗对应的「职业:种子」标识；换职业/开新局时用来识别陈旧战斗并重开 */
    runKey: "",
    log: [] as DomainEvent[],
    floaters: [] as Floater[],
    /** 当前展示的重读数（同屏至多一条，docs/51 §一） */
    bigFloater: null as BigFloater | null,
    /** 蓄力链正在释放（甲方）：这一帧才泛红，蓄力途中不亮 */
    releaseFlash: null as { id: number; enemyId: string; value: number } | null,
    /** 上一条重读数的时间戳（防刷屏 0.4s）；放在 state 里 = 换局/换 store 自动归零 */
    lastBigAt: 0,
    bigFloaterSeq: 0,
    playing: false,
    message: "",
    /** 调试台最后一条回执（甲方 2026-10-08）：控制台「执行」后能立刻看到成功/失败 */
    debugFeedback: "",
    /** 提示所属回合（docs/41 §2.1）：TurnStarted 到达时按回合号清理上一回合的提示 */
    messageTurn: 0,
    /** 提示性质：error = 打牌失败等报错（会定时消散）；info = 「选择目标」等操作引导（不自动消散） */
    messageKind: "info" as "error" | "info",
    shake: 0,
    targeting: null as number | null,
    speed: 1 as 1 | 2,
    /** 打击感反馈（docs/08 §6） */
    hitUnits: [] as string[],
    dyingUnits: [] as string[],
    flipUnits: [] as string[],
    /** 被断链的敌人（docs/38 §三 C-1）：短暂显示打叉 + 「断链」 */
    brokenUnits: [] as string[],
    /** 正在前扑的敌人（docs/41 §3.1）：多段攻击逐段重播 */
    lungeUnits: [] as string[],
    /** 刚架上护盾的敌人（docs/41 §3.1）：护盾微光 */
    guardUnits: [] as string[],
    cardPlayed: null as { cardId: string; targetId: string | null; seq: number } | null,
  }),
  getters: {
    over(state): boolean {
      return state.battle?.phase === "battleEnd";
    },
    result(state): "win" | "lose" | null {
      const last = [...state.log].reverse().find((e) => e.type === "BattleEnded");
      return last && last.type === "BattleEnded" ? last.result : null;
    },
    enemyNames(): Record<string, string> {
      const names: Record<string, string> = {};
      for (const [id, def] of loadGameContent().content.enemies) names[id] = def.name;
      // 实例 id（同名敌人的 `#2` 等）也要能翻译，否则日志里显示原始 id
      for (const e of this.battle?.enemies ?? []) names[e.id] = e.name;
      return names;
    },
  },
  actions: {
    ensureConfigured(): void {
      queue.configure({
        onEvent: (event) => this.onAnimEvent(event),
        onIdle: () => {
          this.playing = false;
        },
      });
      // 倍速的唯一事实源是设置页（settings.animationSpeed，落盘）：
      // 此前设置项写了存档却没有消费方，战斗内 1×/2× 又不落盘，两边各说各话。
      this.speed = useSettingsStore().values.animationSpeed;
      queue.setSpeed(this.speed);
    },

    /**
     * 启动一场教学战斗（docs/41 §4.3）：卡组用玩家所选职业的起始卡组、敌人与种子来自脚本。
     * 不读 run.current、不写 run 进度——教学不该污染正在进行的远征。
     */
    startTutorial(config: TutorialBattleConfig): void {
      this.ensureConfigured();
      const game = loadGameContent();
      const run = useRunStore();
      const cls = run.classDef ?? [...game.content.classes.values()][0];
      if (!cls) return;
      this.tutorialConfig = config;
      this.runKey = `tutorial:${config.chapterId}`;
      this.battle = createBattleState({
        battleId: `tutorial-${config.chapterId}`,
        seed: config.seed,
        player: {
          maxHp: config.maxHp,
          energy: cls.player.energy,
          hp: config.hp,
          pollution: 0,
        },
        enemies: config.enemies.map((id) => ({
          id,
          ...(config.enemyHp !== undefined ? { maxHp: config.enemyHp } : {}),
        })),
        deck: config.deck.map((c) => ({ cardId: c.cardId, upgraded: c.upgraded, enhancements: [] })),
        relics: [...config.relics],
        content: game.content,
        difficulty: "normal",
        // 教学免死（docs/42 §四）：这一场里玩家不会真的被放倒
        safetyFloor: 1,
      });
      this.log = [];
      this.floaters = [];
      this.cancelPact();
      this.clearMessage();
      this.messageTurn = 0;
      this.targeting = null;
      this.skip();
      this.dispatch({ type: "Noop", actionId: `tutorial-${++actionCounter}` });
    },

    start(): void {
      this.ensureConfigured();
      const game = loadGameContent();
      const run = useRunStore();
      this.tutorialConfig = null;
      // 防呆：未开局、或上一局已阵亡（HP<=0）时开新局——
      // 否则会用 0 HP 建战斗，第一帧就再次判负（表现为"再战点不动"）。
      // 但**先尝试读档**（甲方 2026-10-08）：读得到就继续那一局，
      // 不能用 startRun() 把玩家的进度档盖成第一层。
      if (!run.active || !run.run || run.hp <= 0) {
        if (!run.ensureActive() || !run.run || run.hp <= 0) run.startRun();
      }
      // 当前幕（docs/40）：第二幕的战斗不再标成 act1
      const act = run.act ?? game.acts[0];
      this.runKey = `${run.run?.classId ?? ""}:${run.run?.seed ?? ""}`;
      const node = run.current;
      if (!node || !isCombatNode(node)) {
        this.battle = null;
        return;
      }
      this.battle = createBattleState({
        battleId: `${act.id}-${node.id}`,
        seed: (Date.now() ^ (Math.floor(Date.now() / 7) << 3)) >>> 0,
        // 跨节点保留 HP；卡组带上升级与强化实例
        player: {
          maxHp: run.maxHp,
          energy: run.classDef?.player.energy ?? 3,
          hp: run.hp,
          pollution: run.pollution ?? 0,
        },
        enemies: rollEncounter(run.run!, node).map((id) => ({ id })),
        deck: run.deck.map((c) => ({ cardId: c.cardId, upgraded: c.upgraded, enhancements: c.enhancements })),
        relics: run.relics,
        content: game.content,
        // 难度档（docs/36 T2）：敌人 HP / 伤害倍率在 core 里生效
        difficulty: run.run?.difficulty ?? "normal",
        // 职业特性（docs/58 §二）：开局绑定本局，战斗内走注册表能力问询
        traitId: run.run?.traitId ?? "",
      });
      // 图鉴「见过即解锁」：本场用到的卡 / 遗物 / 敌人都点亮（docs/16 4.7）
      const codex = useCodexStore();
      codex.markCards(run.deck.map((c) => c.cardId));
      codex.markRelics(run.relics);
      codex.markEnemies(this.battle.enemies.map((e) => e.defId));
      // 首遇提示 ③（docs/41 §4.1）：手里第一次带着「保留」牌进战斗
      if (run.deck.some((c) => game.content.cards.get(c.cardId)?.keywords?.includes("retain"))) {
        useTipsStore().trigger("retain");
      }
      // 首遇提示（docs/42 §五）：第一次踏进精英节点
      if (node.kind === "elite") useTipsStore().trigger("elite");
      this.log = [];
      this.floaters = [];
      this.cancelPact();
      this.clearMessage();
      this.messageTurn = 0;
      this.targeting = null;
      this.skip();
      this.dispatch({ type: "Noop", actionId: `battle-start-${++actionCounter}` });
    },

    dispatch(action: Action): readonly DomainEvent[] {
      if (!this.battle) return [];
      const result = reduce(this.battle, action);
      this.battle = result.state;
      const runStore = useRunStore();
      if (result.state.phase === "battleEnd" && this.tutorialConfig === null) {
        // 战斗结束把剩余 HP / 污染写回局外进度（跨节点保留，供事件结算）
        // 教学战斗不写：它不是这局远征的一部分
        runStore.setHp(result.state.player.hp);
        // 超级大畸变（docs/58 §七.1）：污染无视 100 封顶，写回同样不截断
        runStore.setPollution(
          result.state.player.pollution,
          pollutionCapFor(loadGameContent().content, runStore.run?.traitId),
        );
        runStore.noteTurns(result.state.turn);
      }
      // 提示生命周期（docs/41 §2.1）：新回合到达 → 上一回合的提示必须消失
      for (const event of result.events) {
        if (event.type === "TurnStarted" && event.turn > this.messageTurn) this.clearMessage();
        // 调试台回执（甲方 2026-10-08）：只在日志抽屉的控制台里显示，不进中央提示
        if (event.type === "DebugMessage") this.debugFeedback = event.message;
        // 教学步骤判定与首遇提示走事件流本身（不走动画回调）：
        // 玩家点「跳过」时动画不下发事件，但教程与说明必须照常推进（docs/41 §4.1/§4.3）
        if (event.type === "CardPlayed") {
          if (this.tutorialConfig) {
            const type = loadGameContent().content.cards.get(event.cardId)?.type;
            if (type) useTutorialStore().noteCardPlayed(event.cardId, type);
          }
          if (event.bloodPaid > 0) useTipsStore().trigger("bloodpact");
        } else if (
          this.tutorialConfig &&
          ((event.type === "BuffApplied" && event.targetId === "player" && isDebuff(event.buffId)) ||
            (event.type === "PollutionChanged" && event.targetId === "player" && event.delta > 0))
        ) {
          // 教学：敌人给玩家挂了异常（污染走 PollutionChanged，不是 BuffApplied）
          useTutorialStore().notePlayerDebuffed();
        } else if (event.type === "ChargeResolved" && !event.released) {
          useTipsStore().trigger("charge");
        } else if (event.type === "BattleEnded" && this.tutorialConfig && event.result === "win") {
          useTutorialStore().noteCleared();
        } else if (event.type === "SafetyNet" && this.tutorialConfig) {
          // 教学安全网（docs/42 §四）：第一次纠正，第二次补满并继续，保证不卡关
          const used = useTutorialStore().noteSafetyNet();
          if (used >= 2) {
            this.setMessage("这一下本该放倒你——班长把你拽回来了。", "info");
            // 延到本帧之后：避免在遍历事件流时重入 dispatch
            setTimeout(() => {
              if (this.battle) {
                this.dispatch({
                  type: "DebugCommand",
                  actionId: `tut-heal-${++actionCounter}`,
                  command: "set hp 9999",
                });
              }
            }, 0);
          } else {
            this.setMessage("免死一次：格挡要在挨打前叠。", "info");
          }
        }
      }
      // 回合结束清掉挂起的卖血合并（避免跨回合串味）
      if (result.events.some((e) => e.type === "TurnEnded")) this.cancelPact();
      // 成就埋点（docs/36 T1 / docs/38 §三 C-3）：从事件流里读，core 不做局外判断
      for (const event of result.events) {
        if (event.type === "CardPlayed" && event.bloodPaid > 0) runStore.noteBloodpact();
        else if (event.type === "Overloaded" && event.targetId === "player") runStore.noteOverload();
        else if (event.type === "ChargeInterrupted") runStore.noteInterrupt();
        else if (event.type === "HpLost" && event.reason === "pollution") runStore.noteBacklash();
      }
      if (result.events.length > 0) {
        this.log.push(...result.events);
        this.playing = true;
        queue.enqueue(result.events);
      }
      return result.events;
    },

    /**
     * 设置提示（docs/41 §2.1）：带回合戳；error 类 2.5 秒自动消散。
     * 提示是纯表现，不进 core、不进事件流。
     */
    setMessage(text: string, kind: "error" | "info" = "error"): void {
      messageSerial += 1;
      const serial = messageSerial;
      if (messageTimer !== null) {
        clearTimeout(messageTimer);
        messageTimer = null;
      }
      this.message = text;
      this.messageKind = kind;
      this.messageTurn = this.battle?.turn ?? 0;
      if (kind === "error") {
        messageTimer = setTimeout(() => {
          messageTimer = null;
          if (messageSerial === serial) this.clearMessage();
        }, MESSAGE_TTL_MS);
      }
    },

    clearMessage(): void {
      if (messageTimer !== null) {
        clearTimeout(messageTimer);
        messageTimer = null;
      }
      this.message = "";
      this.messageKind = "info";
    },

    selectCard(handIndex: number): void {
      if (!this.battle || this.playing || this.over) return;
      if (this.battle.phase !== "playerAction") {
        this.setMessage("当前不可出牌");
        return;
      }
      const check = validatePlayCardState(this.battle, handIndex, null);
      if (check.ok) {
        this.playCard(handIndex, null);
        return;
      }
      if (check.reason === "需要指定目标") {
        this.targeting = handIndex;
        this.setMessage("选择目标", "info");
        return;
      }
      // 首遇提示 ⑤（docs/41 §4.1）：第一次能量不足
      if (check.reason.includes("能量不足")) useTipsStore().trigger("energy");
      this.setMessage(check.reason);
    },

    /**
     * 这张手牌是否**必须先指定目标**才能打出（docs/51 §三 拖动落点判定用）。
     * 直接复用 core 的校验口径，不另立一套规则。
     */
    needsTarget(handIndex: number): boolean {
      if (!this.battle) return false;
      const check = validatePlayCardState(this.battle, handIndex, null);
      return !check.ok && check.reason === "需要指定目标";
    },

    selectTarget(enemyId: string): void {
      if (this.targeting === null) return;
      const handIndex = this.targeting;
      this.targeting = null;
      this.playCard(handIndex, enemyId);
    },

    playCard(handIndex: number, targetId: string | null): void {
      if (!this.battle || this.playing || this.over) return;
      const check = validatePlayCardState(this.battle, handIndex, targetId);
      if (!check.ok) {
        if (check.reason.includes("能量不足")) useTipsStore().trigger("energy");
        this.setMessage(check.reason);
        return;
      }
      this.clearMessage();
      this.dispatch({
        type: "PlayCard",
        actionId: `play-${++actionCounter}`,
        handIndex,
        ...(targetId ? { targetId } : {}),
      });
    },

    endTurn(): void {
      if (!this.battle || this.playing || this.over) return;
      // 首遇提示 ①（docs/41 §4.1）：第一次回合结束还留着没打出的牌
      if (this.battle.piles.hand.length > 0) useTipsStore().trigger("discard");
      // 教学：结束回合时带上当前格挡，供「叠着格挡结束回合」判定
      if (this.tutorialConfig) {
        useTutorialStore().noteEndTurn({ block: this.battle.player.block });
      }
      this.selectTargetNoop();
      this.dispatch({ type: "EndTurn", actionId: `end-${++actionCounter}` });
    },

    selectTargetNoop(): void {
      this.targeting = null;
    },

    /**
     * 神眼（docs/58 §七.2）：从牌库任选一张牌加入手牌，每回合一次。
     * 合法性由 core 兜底（traitEyeAvailable）——这里只做表现层的前置短路。
     */
    pickFromDraw(instanceId: string): void {
      if (!this.battle || this.playing || this.over) return;
      if (this.battle.phase !== "playerAction") return;
      this.clearMessage();
      this.dispatch({ type: "PickFromDraw", actionId: `eye-${++actionCounter}`, instanceId });
    },

    /**
     * 祭血狂热「销毁」（甲方 2026-10-08）：从**手牌**选一张，本场战斗移出牌组（进消耗堆），
     * 战斗结束随牌组归还。合法性由 core 兜底（destroyPending > 0 且牌在手牌里）。
     */
    destroyFromHand(instanceId: string): void {
      if (!this.battle || this.playing || this.over) return;
      if (this.battle.phase !== "playerAction") return;
      this.clearMessage();
      this.dispatch({ type: "DestroyFromHand", actionId: `destroy-${++actionCounter}`, instanceId });
    },

    debug(command: string): string {
      if (!this.battle) return "无战斗";
      const before = this.battle;
      this.dispatch({ type: "DebugCommand", actionId: `dbg-${++actionCounter}`, command });
      void before;
      return command;
    },

    /** 重新开始一局远征（阵亡后的「重新远征」）。 */
    restart(): void {
      const run = useRunStore();
      if (!run.active || !run.run || run.hp <= 0) run.startRun();
      this.start();
    },

    /**
     * 跳过剩余动画（docs/08 §6）。
     * 除了停队列，还要把限时表现状态一并清干净——否则敌人会停在"前扑/闪白"的姿势上，
     * 玩家会以为跳过没生效（玩家反馈）。
     */
    skip(): void {
      queue.skip();
      this.playing = false;
      this.hitUnits = [];
      this.dyingUnits = [];
      this.flipUnits = [];
      this.brokenUnits = [];
      this.lungeUnits = [];
      this.guardUnits = [];
      this.bigFloater = null;
      this.releaseFlash = null;
    },

    toggleSpeed(): void {
      this.speed = this.speed === 1 ? 2 : 1;
      queue.setSpeed(this.speed);
      // 战斗内的切换同样落盘，与设置页保持同一份事实
      useSettingsStore().update({ animationSpeed: this.speed });
    },

    removeFloater(id: number): void {
      this.floaters = this.floaters.filter((f) => f.id !== id);
    },

    /**
     * 弹一条重读数。返回是否真的弹了——没弹（间隔不够）时调用方要把
     * 这一击回落成常规飘字，绝不能什么都不显示。
     */
    pushBigFloater(text: string, tier: BigFloaterTier): boolean {
      const now = Date.now();
      if (now - this.lastBigAt < BIG_FLOATER.gapMs) return false;
      this.lastBigAt = now;
      const id = ++this.bigFloaterSeq;
      this.bigFloater = { id, text, tier };
      setTimeout(() => {
        if (this.bigFloater?.id === id) this.bigFloater = null;
      }, BIG_FLOATER.holdMs);
      return true;
    },

    onAnimEvent(event: DomainEvent): void {
      // 音效（docs/43 Q1 / docs/45 Q10）：出牌 / 命中（敌我两种）/ 回合切换。
      // 只有这一条链会响——音频跟着动画事件走，玩家点「跳过」时自然一并跳过，
      // 不会在跳过一整套连击时哐哐哐放四声命中。
      switch (event.type) {
        case "TurnStarted":
          playSfx("turn");
          break;
        case "DamageDealt": {
          playSfx(event.targetId === "player" ? "hitPlayer" : "hitEnemy");
          // 敌人 → 玩家的攻击：敌人向玩家方向前扑（docs/41 §3.1）
          if (event.targetId === "player" && event.sourceId !== "player") {
            this.pulseUnit("lungeUnits", event.sourceId, 260);
          }
          this.shake += 1;
          this.markUnit("hitUnits", event.targetId, 80);
          // —— 重读数（docs/51 §一）：先试大字，抢不到（0.4s 间隔）就回落成常规飘字 ——
          const playerMax = this.battle?.player.maxHp ?? 0;
          let big = false;
          if (event.targetId === "player" && event.sourceId !== "player" && playerMax > 0) {
            if (event.hpLost >= playerMax * BIG_FLOATER.woundRatio) {
              // ① 重创：血红大字 + 短震屏（震屏走既有的 shake 链）
              big = this.pushBigFloater(`−${event.hpLost}`, "wound");
            } else if (
              event.hpLost === 0 &&
              event.blocked >= Math.max(BIG_FLOATER.guardMin, playerMax * BIG_FLOATER.guardRatio)
            ) {
              // ② 完全格挡：冰蓝大字（原来的「格挡！」小字升级成事件）
              big = this.pushBigFloater("完全格挡！", "guard");
            }
          } else if (event.sourceId === "player") {
            const target = this.battle?.enemies.find((e) => e.id === event.targetId);
            if (
              target &&
              event.value >= Math.max(BIG_FLOATER.heavyMin, target.maxHp * BIG_FLOATER.heavyRatio)
            ) {
              // ③ 重击：锈金大字（爆发的爽感回授）
              big = this.pushBigFloater(`−${event.value}`, "heavy");
            }
          }
          if (big) break;
          if (event.hpLost > 0) this.pushFloater(event.targetId, event.hpLost, "damage", event.hpLost >= 12);
          // 被格挡的部分单独显示蓝色「挡N」；完全格挡显示「格挡！」（docs/41 §3.2）
          if (event.blocked > 0) {
            if (event.hpLost === 0) this.pushFloater(event.targetId, 0, "guard", false, "格挡！");
            else this.pushFloater(event.targetId, event.blocked, "block", false);
          }
          break;
        }
        case "BlockGained":
          // 敌人架盾：护盾微光（玩家侧由 HpBar 显示，不需要额外光效）
          if (event.targetId !== "player") this.markUnit("guardUnits", event.targetId, 420);
          break;
        case "HpHealed":
          if (event.targetId === "player" && pactPending > 0) {
            // 同一张牌的自伤 + 回血 → 一次净值（docs/41 §4.2）
            const net = event.value - pactPending;
            this.cancelPact();
            this.pushFloater("player", net, "net", false, `净 ${net >= 0 ? "+" : "−"}${Math.abs(net)}`);
          } else {
            this.pushFloater(event.targetId, event.value, "heal", false);
          }
          break;
        case "HpLost":
          // 卖血代价先挂起：有回血就合并，没有就当纯代价牌报出来
          if (event.targetId === "player" && event.reason === "bloodpact") {
            pactPending += event.value;
            if (pactTimer === null) {
              pactTimer = setTimeout(() => {
                pactTimer = null;
                const cost = pactPending;
                pactPending = 0;
                if (cost > 0) this.pushFloater("player", cost, "pact", false, `血契 −${cost}`);
              }, PACT_MERGE_WINDOW_MS);
            }
          }
          break;
        case "UnitDied": {
          this.markUnit("dyingUnits", event.unitId, 500);
          // ④ 致命：击杀精英 / Boss 的一击 → 描金「击溃」（docs/51 §一）
          const nodeKind = useRunStore().current?.kind;
          if (nodeKind === "elite" || nodeKind === "boss") {
            this.pushBigFloater("击溃", "finish");
          }
          break;
        }
        case "BuffTicked":
          if (event.damage > 0) this.pushFloater(event.targetId, event.damage, "damage", false);
          break;
        case "BuffApplied": {
          // 玩家吃减益：图标字 + 名称短暂浮在状态栏位置（docs/41 §3.2）
          if (event.targetId === "player") {
            const meta = buffMeta(event.buffId);
            const amount = event.duration != null ? event.duration : event.stacks;
            this.pushFloater("player", amount, "debuff", false, `${meta.glyph} ${meta.name}`);
            // 首遇提示（docs/46 §六.7 / docs/49 Phase 2a）：首次被挂诅咒、首次被灼烧
            if (event.buffId === "chill" || event.buffId === "reverse" || event.buffId === "stun") {
              useTipsStore().trigger("curse");
            } else if (event.buffId === "burn") {
              useTipsStore().trigger("burn");
            }
          }
          break;
        }
        case "StunResisted":
          // 眩晕抗性（docs/46 §3.5）：精英 / Boss 首免后再免
          this.pushFloater(event.targetId, 0, "debuff", false, "抵抗 免疫眩晕");
          break;
        case "PollutionChanged":
          // 污染不走 BuffApplied（core 特判），单独补一条浮名
          if (event.targetId === "player" && event.delta > 0) {
            this.pushFloater("player", event.delta, "debuff", false, `污 污染 +${event.delta}`);
          }
          break;
        // 蓄力链释放（甲方 2026-10-07）：红屏归到「真正砸下来」的这一下。
        // ChargeResolved(released) 就在该次攻击之前发出，红屏正好压在命中动画上。
        case "ChargeResolved":
          if (event.released) {
            const id = ++releaseSeq;
            this.releaseFlash = { id, enemyId: event.enemyId, value: event.value ?? 0 };
            setTimeout(() => {
              if (this.releaseFlash?.id === id) this.releaseFlash = null;
            }, RELEASE_FLASH_MS);
          }
          break;
        case "ChargeInterrupted":
          this.markUnit("brokenUnits", event.enemyId, 1100);
          break;
        case "IntentRevealed":
          this.markUnit("flipUnits", event.enemyId, 200);
          break;
        case "CardPlayed":
          playSfx("cardPlay");
          this.cardPlayed = { cardId: event.cardId, targetId: event.targetId, seq: ++cardPlayedSeq };
          break;
        default:
          break;
      }
    },

    cancelPact(): void {
      if (pactTimer !== null) {
        clearTimeout(pactTimer);
        pactTimer = null;
      }
      pactPending = 0;
    },

    /** 给某个单位打一段限时状态（命中闪白 / 死亡 / 意图翻入）。 */
    markUnit(
      key: "hitUnits" | "dyingUnits" | "flipUnits" | "brokenUnits" | "guardUnits",
      unitId: string,
      ms: number,
    ): void {
      if (!this[key].includes(unitId)) this[key] = [...this[key], unitId];
      setTimeout(() => {
        this[key] = this[key].filter((id) => id !== unitId);
      }, ms);
    },

    /**
     * 可重播的限时状态（docs/41 §3.1 多段攻击逐段前扑）：
     * 先摘掉再于下一帧挂上，强制 CSS 动画从头播——单纯重复赋值不会重播。
     */
    pulseUnit(key: "lungeUnits", unitId: string, ms: number): void {
      if (this[key].includes(unitId)) this[key] = this[key].filter((id) => id !== unitId);
      setTimeout(() => {
        this[key] = [...this[key], unitId];
        setTimeout(() => {
          this[key] = this[key].filter((id) => id !== unitId);
        }, ms);
      }, 0);
    },

    pushFloater(
      targetId: string,
      value: number,
      kind: FloaterKind,
      big: boolean,
      text?: string,
    ): void {
      const id = ++floaterCounter;
      this.floaters = [...this.floaters, { id, targetId, value, kind, big, ...(text ? { text } : {}) }];
      setTimeout(() => this.removeFloater(id), 900);
    },
  },
});