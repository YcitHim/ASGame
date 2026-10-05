/**
 * stores/run · 一次远征的局外状态（地图进度 / 卡组实例 / 遗物 / 跨节点 HP）
 *
 * 玩法规则（节点推进、奖励抽取、局外 HP）全部来自 core/map；
 * 这里只做保存、投影与持久化（G2 存档）。
 */
import { defineStore } from "pinia";
import {
  advanceNode,
  createRunState,
  MAX_ENHANCEMENT_SLOTS,
  currentNode,
  healRun,
  isRunComplete,
  mapView,
  pickRecastRemoval,
  RECAST_HP_COST,
  rollCardRewards,
  rollEnhancementChoices,
  rollRecastEnhancement,
  rollRelicChoices,
  setRunHp,
  type RunState,
} from "@/core/map";
import type { ActDefinition, CardDefinition, MapNode } from "@/core/registry";
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
}

export const useRunStore = defineStore("run", {
  state: () => ({
    active: false,
    run: null as RunState | null,
    deck: [] as RunCard[],
    relics: [] as string[],
    acquired: [] as string[],
    recastUsedNode: null as number | null,
  }),

  getters: {
    act(): ActDefinition | undefined {
      return loadGameContent().acts[0];
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
      return this.run?.hp ?? this.act?.player.maxHp ?? 0;
    },
    maxHp(): number {
      return this.act?.player.maxHp ?? 0;
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
              rollRecastEnhancement(content, card.cardId, keep, ownedElsewhere, def.tier, 1, [removed]) !==
              null
            );
          }),
        )
        .map(({ index }) => index);
    },
    canRecast(): boolean {
      if (!this.run) return false;
      if (this.recastUsedNode === this.run.nodeIndex) return false;
      if (this.run.hp <= RECAST_HP_COST) return false;
      return this.recastableCards.length > 0;
    },
    cardDef(): (cardId: string) => CardDefinition | undefined {
      const content = loadGameContent().content;
      return (cardId: string) => content.cards.get(cardId);
    },
  },

  actions: {
    startRun(seed = (Date.now() ^ 0x9e3779b9) >>> 0): void {
      const act = this.act;
      if (!act) return;
      this.run = createRunState(act, seed);
      this.deck = act.startDeck.map((cardId) => ({ cardId, upgraded: false, enhancements: [] }));
      this.relics = [...(act.startRelics ?? [])];
      this.acquired = [];
      this.active = true;
      this.persist();
    },

    /** 节点结算完成 → 推进到下一个节点。 */
    advance(): void {
      if (!this.run || !this.act) return;
      this.run = advanceNode(this.run, this.act);
      this.persist();
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
        this.run = healRun(this.run, this.act.player.maxHp, Math.round(this.act.player.maxHp * REST_HEAL_RATIO));
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
      return rollCardRewards(game.content, this.act!, this.run, this.run.nodeIndex);
    },

    /** 可附着的强化（当前卡组至少有一张符合 appliesTo 且未持有）。 */
    usableEnhancements(): string[] {
      const content = loadGameContent().content;
      return [...content.enhancements.values()]
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
      const rolled = rollEnhancementChoices(game.content, this.run, this.run.nodeIndex);
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

    /** 精英战掉落：未持有遗物里抽（Q10），允许放弃。 */
    relicChoices(): string[] {
      if (!this.run) return [];
      return rollRelicChoices(loadGameContent().content, this.relics, 3);
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
      if (!this.canApply(enhancementId, deckIndex)) return false;
      this.deck = this.deck.map((card, i) =>
        i === deckIndex ? { ...card, enhancements: [...card.enhancements, enhancementId] } : card,
      );
      this.acquired = [...this.acquired, enhancementId];
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
          Math.imul(this.run.nodeIndex + 3, 0x85ebca6b) ^
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
            )
          : null;
      // docs/23 §6：同阶池空 → 禁止重铸（不扣 HP、不改卡）
      if (added === null) return null;

      const next = [...keep, added];
      this.deck = this.deck.map((c, i) => (i === deckIndex ? { ...c, enhancements: next } : c));
      this.acquired = [...this.acquired.filter((id) => id !== removed), ...(added ? [added] : [])];
      this.run = setRunHp(this.run, Math.max(0, this.run.hp - RECAST_HP_COST));
      this.recastUsedNode = this.run.nodeIndex;
      this.persist();
      return { removed, added };
    },

    upgradeCard(deckIndex: number): boolean {
      const card = this.deck[deckIndex];
      if (!card || card.upgraded) return false;
      this.deck = this.deck.map((c, i) => (i === deckIndex ? { ...c, upgraded: true } : c));
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
      };
    },

    persist(): void {
      const payload = this.serialize();
      if (payload) writeSlot("progress", payload);
    },

    /** 读档并恢复"; 无档或损坏返回 false。 */
    load(): boolean {
      const saved = readSlot<SavedRun | null>("progress", null);
      if (!saved || !saved.run || !Array.isArray(saved.deck)) return false;
      this.run = saved.run;
      this.deck = saved.deck;
      this.relics = saved.relics ?? [];
      this.acquired = saved.acquired ?? [];
      this.recastUsedNode = saved.recastUsedNode ?? null;
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
    },
  },
});
