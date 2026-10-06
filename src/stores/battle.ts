/**
 * stores/battle · 战斗状态在 UI 侧的投影（ui/stores README）
 *
 * 只做：调用 core 的 reduce、把事件流交给动画队列、维护纯表现的飘字/屏震。
 * 不写任何数值逻辑——所有数字来自 core 事件载荷。
 */
import { defineStore } from "pinia";
import { createBattleState, reduce, validatePlayCardState, type BattleState } from "@/core/combat";
import { isCombatNode, rollEncounter } from "@/core/map";
import type { Action } from "@/core/actions";
import type { DomainEvent } from "@/core/events";
import { loadGameContent } from "@/data/load";
import { AnimQueue } from "@/ui/anim-queue";
import { useCodexStore } from "@/stores/codex";
import { useRunStore } from "@/stores/run";

export interface Floater {
  readonly id: number;
  readonly targetId: string;
  readonly value: number;
  readonly kind: "damage" | "heal";
  readonly big: boolean;
}

let actionCounter = 0;
let floaterCounter = 0;
let cardPlayedSeq = 0;
const queue = new AnimQueue();

export const useBattleStore = defineStore("battle", {
  state: () => ({
    battle: null as BattleState | null,
    /** 本场战斗对应的「职业:种子」标识；换职业/开新局时用来识别陈旧战斗并重开 */
    runKey: "",
    log: [] as DomainEvent[],
    floaters: [] as Floater[],
    playing: false,
    message: "",
    shake: 0,
    targeting: null as number | null,
    speed: 1 as 1 | 2,
    /** 打击感反馈（docs/08 §6） */
    hitUnits: [] as string[],
    dyingUnits: [] as string[],
    flipUnits: [] as string[],
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
      queue.setSpeed(this.speed);
    },

    start(): void {
      this.ensureConfigured();
      const game = loadGameContent();
      const act = game.acts[0];
      const run = useRunStore();
      // 防呆：未开局、或上一局已阵亡（HP<=0）时，一律开新局——
      // 否则会用 0 HP 建战斗，第一帧就再次判负（表现为"再战点不动"）。
      if (!run.active || !run.run || run.hp <= 0) run.startRun();
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
      });
      // 图鉴「见过即解锁」：本场用到的卡 / 遗物 / 敌人都点亮（docs/16 4.7）
      const codex = useCodexStore();
      codex.markCards(run.deck.map((c) => c.cardId));
      codex.markRelics(run.relics);
      codex.markEnemies(this.battle.enemies.map((e) => e.defId));
      this.log = [];
      this.floaters = [];
      this.message = "";
      this.targeting = null;
      this.skip();
      this.dispatch({ type: "Noop", actionId: `battle-start-${++actionCounter}` });
    },

    dispatch(action: Action): readonly DomainEvent[] {
      if (!this.battle) return [];
      const result = reduce(this.battle, action);
      this.battle = result.state;
      const runStore = useRunStore();
      if (result.state.phase === "battleEnd") {
        // 战斗结束把剩余 HP / 污染写回局外进度（跨节点保留，供事件结算）
        runStore.setHp(result.state.player.hp);
        runStore.setPollution(result.state.player.pollution);
      }
      // 成就埋点（docs/36 T1）：血契出牌 / 过载反噬从事件流里读，core 不做局外判断
      for (const event of result.events) {
        if (event.type === "CardPlayed" && event.bloodPaid > 0) runStore.noteBloodpact();
        else if (event.type === "Overloaded" && event.targetId === "player") runStore.noteOverload();
      }
      if (result.events.length > 0) {
        this.log.push(...result.events);
        this.playing = true;
        queue.enqueue(result.events);
      }
      return result.events;
    },

    selectCard(handIndex: number): void {
      if (!this.battle || this.playing || this.over) return;
      if (this.battle.phase !== "playerAction") {
        this.message = "当前不可出牌";
        return;
      }
      const check = validatePlayCardState(this.battle, handIndex, null);
      if (check.ok) {
        this.playCard(handIndex, null);
        return;
      }
      if (check.reason === "需要指定目标") {
        this.targeting = handIndex;
        this.message = "选择目标";
        return;
      }
      this.message = check.reason;
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
        this.message = check.reason;
        return;
      }
      this.message = "";
      this.dispatch({
        type: "PlayCard",
        actionId: `play-${++actionCounter}`,
        handIndex,
        ...(targetId ? { targetId } : {}),
      });
    },

    endTurn(): void {
      if (!this.battle || this.playing || this.over) return;
      this.selectTargetNoop();
      this.dispatch({ type: "EndTurn", actionId: `end-${++actionCounter}` });
    },

    selectTargetNoop(): void {
      this.targeting = null;
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

    skip(): void {
      queue.skip();
      this.playing = false;
    },

    toggleSpeed(): void {
      this.speed = this.speed === 1 ? 2 : 1;
      queue.setSpeed(this.speed);
    },

    removeFloater(id: number): void {
      this.floaters = this.floaters.filter((f) => f.id !== id);
    },

    onAnimEvent(event: DomainEvent): void {
      switch (event.type) {
        case "DamageDealt":
          this.shake += 1;
          this.markUnit("hitUnits", event.targetId, 80);
          if (event.hpLost > 0) this.pushFloater(event.targetId, event.hpLost, "damage", event.hpLost >= 12);
          break;
        case "HpHealed":
          this.pushFloater(event.targetId, event.value, "heal", false);
          break;
        case "UnitDied":
          this.markUnit("dyingUnits", event.unitId, 500);
          break;
        case "BuffTicked":
          if (event.damage > 0) this.pushFloater(event.targetId, event.damage, "damage", false);
          break;
        case "IntentRevealed":
          this.markUnit("flipUnits", event.enemyId, 200);
          break;
        case "CardPlayed":
          this.cardPlayed = { cardId: event.cardId, targetId: event.targetId, seq: ++cardPlayedSeq };
          break;
        default:
          break;
      }
    },

    /** 给某个单位打一段限时状态（命中闪白 / 死亡 / 意图翻入）。 */
    markUnit(key: "hitUnits" | "dyingUnits" | "flipUnits", unitId: string, ms: number): void {
      if (!this[key].includes(unitId)) this[key] = [...this[key], unitId];
      setTimeout(() => {
        this[key] = this[key].filter((id) => id !== unitId);
      }, ms);
    },

    pushFloater(targetId: string, value: number, kind: Floater["kind"], big: boolean): void {
      const id = ++floaterCounter;
      this.floaters = [...this.floaters, { id, targetId, value, kind, big }];
      setTimeout(() => this.removeFloater(id), 900);
    },
  },
});