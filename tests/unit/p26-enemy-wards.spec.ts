import { describe, expect, it } from "vitest";
import { createContentDb, type CardDefinition, type ContentDb, type EnemyDefinition } from "@/core/registry";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import type { DomainEvent } from "@/core/events";
import { handIndex } from "../helpers/combat";

/**
 * docs/60 §四/§八.3 敌方特殊机制（甲方 2026-10-08 实装批）：
 *  - 锈喉「转阶段保护」（phaseGuard，甲方 2026-10-08 口述修订）：跨过 50% 的一击吃满，
 *    随后挂上「临界硬化」（99% 减伤，本回合有效），玩家回合结束时消失；
 *  - 锈喉「狂噬」吸血（lifesteal）：只按真实掉血回血，格挡挡住的部分不算；
 *  - 虚化 ethereal：只吃**技能牌**伤害；魔免 magicimmune：只吃**攻击牌**伤害；
 *  - 不屈 unbreakable：本回合累计受伤 ≤ ceil(maxHp × 15%)。
 * 实装当时没有随附单测（2026-10-08 补录）——机制行为以本 spec 为准。
 */

/* ---------------- 测试用卡 ---------------- */

const hit20: CardDefinition = {
  id: "test_hit20",
  class: "bloodwright",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 20 }],
};

const hit50: CardDefinition = {
  id: "test_hit50",
  class: "bloodwright",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 50 }],
};

const hit60: CardDefinition = {
  id: "test_hit60",
  class: "bloodwright",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 60 }],
};

/** 技能牌伤害（虚化的唯一通道） */
const zap30: CardDefinition = {
  id: "test_zap30",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 30 }],
};

const hexEthereal: CardDefinition = {
  id: "test_hex_ethereal",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: "ethereal", stacks: 2 }],
};

const hexMagicimmune: CardDefinition = {
  id: "test_hex_magicimmune",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: "magicimmune", stacks: 2 }],
};

const hexUnbreakable: CardDefinition = {
  id: "test_hex_unbreakable",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: "unbreakable", stacks: 2 }],
};

const defend10: CardDefinition = {
  id: "test_defend10",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "block", target: { type: "self" }, value: 10 }],
};

/* ---------------- 测试用敌人 ---------------- */

const wardBoss: EnemyDefinition = {
  id: "wardboss",
  name: "WardBoss",
  maxHp: 100,
  phaseGuard: true,
  intents: [{ intent: { kind: "attack", value: 1 }, weight: 1, maxConsecutive: 1 }],
};

const vamp: EnemyDefinition = {
  id: "vamp",
  name: "Vamp",
  maxHp: 50,
  intents: [{ intent: { kind: "attack", value: 10, lifesteal: 1 }, weight: 1, maxConsecutive: 99 }],
};

const CARDS = [hit20, hit50, hit60, zap30, hexEthereal, hexMagicimmune, hexUnbreakable, defend10];
const ENEMIES = [wardBoss, vamp];

function content(): ContentDb {
  return createContentDb({
    cards: new Map(CARDS.map((c) => [c.id, c])),
    enemies: new Map(ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(),
  });
}

function battle(deck: string[], enemyId = "wardboss"): BattleState {
  return reduce(
    createBattleState({
      battleId: "wards",
      seed: 424242,
      player: { maxHp: 66, energy: 9 },
      enemies: [{ id: enemyId }],
      deck,
      handSize: 8,
      content: content(),
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string) {
  return reduce(state, { type: "PlayCard", actionId: `p-${cardId}-${state.eventSeq}`, handIndex: handIndex(state, cardId) });
}

function bossHp(state: BattleState): number {
  return state.enemies[0].hp;
}

/** 类型安全的事件过滤（helpers 的 eventsOfType 返回类型会丢收窄，这里按 DomainEvent 精确提取） */
function eventsOf<T extends DomainEvent["type"]>(
  events: readonly DomainEvent[],
  type: T,
): Extract<DomainEvent, { type: T }>[] {
  return events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
}

function damageOnBoss(events: readonly DomainEvent[]): number {
  const e = eventsOf(events, "DamageDealt").find((x) => x.targetId !== "player");
  return e ? e.hpLost : -1;
}

/* ---------------- 转阶段保护（锈喉 phaseGuard） ---------------- */

describe("转阶段保护（docs/60 §四，甲方 2026-10-08 口述修订）", () => {
  it("跨线一击吃满 → 挂上临界硬化 → 本回合后续 99% 减伤 → 结束回合后消失", () => {
    let state = battle(["test_hit60", "test_hit20", "test_hit20", "test_hit20", "test_hit20"]);
    // 100 → 40：跨过 50% 的这一击**照常吃满**，随后挂上 phase_ward
    const r1 = play(state, "test_hit60");
    state = r1.state;
    expect(damageOnBoss(r1.events)).toBe(60);
    expect(eventsOf(r1.events, "PhaseGuarded")).toHaveLength(1);
    expect(eventsOf(r1.events, "BuffApplied").some((e) => e.buffId === "phase_ward")).toBe(true);
    expect(bossHp(state)).toBe(40);

    // 硬化持续中：本回合后续伤害减 99%（20 → max(1, round(0.2)) = 1）
    const r2 = play(state, "test_hit20");
    state = r2.state;
    expect(damageOnBoss(r2.events)).toBe(1);
    expect(eventsOf(r2.events, "BuffTriggered").some((e) => e.buffId === "phase_ward")).toBe(true);
    expect(bossHp(state)).toBe(39);

    // 玩家结束回合 → buff 到期消失
    const r3 = reduce(state, { type: "EndTurn", actionId: "e1" });
    state = r3.state;
    expect(eventsOf(r3.events, "BuffExpired").some((e) => e.buffId === "phase_ward")).toBe(true);

    // 下一回合：减伤已消失，伤害全额
    const r4 = play(state, "test_hit20");
    expect(damageOnBoss(r4.events)).toBe(20);
  });

  it("没跨过 50% 不挂 buff；跨线那一下照常吃满再挂", () => {
    let state = battle(["test_hit20", "test_hit60", "test_hit20", "test_hit20", "test_hit20"]);
    const r1 = play(state, "test_hit20"); // 100 → 80，未跨线
    state = r1.state;
    expect(damageOnBoss(r1.events)).toBe(20);
    expect(eventsOf(r1.events, "PhaseGuarded")).toHaveLength(0);
    expect(eventsOf(r1.events, "BuffApplied").some((e) => e.buffId === "phase_ward")).toBe(false);

    const r2 = play(state, "test_hit60"); // 80 → 20 跨线：吃满 60，挂 buff
    state = r2.state;
    expect(damageOnBoss(r2.events)).toBe(60);
    expect(eventsOf(r2.events, "PhaseGuarded")).toHaveLength(1);
    expect(bossHp(state)).toBe(20);
  });

  it("正好打到 50% 不触发（严格小于口径）", () => {
    let state = battle(["test_hit50", "test_hit20", "test_hit20", "test_hit20", "test_hit20"]);
    const r1 = play(state, "test_hit50"); // 100 → 50，正好半程：不触发
    state = r1.state;
    expect(damageOnBoss(r1.events)).toBe(50);
    expect(eventsOf(r1.events, "PhaseGuarded")).toHaveLength(0);
    expect(bossHp(state)).toBe(50);

    const r2 = play(state, "test_hit20"); // 50 → 30：前置血线不「严格大于」50%，不触发
    expect(damageOnBoss(r2.events)).toBe(20);
    expect(eventsOf(r2.events, "PhaseGuarded")).toHaveLength(0);
  });

  it("跨线的一击直接打死就不挂 buff（死人不需要硬化）", () => {
    const state = battle(["test_hit50", "test_hit60", "test_hit20", "test_hit20", "test_hit20"]);
    const s = play(state, "test_hit50").state; // 100 → 50，不触发
    const r = play(s, "test_hit60"); // 50 → 0：击杀，不触发（hpBeforeHit 不严格大于 50%）
    expect(eventsOf(r.events, "PhaseGuarded")).toHaveLength(0);
    expect(eventsOf(r.events, "BuffApplied").some((e) => e.buffId === "phase_ward")).toBe(false);
    expect(r.state.enemies[0].hp).toBe(0);
  });
});

/* ---------------- 狂噬吸血（lifesteal） ---------------- */

describe("狂噬吸血（docs/60 §四）", () => {
  it("敌方攻击按真实掉血回血", () => {
    let state = battle(["test_hit20", "test_hit20", "test_hit20", "test_hit20", "test_hit20"], "vamp");
    state = play(state, "test_hit20").state; // vamp 50 → 30
    expect(bossHp(state)).toBe(30);

    const r = reduce(state, { type: "EndTurn", actionId: "e1" }); // vamp 攻击 10、吸血 100%
    state = r.state;
    expect(state.player.hp).toBe(56); // 66 − 10
    const healed = eventsOf(r.events, "HpHealed").find((e) => e.targetId !== "player");
    expect(healed && healed.type === "HpHealed" ? healed.value : 0).toBe(10);
    expect(bossHp(state)).toBe(40);
  });

  it("打在格挡上的部分不回血（只算真实掉血）", () => {
    let state = battle(["test_hit20", "test_defend10", "test_hit20", "test_hit20", "test_hit20"], "vamp");
    state = play(state, "test_hit20").state; // vamp 50 → 30
    state = play(state, "test_defend10").state; // 玩家 10 格挡

    const r = reduce(state, { type: "EndTurn", actionId: "e1" }); // 攻击 10 → 挡 10，真实掉血 0
    state = r.state;
    expect(state.player.hp).toBe(66);
    expect(eventsOf(r.events, "HpHealed").filter((e) => e.targetId !== "player")).toHaveLength(0);
    expect(bossHp(state)).toBe(30);
  });
});

/* ---------------- 虚化 / 魔免（docs/60 §八.3） ---------------- */

describe("虚化 / 魔免（docs/60 §八.3）", () => {
  it("虚化：攻击牌归零、不耗格挡不诱发结算，技能牌照常", () => {
    let state = battle(["test_hex_ethereal", "test_hit20", "test_zap30", "test_hit20", "test_hit20"]);
    state = play(state, "test_hex_ethereal").state;

    const r1 = play(state, "test_hit20"); // 攻击牌 → 挡下
    state = r1.state;
    expect(damageOnBoss(r1.events)).toBe(0);
    expect(bossHp(state)).toBe(100);

    const r2 = play(state, "test_zap30"); // 技能牌 → 照常
    state = r2.state;
    expect(damageOnBoss(r2.events)).toBe(30);
    expect(bossHp(state)).toBe(70);
  });

  it("魔免：技能牌归零，攻击牌照常", () => {
    let state = battle(["test_hex_magicimmune", "test_zap30", "test_hit20", "test_hit20", "test_hit20"]);
    state = play(state, "test_hex_magicimmune").state;

    const r1 = play(state, "test_zap30"); // 技能牌 → 挡下
    state = r1.state;
    expect(damageOnBoss(r1.events)).toBe(0);
    expect(bossHp(state)).toBe(100);

    const r2 = play(state, "test_hit20"); // 攻击牌 → 照常
    state = r2.state;
    expect(damageOnBoss(r2.events)).toBe(20);
    expect(bossHp(state)).toBe(80);
  });
});

/* ---------------- 不屈（docs/60 §八.3） ---------------- */

describe("不屈（docs/60 §八.3）", () => {
  it("本回合累计受伤封顶 ceil(maxHp × 15%)，超出部分不算；下回合重置", () => {
    let state = battle(["test_hex_unbreakable", "test_hit60", "test_hit20", "test_hit20", "test_hit20"]);
    state = play(state, "test_hex_unbreakable").state;

    // cap = ceil(100 × 0.15) = 15：60 点一击只进 15
    const r1 = play(state, "test_hit60");
    state = r1.state;
    expect(damageOnBoss(r1.events)).toBe(15);
    expect(eventsOf(r1.events, "BuffTriggered").some((e) => e.buffId === "unbreakable")).toBe(true);
    expect(bossHp(state)).toBe(85);

    // 本回合额度已用尽：第二击 0
    const r2 = play(state, "test_hit20");
    state = r2.state;
    expect(damageOnBoss(r2.events)).toBe(0);
    expect(bossHp(state)).toBe(85);

    // 跨回合重置额度：下一玩家回合重新有 15 点空间——20 点一击仍然只进 15（封顶按回合算）
    let r3 = reduce(state, { type: "EndTurn", actionId: "e1" });
    state = r3.state;
    r3 = play(state, "test_hit20");
    state = r3.state;
    expect(damageOnBoss(r3.events)).toBe(15);
    expect(bossHp(state)).toBe(70);

    // 新回合的额度同样一击就用尽
    const r4 = play(state, "test_hit20");
    expect(damageOnBoss(r4.events)).toBe(0);
  });
});
