/**
 * stores/run · 一次远征的局外状态（地图进度 / 卡组实例 / 遗物 / 跨节点 HP）
 *
 * 玩法规则（节点推进、奖励抽取、局外 HP）全部来自 core/map；
 * 这里只做保存、投影与持久化（G2 存档）。
 */
import { defineStore } from "pinia";
import {
  addBacklash,
  addInterrupt,
  addOverload,
  addTurns,
  actOf,
  applyEventHp,
  applyIntermission,
  checkEventCondition,
  eventConditionCurrent,
  hasNextAct,
  advanceNode,
  chooseNode,
  createRunState,
  DIFFICULTY_PARAMS,
  MAX_ENHANCEMENT_SLOTS,
  currentNode,
  healRun,
  isRunComplete,
  loseableRelicPool,
  mapView,
  noteBloodpact,
  pickRecastRemoval,
  RECAST_HP_COST,
  relicPool,
  rollCardRewards,
  rollEnhancementChoices,
  rollEvent,
  rollRecastEnhancement,
  rollRelicChoices,
  resolveEventOption,
  setRunHp,
  setRunPollution,
  type EventConditionContext,
  type EventResolution,
  type RunDifficulty,
  type RunState,
} from "@/core/map";
import { pollutionCapFor } from "@/core/combat";
import type {
  ActDefinition,
  CardDefinition,
  ClassDefinition,
  EventCondition,
  EventDefinition,
  MapNode,
  TraitDefinition,
} from "@/core/registry";
import { traitsForClass } from "@/core/registry";
import { useCodexStore } from "@/stores/codex";
import { useMetaStore } from "@/stores/meta";
import { useTipsStore } from "@/stores/tips";
import { loadGameContent } from "@/data/load";
import { clearSlot, readSlot, writeSlot } from "@/systems/save";

export { MAX_ENHANCEMENT_SLOTS };
/** 休息点回复比例（最大 HP 的 30%） */
export const REST_HEAL_RATIO = 0.3;

export interface RunCard {
  readonly cardId: string;
  readonly upgraded: boolean;
  readonly enhancements: readonly string[];
}

export interface EnhancementOffer {
  readonly id: string;
  readonly tier: number;
  readonly targets: readonly number[];
}

interface SavedRun {
  run: RunState;
  deck: RunCard[];
  relics: string[];
  acquired: string[];
  /** 本次祭坛是否已重铸过（按 nodeIndex 判定，缺省 = 未用） */
  recastUsedNode?: number | null;
  /** 本节点是否已附着过强化（按 nodeIndex 判定，缺省 = 未用） */
  enhanceUsedNode?: number | null;
}

export const useRunStore = defineStore("run", {
  state: () => ({
    active: false,
    run: null as RunState | null,
    deck: [] as RunCard[],
    relics: [] as string[],
    acquired: [] as string[],
    recastUsedNode: null as number | null,
    enhanceUsedNode: null as number | null,
    /** 事件节点：最近一次结算结果（null = 还没选） */
    eventResult: null as (EventResolution & { gainEnhancement: boolean }) | null,
    /**
     * docs/54 E2：事件要求玩家自选删一张牌时，记下已删的下标；
     * null = 还没选（「继续」按钮在选完之前不出现）。
     */
    eventRemovedIndex: null as number | null,
    /** E2-A 的强化三选一 */
    eventChoices: null as string[] | null,
    /** docs/45 Q4：Boss 首战「敌人意图」胶囊标签，一局只破例一次（不持久化） */
    bossIntentHintShown: false,
  }),

  getters: {
    acts(): readonly ActDefinition[] {
      return loadGameContent().acts;
    },
    /** 当前幕（docs/40 §二）：随 actIndex 切换。 */
    act(): ActDefinition | undefined {
      if (!this.run) return this.acts[0];
      return actOf(this.run, this.acts) ?? this.acts[0];
    },
    /** 一幕打完且还有下一幕 → 需要进幕间。 */
    needsIntermission(): boolean {
      return !!this.run && !!this.act && isRunComplete(this.run, this.act) && hasNextAct(this.run, this.acts);
    },
    view(): ReturnType<typeof mapView> | null {
      return this.act && this.run ? mapView(this.run, this.act) : null;
    },
    current(): MapNode | undefined {
      return this.act && this.run ? currentNode(this.run, this.act) : undefined;
    },
    finished(): boolean {
      return !!this.act && !!this.run && isRunComplete(this.run, this.act);
    },
    hp(): number {
      return this.run?.hp ?? this.classDef?.player.maxHp ?? 0;
    },
    maxHp(): number {
      return this.run?.maxHp ?? this.classDef?.player.maxHp ?? 0;
    },
    /** 职业身份件（唯一，不参与掉落池）。 */
    identityRelics(): readonly string[] {
      return this.classDef?.startRelics ?? [];
    },
    /** 随身遗物可直接选用的 T1 池（已解锁过滤，按 id 排序）。 */
    companionPool(): string[] {
      const unlocked = this.run?.unlocked ?? [];
      return relicPool(loadGameContent().content, 1, unlocked);
    },
    /**
     * 首胜随身遗物是否待发（甲方 2026-10-07）：开局不再自选，
     * 第一场战斗胜利后从 T1 池里给一次三选一。一局只发一次。
     */
    companionDue(): boolean {
      return (
        !!this.run && !this.run.pickedRelic && this.run.actIndex === 0 && this.run.layerIndex === 0
      );
    },
    /** 本局职业定义（data/classes）。 */
    classDef(): ClassDefinition | undefined {
      if (!this.run) return undefined;
      return loadGameContent().content.classes.get(this.run.classId);
    },
    /** 本局选定的职业特性（docs/58 §二）；无特性 / 空串 = undefined。 */
    traitDef(): TraitDefinition | undefined {
      const id = this.run?.traitId;
      if (!id) return undefined;
      return loadGameContent().content.traits.get(id);
    },
    /** 该职业可选的全部特性（特性界面用；「无特性」由 UI 额外补一项）。 */
    traitChoices(): readonly TraitDefinition[] {
      if (!this.run) return [];
      return traitsForClass(loadGameContent().content, this.run.classId);
    },
    classId(): string {
      return this.run?.classId ?? "";
    },
    pollution(): number {
      return this.run?.pollution ?? 0;
    },
    deckSize(state): number {
      return state.deck.length;
    },
    /**
     * 可重铸的卡：身上有强化 **且** 至少有一枚强化存在"同阶可换替代"
     * （docs/23 §6：同阶池空 → 禁止重铸，不做"只移除不补"的纯亏损）。
     */
    recastableCards(state): number[] {
      const content = loadGameContent().content;
      return state.deck
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => card.enhancements.length > 0)
        .filter(({ card }) =>
          card.enhancements.some((removed) => {
            const def = content.enhancements.get(removed);
            if (!def) return false;
            const keep = card.enhancements.filter((id) => id !== removed);
            const ownedElsewhere = state.deck
              .filter((other) => other !== card)
              .flatMap((other) => [...other.enhancements]);
            return (
              rollRecastEnhancement(
                content,
                card.cardId,
                keep,
                ownedElsewhere,
                def.tier,
                1,
                [removed],
                this.act?.id,
              ) !== null
            );
          }),
        )
        .map(({ index }) => index);
    },
    /**
     * 当前节点还能不能附着强化（docs/16 P3 + docs/25）。
     * 每个节点只允许 1 次：祭坛 1 次、精英残骸 1 次；**重复进入同一节点不再生效**
     * （此前靠 ForgeView 组件局部变量，从地图重进祭坛就会重置 → 玩家报「能强化两次」）。
     */
    canEnhanceHere(): boolean {
      if (!this.run) return false;
      return this.enhanceUsedNode !== this.run.layerIndex;
    },
    canRecast(): boolean {
      if (!this.run) return false;
      if (this.recastUsedNode === this.run.layerIndex) return false;
      if (this.run.hp <= RECAST_HP_COST) return false;
      return this.recastableCards.length > 0;
    },
    /** 当前事件节点抽到的事件（同种子同事件）。 */
    eventDef(): EventDefinition | undefined {
      if (!this.act || !this.run) return undefined;
      const node = this.current;
      if (!node || node.kind !== "event") return undefined;
      return rollEvent(loadGameContent().content, this.run, node);
    },
    /**
     * 选项条件的判定输入（docs/54 E6 / docs/55 Q3）：HP 用局外值；
     * 遗物数给两种口径——总数，以及**可典当数**（T1/T2 − 身份件，与 loseRelic 同源）。
     */
    eventConditionContext(): EventConditionContext {
      const identity = this.identityRelics;
      return {
        hp: this.run?.hp ?? 0,
        maxHp: this.maxHp,
        pollution: this.pollution,
        relicCount: this.relics.length,
        loseableRelicCount: loseableRelicPool(loadGameContent().content, this.relics, identity).length,
      };
    },
    cardDef(): (cardId: string) => CardDefinition | undefined {
      const content = loadGameContent().content;
      return (cardId: string) => content.cards.get(cardId);
    },
  },

  actions: {
    /** 开新局：classId 缺省血械侍僧（存档/继续远征仍读 run.classId）。 */
    startRun(
      classId = "bloodwright",
      seed = (Date.now() ^ 0x9e3779b9) >>> 0,
      difficulty: RunDifficulty = "normal",
      companionRelic = "",
      /** 开发者模式跳关（docs/program 开发模式）：直接落在指定幕 / 层 */
      opts: { actIndex?: number; layerIndex?: number } = {},
      /** 职业特性（docs/58 §二）：空串 / 非法值 = 无特性开局 */
      traitId = "",
    ): void {
      const acts = this.acts;
      const startActIndex = Math.max(0, Math.min(opts.actIndex ?? 0, Math.max(0, acts.length - 1)));
      const act = acts[startActIndex];
      if (!act) return;
      const cls = loadGameContent().content.classes.get(classId) ?? loadGameContent().content.classes.get("bloodwright");
      if (!cls) return;
      // 特性校验：必须存在且归属该职业（UI 只列本职业特性，这里是防呆）
      const traitDef = traitId ? loadGameContent().content.traits.get(traitId) : undefined;
      const chosenTrait = traitDef && traitDef.classId === cls.id ? traitDef.id : "";
      // 解锁内容随局快照（docs/36 T1）：core 只认这份 id 列表，不反向依赖 meta
      const meta = useMetaStore();
      meta.ensureLoaded();
      // 随身遗物改为**首胜后三选一**（甲方 2026-10-07）：开局不再自选、不带件；
      // 第一场战斗胜利后由 RewardView 从 T1 池给一次三选一（见 companionDue / takeCompanionRelic）。
      // 显式传入（测试 / sim / 开发者定点验证）仍然直接带上。
      const pool = relicPool(loadGameContent().content, 1, meta.unlocked);
      const companion = pool.includes(companionRelic) ? companionRelic : "";
      this.run = createRunState(act, cls, seed, {
        unlocked: meta.unlocked,
        difficulty,
        companionRelic: companion,
        traitId: chosenTrait,
        // 通关用时从这里起算（甲方 2026-10-08）；core 不读挂钟，由 store 注入
        startedAt: Date.now(),
      });
      const startLayer = Math.max(0, opts.layerIndex ?? 0);
      if (startActIndex > 0 || startLayer > 0) {
        this.run = {
          ...this.run,
          actIndex: startActIndex,
          layerIndex: startLayer,
          deepestAct: startActIndex + 1,
          deepestLayer: startLayer,
        };
      }
      this.deck = cls.startDeck.map((cardId) => ({ cardId, upgraded: false, enhancements: [] }));
      this.relics = [...(cls.startRelics ?? []), ...(companion ? [companion] : [])];
      this.acquired = [];
      // 每节点标记必须随新局重置，否则上一局的"已用"会卡住新局（测试抓到的真问题）
      this.recastUsedNode = null;
      this.enhanceUsedNode = null;
      this.eventResult = null;
      this.eventChoices = null;
      this.bossIntentHintShown = false;
      this.active = true;
      this.persist();
    },

    /**
     * 选定职业特性（docs/58 §二）：开局流程 = 职业页开好局 → 特性页写 traitId。
     * 必须在尚未进图（layerIndex 0 且未打第一场）时调用；非法值一律落回「无特性」。
     */
    setTrait(traitId: string): void {
      if (!this.run) return;
      const def = traitId ? loadGameContent().content.traits.get(traitId) : undefined;
      const chosen = def && def.classId === this.run.classId ? def.id : "";
      this.run = { ...this.run, traitId: chosen };
      this.persist();
    },

    /** 分支地图：在当前层选定候选（进入节点前调用）。 */
    pickNode(index: number): void {      if (!this.run || !this.act) return;
      this.run = chooseNode(this.run, this.act, index);
      this.persist();
    },

    /** 节点结算完成 → 推进到下一层。 */
    advance(): void {
      if (!this.run || !this.act) return;
      this.run = advanceNode(this.run, this.act);
      // 通关即记 meta（职业解锁 / P6 成就的落点，docs/36 T1）
      if (isRunComplete(this.run, this.act) && hasNextAct(this.run, this.acts)) {
        // 一幕通关但还有下一幕：交给幕间（docs/40 §2.2），本局尚未结束
        this.persist();
        return;
      }
      if (isRunComplete(this.run, this.act)) {
        const meta = useMetaStore();
        const codex = useCodexStore();
        codex.ensureLoaded();
        const content = loadGameContent().content;
        // 全图鉴成就（docs/38 §三 C-3「全图鉴」）
        const codexComplete =
          [...content.cards.keys()].every((id) => codex.cardSeen(id)) &&
          [...content.relics.keys()].every((id) => codex.relicSeen(id)) &&
          [...content.enemies.keys()].every((id) => codex.enemySeen(id));
        meta.markCleared(this.run.classId);
        meta.evaluateRun({
          classId: this.run.classId,
          usedBloodpact: this.run.usedBloodpact,
          overloadCount: this.run.overloadCount,
          interrupts: this.run.interrupts,
          backlashTaken: this.run.backlashTaken,
          turns: this.run.turns,
          pollutionPeak: this.run.pollutionPeak,
          enhancementsAttached: this.acquired.length,
          difficulty: this.run.difficulty,
          codexComplete,
          hpLeft: this.run.hp,
          // 通关用时（甲方 2026-10-08）：开局时间戳缺失（旧档 / 定点验证）时不计
          durationMs: this.run.startedAt > 0 ? Date.now() - this.run.startedAt : undefined,
        });
      }
      this.persist();
    },

    /**
     * 首胜随身遗物三选一（甲方 2026-10-07）：取自 T1 起始池。
     *
     * **固定 3 件**，不走 `relicChoices` 的难度裁量：锈蚀难度的「二选一」按 docs/36 T2
     * 只作用于**精英遗物**；首胜随身遗物若被一并砍成 2 件，界面副标题「从三件里挑一件」
     * 就与实物不符（甲方 2026-10-07 反馈截图）。
     */
    companionRelicChoices(): string[] {
      if (!this.companionDue || !this.run) return [];
      const seed = (this.run.seed ^ Math.imul(this.run.layerIndex + 13, 0x9e3779b9)) >>> 0;
      return rollRelicChoices(loadGameContent().content, this.relics, 3, this.run.unlocked, [1], seed);
    },

    /** 取走首胜随身遗物：记进 relics 与 run.pickedRelic（一局只发一次）。 */
    takeCompanionRelic(relicId: string): void {
      if (!this.run || !this.companionDue) return;
      if (!this.relics.includes(relicId)) this.addRelic(relicId);
      this.run = { ...this.run, pickedRelic: relicId };
      this.persist();
    },

    /** 战斗内：打出过血契牌 → 记一笔（成就「不朽」的判定输入，docs/36 T1）。 */
    noteBloodpact(): void {
      if (!this.run) return;
      this.run = noteBloodpact(this.run);
      this.persist();
    },

    /** 战斗内：触发过一次过载反噬 → 记一笔（成就「红线协议」，docs/36 T1）。 */
    noteOverload(): void {
      if (!this.run) return;
      this.run = addOverload(this.run);
      this.persist();
    },

    /** 战斗内：断链一次（成就「打断蓄力 10 次」，docs/38 §三 C-1/C-3）。 */
    noteInterrupt(): void {
      if (!this.run) return;
      this.run = addInterrupt(this.run);
      useMetaStore().addInterruptStat();
      this.persist();
    },

    /** 战斗内：承受一次污染反噬（成就「承受 3 次反噬仍胜」）。 */
    noteBacklash(): void {
      if (!this.run) return;
      this.run = addBacklash(this.run);
      this.persist();
    },

    /** 战斗结束：累加回合数（最佳纪录「最少回合通关」）。 */
    noteTurns(turns: number): void {
      if (!this.run) return;
      this.run = addTurns(this.run, turns);
      this.persist();
    },

    /** 幕间结算（docs/40 §2.2）：切到下一幕 + 回血 25% + 污染清零；祭坛的每节点标记一并重置。 */
    enterNextAct(): void {
      if (!this.run) return;
      this.run = applyIntermission(this.run);
      this.recastUsedNode = null;
      this.enhanceUsedNode = null;
      this.persist();
    },

    /**
     * 圣堂馈赠（docs/40 §2.3）：
     *  - heal：额外回复 50% 最大 HP
     *  - upgrade：免费升级一张牌
     *  - enhance：获得一枚圣堂强化（走正常附着校验）
     */
    applyBoon(boon: "heal" | "upgrade" | "enhance", deckIndex = -1, enhancementId = ""): void {
      if (!this.run) return;
      this.enterNextAct();
      if (boon === "heal") {
        this.run = healRun(this.run, this.run.maxHp, Math.floor(this.run.maxHp * 0.5));
        this.persist();
      } else if (boon === "upgrade" && deckIndex >= 0) {
        this.upgradeCard(deckIndex);
      } else if (boon === "enhance" && deckIndex >= 0 && enhancementId) {
        this.attachBoonEnhancement(deckIndex, enhancementId);
      }
    },

    /** 幕间附着强化：不受「每节点 1 次」限制，但仍走 canApply（槽位 / appliesTo / 全局唯一）。 */
    attachBoonEnhancement(deckIndex: number, enhancementId: string): boolean {
      if (!this.canApply(enhancementId, deckIndex)) return false;
      this.deck = this.deck.map((card, i) =>
        i === deckIndex ? { ...card, enhancements: [...card.enhancements, enhancementId] } : card,
      );
      this.acquired = [...this.acquired, enhancementId];
      this.persist();
      return true;
    },

    /** 幕间馈赠 C 项：本幕专属强化优先（docs/40 §七），全不可用回落通用池。 */
    boonEnhancementChoices(): string[] {
      if (!this.run) return [];
      const content = loadGameContent().content;
      const actId = this.act?.id;
      const scoped = [...content.enhancements.values()].filter((e) => e.actScope === actId);
      const owned = new Set(this.acquired);
      const usableScoped = scoped.filter(
        (e) => !owned.has(e.id) && this.deck.some((_, i) => this.canApply(e.id, i)),
      );
      const rolled = rollEnhancementChoices(content, this.run, this.run.layerIndex, 3, actId);
      const pool = usableScoped.length > 0 ? usableScoped.map((e) => e.id) : rolled;
      const usable = pool.filter((id) => this.deck.some((_, i) => this.canApply(id, i)));
      return usable.slice(0, 3);
    },

    /** 战斗结束写回局外 HP。 */
    setHp(hp: number): void {
      if (!this.run) return;
      this.run = setRunHp(this.run, hp);
      this.persist();
    },

    /** 休息点：回复 / 升级一张卡 / 移除一张卡（docs/16 P3.5）。 */
    rest(option: "heal" | "upgrade" | "remove", deckIndex = -1): void {
      if (!this.run || !this.act) return;
      if (option === "heal") {
        this.run = healRun(this.run, this.run.maxHp, Math.round(this.run.maxHp * REST_HEAL_RATIO));
      } else if (option === "remove" && deckIndex >= 0) {
        this.removeCard(deckIndex);
      } else if (deckIndex >= 0) {
        this.upgradeCard(deckIndex);
      }
      this.persist();
    },

    /** 休息点「移除一张卡」：不可把卡组清空。 */
    removeCard(deckIndex: number): boolean {
      if (deckIndex < 0 || deckIndex >= this.deck.length) return false;
      if (this.deck.length <= 1) return false;
      this.deck = this.deck.filter((_, i) => i !== deckIndex);
      this.persist();
      return true;
    },

    addCard(cardId: string): void {
      this.deck = [...this.deck, { cardId, upgraded: false, enhancements: [] }];
      this.persist();
    },

    /** 卡奖三选一（走 reward 流，同种子可复现）。 */
    cardRewards(): string[] {
      if (!this.run) return [];
      const game = loadGameContent();
      return rollCardRewards(game.content, this.act!, this.run, this.run.layerIndex);
    },

    /** 可附着的强化（当前卡组至少有一张符合 appliesTo 且未持有）。 */
    usableEnhancements(): string[] {
      const content = loadGameContent().content;
      const actId = this.act?.id;
      return [...content.enhancements.values()]
        .filter((e) => !e.actScope || e.actScope === actId)
        .map((e) => e.id)
        .filter((id) => this.deck.some((_, i) => this.canApply(id, i)));
    },

    /**
     * 锻造祭坛三选一（策划 Q8 保底规则）：
     * 先按 reward 流抽 3 个，再用"可用强化"替换掉不可用项，
     * 保证三选一里至少 1 个对当前卡组有可附着目标。
     */
    enhancementChoices(): string[] {
      if (!this.run) return [];
      const game = loadGameContent();
      const rolled = rollEnhancementChoices(game.content, this.run, this.run.layerIndex, 3, this.act?.id);
      const usable = this.usableEnhancements();
      const chosen = rolled.filter((id) => usable.includes(id));
      for (const id of usable) {
        if (chosen.length >= 3) break;
        if (!chosen.includes(id)) chosen.push(id);
      }
      for (const id of rolled) {
        if (chosen.length >= 3) break;
        if (!chosen.includes(id)) chosen.push(id);
      }
      return chosen.slice(0, 3);
    },

    /**
     * 遗物掉落池（docs/38 §一 A-1）：
     * 精英 / 残骸锻核 = T2 池；Boss = T3 稀有池；事件走 core 的 [1,2] 混合池。
     * 锈蚀难度只给 2 选（docs/36 T2）。
     */
    relicChoices(tiers: readonly number[] = [2]): string[] {
      if (!this.run) return [];
      const count = DIFFICULTY_PARAMS[this.run.difficulty ?? "normal"].relicChoices;
      // 掉落 RNG 走 reward 流：同种子 / 同层 → 同三件（docs/38 §一 A-1）
      const seed = (this.run.seed ^ Math.imul(this.run.layerIndex + 13, 0x9e3779b9)) >>> 0;
      return rollRelicChoices(loadGameContent().content, this.relics, count, this.run.unlocked, tiers, seed);
    },

    setPollution(value: number, cap = 100): void {
      if (!this.run) return;
      this.run = setRunPollution(this.run, value, cap);
      this.persist();
    },

    /** 事件选项结算（docs/27 §三）：核心算结果，store 只写回。 */
    resolveEvent(optionId: string): void {
      if (!this.run || this.eventResult) return;
      const content = loadGameContent().content;
      const def = this.eventDef;
      if (!def) return;
      const seed = (this.run.seed ^ Math.imul(this.run.layerIndex + 11, 0x27d4eb2f)) >>> 0;
      const res = resolveEventOption(content, def, optionId, {
        seed,
        ownedRelics: this.relics,
        classId: this.run.classId,
        // 解锁式内容未解锁不入事件掉落池（docs/36 T1）
        unlocked: this.run.unlocked,
        // docs/54：百分比 HP 的分母 / 随机升级的候选 / 选项条件
        maxHp: this.run.maxHp,
        hp: this.run.hp,
        pollution: this.run.pollution,
        identityRelics: this.identityRelics,
        deckUpgradeable: this.deck.map((c, i) => (c.upgraded ? -1 : i)).filter((i) => i >= 0),
      });
      // 条件不满足被 core 拒绝（UI 已置灰，这里是防呆）
      if (!res) return;
      // 本幕不放回池（docs/54 E7）：结算即记账（记「哪一层抽到哪个事件」，
      // 这样本节点的故事被钉死，结算页不会当场跳成别的故事），下一处事件节点不再抽到同一个
      if (!this.run.seenEvents.some((s) => s.layer === this.run!.layerIndex)) {
        this.run = {
          ...this.run,
          seenEvents: [...this.run.seenEvents, { layer: this.run.layerIndex, eventId: def.id }],
        };
      }
      if (res.hpDelta !== 0 || res.maxHpDelta !== 0) {
        this.run = applyEventHp(this.run, res.hpDelta, res.maxHpDelta);
      }
      if (res.pollutionDelta !== 0) {
        // 与战斗结束写回同口径（stores/battle）：超级大畸变的污染无上限，
        // 事件加/减污染不能用缺省 100 截断，否则两条写入口径不一致、阈值快照随之漂移。
        this.run = setRunPollution(
          this.run,
          this.run.pollution + res.pollutionDelta,
          pollutionCapFor(loadGameContent().content, this.run.traitId),
        );
      }
      for (const id of res.relicIds) this.addRelic(id);
      for (const id of res.loseRelicIds) this.removeRelicById(id);
      for (const id of res.cardIds) this.addCard(id);
      // E3：随机升级（直接改卡组，不复用 upgradeCard —— 那会多存一次档并再弹一次首遇提示）
      if (res.upgradeIndex >= 0 && this.deck[res.upgradeIndex]) {
        const at = res.upgradeIndex;
        this.deck = this.deck.map((c, i) => (i === at ? { ...c, upgraded: true } : c));
      }
      // E2：删牌要玩家自己挑；卡组只剩 1 张时无法删，直接当无事发生（不留死按钮）
      const removeCard = res.removeCard && this.deck.length > 1;
      this.eventRemovedIndex = removeCard ? null : -1;
      let gainEnhancement = res.gainEnhancement;
      if (gainEnhancement) {
        this.eventChoices = this.enhancementChoices();
        if (this.eventChoices.length === 0) {
          this.eventChoices = null;
          gainEnhancement = false;
        }
      }
      this.eventResult = { ...res, removeCard, gainEnhancement };
      this.persist();
    },

    /** docs/54 E2：事件里删掉一张牌（选完才能继续）。 */
    removeEventCard(deckIndex: number): boolean {
      if (!this.eventResult?.removeCard) return false;
      if (this.eventRemovedIndex !== null && this.eventRemovedIndex >= 0) return false;
      if (!this.removeCard(deckIndex)) return false;
      this.eventRemovedIndex = deckIndex;
      this.persist();
      return true;
    },

    /** 丢掉一件遗物（docs/54 E5）：不在手上则原样返回。 */
    removeRelicById(relicId: string): boolean {
      if (!this.relics.includes(relicId)) return false;
      this.relics = this.relics.filter((id) => id !== relicId);
      this.persist();
      return true;
    },

    /** 选项条件是否满足（docs/54 E6）：UI 用它决定置灰。 */
    eventConditionMet(condition: EventCondition | undefined): boolean {
      return checkEventCondition(condition, this.eventConditionContext);
    },

    /** 条件当前值（UI 写「当前 X」用）。 */
    eventConditionCurrent(condition: EventCondition): number {
      return eventConditionCurrent(condition, this.eventConditionContext);
    },

    /** 事件结算完毕 → 推进到下一节点。 */
    eventContinue(): void {
      this.eventResult = null;
      this.eventRemovedIndex = null;
      this.eventChoices = null;
      this.advance();
    },

    addRelic(relicId: string): void {
      if (this.relics.includes(relicId)) return;
      const exists = loadGameContent().content.relics.has(relicId);
      if (!exists) return;
      this.relics = [...this.relics, relicId];
      this.persist();
    },

    canApply(enhancementId: string, deckIndex: number): boolean {
      const enhancement = loadGameContent().content.enhancements.get(enhancementId);
      const card = this.deck[deckIndex];
      if (!enhancement || !card) return false;
      if (!enhancement.appliesTo.includes(card.cardId)) return false;
      if (card.enhancements.length >= MAX_ENHANCEMENT_SLOTS) return false;
      // 同一强化全局唯一：已给过某张卡，就不能再给别的卡
      if (this.deck.some((c) => c.enhancements.includes(enhancementId))) return false;
      const mutex = enhancement.mutex ?? [];
      return !mutex.some((m) => card.enhancements.includes(m));
    },

    offers(ids: readonly string[]): EnhancementOffer[] {
      const content = loadGameContent().content;
      return ids
        .map((id) => content.enhancements.get(id))
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
        .map((e) => ({
          id: e.id,
          tier: e.tier,
          targets: this.deck.map((_, i) => i).filter((i) => this.canApply(e.id, i)),
        }))
        .filter((o) => o.targets.length > 0);
    },

    applyEnhancement(deckIndex: number, enhancementId: string): boolean {
      if (!this.canEnhanceHere) return false;
      if (!this.canApply(enhancementId, deckIndex)) return false;
      this.deck = this.deck.map((card, i) =>
        i === deckIndex ? { ...card, enhancements: [...card.enhancements, enhancementId] } : card,
      );
      this.acquired = [...this.acquired, enhancementId];
      this.enhanceUsedNode = this.run?.layerIndex ?? null;
      this.persist();
      return true;
    },

    /**
     * 重铸（docs/16 P3.4 / docs/14 Q15）：随机移除该卡 1 枚强化，
     * 再从同 tier 可附着池随机换 1 枚；耗 5 HP，每个祭坛限 1 次。
     */
    recast(deckIndex: number): { removed: string; added: string | null } | null {
      if (!this.run || !this.canRecast) return null;
      const card = this.deck[deckIndex];
      if (!card || card.enhancements.length === 0) return null;

      const seed =
        (this.run.seed ^
          Math.imul(this.run.layerIndex + 3, 0x85ebca6b) ^
          Math.imul(deckIndex + 1, 0xc2b2ae35)) >>>
        0;
      const removed = pickRecastRemoval(card.enhancements, seed);
      if (!removed) return null;

      const content = loadGameContent().content;
      const removedDef = content.enhancements.get(removed);
      const keep = card.enhancements.filter((id) => id !== removed);
      const ownedElsewhere = this.deck
        .filter((_, i) => i !== deckIndex)
        .flatMap((c) => [...c.enhancements]);
      const added =
        removedDef
          ? rollRecastEnhancement(
              content,
              card.cardId,
              keep,
              ownedElsewhere,
              removedDef.tier,
              seed ^ 0x9e3779b9,
              [removed],
              this.act?.id,
            )
          : null;
      // docs/23 §6：同阶池空 → 禁止重铸（不扣 HP、不改卡）
      if (added === null) return null;

      const next = [...keep, added];
      this.deck = this.deck.map((c, i) => (i === deckIndex ? { ...c, enhancements: next } : c));
      this.acquired = [...this.acquired.filter((id) => id !== removed), ...(added ? [added] : [])];
      this.run = setRunHp(this.run, Math.max(0, this.run.hp - RECAST_HP_COST));
      this.recastUsedNode = this.run.layerIndex;
      this.persist();
      return { removed, added };
    },

    upgradeCard(deckIndex: number): boolean {
      const card = this.deck[deckIndex];
      if (!card || card.upgraded) return false;
      this.deck = this.deck.map((c, i) => (i === deckIndex ? { ...c, upgraded: true } : c));
      // 首遇提示（docs/42 §五）：第一次升级一张牌
      useTipsStore().trigger("upgrade");
      this.persist();
      return true;
    },

    /* ---------- G2 存档 ---------- */

    serialize(): SavedRun | null {
      if (!this.run) return null;
      return {
        run: this.run,
        deck: this.deck.map((c) => ({ cardId: c.cardId, upgraded: c.upgraded, enhancements: [...c.enhancements] })),
        relics: [...this.relics],
        acquired: [...this.acquired],
        recastUsedNode: this.recastUsedNode,
        enhanceUsedNode: this.enhanceUsedNode,
      };
    },

    persist(): void {
      const payload = this.serialize();
      if (payload) writeSlot("progress", payload);
    },

    /**
     * 确保内存里有「进行中的一局」（甲方 2026-10-08 反馈「继续游戏却从第一层开始」的防线）：
     * 任何 run 视图在 run 未激活时先尝试**读档**；只有读不到才算真的没局。
     * 视图里**绝不能用 `startRun()` 兜底**——那会用一局新游戏盖掉玩家的进度档。
     */
    ensureActive(): boolean {
      if (this.active && this.run) return true;
      return this.load();
    },

    /** 读档并恢复；无档或损坏返回 false。 */
    load(): boolean {
      const saved = readSlot<SavedRun | null>("progress", null);
      if (!saved || !saved.run || !Array.isArray(saved.deck)) return false;
      // 老档缺字段：默认补齐（save 迁移链已处理，双保险）
      this.run = {
        ...saved.run,
        pollution: saved.run.pollution ?? 0,
        layerIndex: saved.run.layerIndex ?? 0,
        picked: saved.run.picked ?? [],
        unlocked: saved.run.unlocked ?? [],
        // 随身遗物改为首胜后发放：默认空，拿到才有（SCHEMA 13 已作废旧线性档）
        pickedRelic: saved.run.pickedRelic ?? "",
        // 职业特性（SCHEMA 15）：旧档空串 = 无特性
        traitId: saved.run.traitId ?? "",
        difficulty: saved.run.difficulty ?? "normal",
        usedBloodpact: saved.run.usedBloodpact ?? false,
        overloadCount: saved.run.overloadCount ?? 0,
        interrupts: saved.run.interrupts ?? 0,
        backlashTaken: saved.run.backlashTaken ?? 0,
        turns: saved.run.turns ?? 0,
        pollutionPeak: saved.run.pollutionPeak ?? saved.run.pollution ?? 0,
        // 旧档没有开局时间戳 → 0（用时显示「—」，不编一个假的）
        startedAt: saved.run.startedAt ?? 0,
        actIndex: saved.run.actIndex ?? 0,
        deepestAct: saved.run.deepestAct ?? 1,
        deepestLayer: saved.run.deepestLayer ?? saved.run.layerIndex ?? 0,
        legacy: saved.run.legacy ?? false,
        seenEvents: saved.run.seenEvents ?? [],
      };
      this.deck = saved.deck;
      this.relics = saved.relics ?? [];
      this.acquired = saved.acquired ?? [];
      this.recastUsedNode = saved.recastUsedNode ?? null;
      this.enhanceUsedNode = saved.enhanceUsedNode ?? null;
      this.active = true;
      return true;
    },

    clearSave(): void {
      clearSlot("progress");
      this.active = false;
      this.run = null;
      this.deck = [];
      this.relics = [];
      this.acquired = [];
      this.recastUsedNode = null;
      this.enhanceUsedNode = null;
    },
  },
});
