import { describe, expect, it } from "vitest";
import {
  createContentDb,
  traitsForClass,
  type CardDefinition,
  type ContentDb,
  type TraitDefinition,
} from "@/core/registry";
import {
  brambleMaxStacks,
  createBattleState,
  effectiveBrambleStacks,
  eyeAvailable,
  previewEnergyCost,
  reduce,
  toDraft,
  validatePlayCardState,
  type BattleConfig,
  type BattleState,
} from "@/core/combat";
import { loadGameContent } from "@/data/load";
import type { DomainEvent } from "@/core/events";
import { TEST_CARDS, TEST_ENEMIES, handIndex } from "../helpers/combat";

/**
 * docs/58 职业特性系统。
 *
 * 覆盖五批：属性调整 / 嗜血 / 铁皮王八 / 玻璃大炮 / 超级大畸变。
 * 断言口径一律对齐设计文档原文（§三~§七），不引入 UI 层假设。
 */

/* ---------------- 测试用卡 ---------------- */

const bleedStrike: CardDefinition = {
  id: "test_bleed_strike",
  class: "bloodwright",
  type: "attack",
  rarity: "common",
  cost: 0,
  keywords: ["bloodpact"],
  bloodCost: 3,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 9 }],
};

const plainAttack: CardDefinition = {
  id: "test_attack",
  class: "bloodwright",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 7 }],
};

const guard: CardDefinition = {
  id: "test_guard",
  class: "engineer",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "block", target: { type: "self" }, value: 5 }],
};

const charge3: CardDefinition = {
  id: "test_charge3",
  class: "engineer",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "gainCharge", value: 3 }],
};

const charge16: CardDefinition = {
  id: "test_charge16",
  class: "engineer",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "gainCharge", value: 16 }],
};

const pollute120: CardDefinition = {
  id: "test_pollute120",
  class: "rustspeaker",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "gainPollution", value: 120 }],
};

const bigGuard: CardDefinition = {
  id: "test_big_guard",
  class: "engineer",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "block", target: { type: "self" }, value: 24 }],
};

const aoeAttack: CardDefinition = {
  id: "test_aoe",
  class: "engineer",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "damage", target: { type: "allEnemies" }, value: 4 }],
};

/** 两段攻击：第 2 段条件是「充能 ≥2」——专门验证「卡牌先算完、再抽空充能」。 */
const twoHitCharge: CardDefinition = {
  id: "test_two_hit_charge",
  class: "engineer",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [
    { kind: "damage", target: { type: "chosenEnemy" }, value: 3 },
    { kind: "damage", target: { type: "chosenEnemy" }, value: 5, condition: { type: "chargeAtLeast", n: 2 } },
  ],
};

/** 自带泄能的攻击：基础段 + spendCharge（每点 1 伤害）。 */
const testDischarge: CardDefinition = {
  id: "test_discharge",
  class: "engineer",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [
    { kind: "damage", target: { type: "chosenEnemy" }, value: 2 },
    { kind: "spendCharge", target: { type: "chosenEnemy" }, value: 1 },
  ],
};

const expensive: CardDefinition = {
  id: "test_expensive",
  class: "rustspeaker",
  type: "attack",
  rarity: "common",
  cost: 3,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 20 }],
};

const ALL_TEST_CARDS = [
  bleedStrike,
  plainAttack,
  guard,
  charge3,
  charge16,
  pollute120,
  bigGuard,
  aoeAttack,
  expensive,
  twoHitCharge,
  testDischarge,
];

/* ---------------- 构建工具 ---------------- */

const content = loadGameContent().content;

function makeContent(traits: readonly TraitDefinition[] = []): ContentDb {
  return createContentDb({
    cards: new Map([...TEST_CARDS, ...ALL_TEST_CARDS].map((c) => [c.id, c])),
    enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(),
    traits: new Map(traits.map((t) => [t.id, t])),
  });
}

function battle(
  db: ContentDb,
  deck: readonly string[],
  traitId: string,
  over: Partial<BattleConfig> = {},
): BattleState {
  return reduce(
    createBattleState({
      battleId: "trait-test",
      seed: 7,
      player: { maxHp: 100, energy: 5 },
      enemies: [{ id: "dummy" }],
      deck,
      handSize: deck.length,
      content: db,
      traitId,
      ...over,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(
  state: BattleState,
  cardId: string,
  targetId: string | null = "dummy",
): { state: BattleState; events: readonly DomainEvent[] } {
  const index = handIndex(state, cardId);
  const r = reduce(state, {
    type: "PlayCard",
    actionId: `p-${cardId}-${state.cardsPlayedThisTurn}`,
    handIndex: index,
    ...(targetId ? { targetId } : {}),
  });
  return { state: r.state, events: r.events };
}

const TRAIT = {
  bloodthirst: content.traits.get("bloodthirst")!,
  ironhide: content.traits.get("ironhide_turtle")!,
  glass: content.traits.get("glass_cannon")!,
  mutation: content.traits.get("super_mutation")!,
};

/** 按事件类型收窄（DomainEvent 是判别联合，裸 filter 不窄化）。 */
function eventsOfType<T extends DomainEvent["type"]>(
  events: readonly DomainEvent[],
  type: T,
): Extract<DomainEvent, { type: T }>[] {
  return events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
}

/* ================================================================== */

describe("docs/58 §三 属性调整（与特性解耦）", () => {
  it("三职业基础血量：血械 70 / 炉心 50 / 锈语者 60", () => {
    expect(content.classes.get("bloodwright")?.player.maxHp).toBe(70);
    expect(content.classes.get("engineer")?.player.maxHp).toBe(50);
    expect(content.classes.get("rustspeaker")?.player.maxHp).toBe(60);
  });
});

describe("docs/58 §二 特性注册表与选择", () => {
  it("四档特性入库，归属职业正确（工程师二选一）", () => {
    expect([...content.traits.keys()].sort()).toEqual([
      "bloodthirst",
      "glass_cannon",
      "ironhide_turtle",
      "super_mutation",
    ]);
    expect(traitsForClass(content, "bloodwright").map((t) => t.id)).toEqual(["bloodthirst"]);
    expect(traitsForClass(content, "engineer").map((t) => t.id)).toEqual(["glass_cannon", "ironhide_turtle"]);
    expect(traitsForClass(content, "rustspeaker").map((t) => t.id)).toEqual(["super_mutation"]);
  });

  it("无特性开局 = 现版行为（traitId 为空、快照全 false）", () => {
    const state = battle(makeContent(), ["test_attack"], "");
    expect(state.traitId).toBeNull();
    expect(state.traitSnapshot).toEqual({
      pollutionAtStart: 0,
      tentacle: false,
      scythe: false,
      eye: false,
    });
  });
});

describe("docs/58 §四 血械·嗜血", () => {
  const db = makeContent([TRAIT.bloodthirst]);

  it("未造伤、未自伤 → 无力量时挂 1 层虚弱", () => {
    const state = battle(db, ["test_guard", "test_guard"], "bloodthirst");
    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    const weak = eventsOfType(r.events, "BuffApplied").filter((e) => e.buffId === "weak");
    expect(weak).toHaveLength(1);
    expect(weak[0]?.stacks).toBe(1);
  });

  it("未造伤、未自伤但有力量 → 力量 −1（不改挂虚弱）", () => {
    const state = battle(db, ["test_guard"], "bloodthirst");
    const withStrength = reduce(state, {
      type: "DebugCommand",
      actionId: "d",
      command: "add buff strength 2",
    }).state;
    const r = reduce(withStrength, { type: "EndTurn", actionId: "e" });
    expect(r.state.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(1);
    expect(r.state.player.buffs.some((b) => b.id === "weak")).toBe(false);
  });

  it("造伤 + 自伤同源 → min(⌊造伤/5⌋, ⌊自伤/5⌋)×2 层再生，且不触惩罚", () => {
    let state = battle(db, ["test_bleed_strike", "test_bleed_strike"], "bloodthirst");
    // 两张血契攻击：造伤 18、自伤 6 → min(3, 1) = 1 组 → 再生 2 层
    // （甲方 2026-10-08 平衡补丁：门槛 3/3 → 5/5，同一副牌从 4 层降到 2 层）
    state = play(state, "test_bleed_strike").state;
    state = play(state, "test_bleed_strike").state;
    expect(state.dealtDamageThisTurn).toBe(18);
    expect(state.selfHpSpentThisTurn).toBe(6);

    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    const regen = eventsOfType(r.events, "BuffApplied").filter((e) => e.buffId === "regeneration");
    expect(regen).toHaveLength(1);
    expect(regen[0]?.stacks).toBe(2);
    expect(eventsOfType(r.events, "BuffApplied").some((e) => e.buffId === "weak")).toBe(false);
  });

  it("门槛 5/5：双满 10+10 才是两组 → 4 层再生", () => {
    let state = battle(db, ["test_bleed_strike", "test_bleed_strike", "test_bleed_strike", "test_bleed_strike"], "bloodthirst");
    for (let i = 0; i < 4; i += 1) state = play(state, "test_bleed_strike").state;
    // 4 ×（造伤 9 / 自伤 3）= 造伤 36、自伤 12 → min(7, 2) = 2 组 → 4 层
    expect(state.dealtDamageThisTurn).toBe(36);
    expect(state.selfHpSpentThisTurn).toBe(12);
    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    const regen = eventsOfType(r.events, "BuffApplied").filter((e) => e.buffId === "regeneration");
    expect(regen[0]?.stacks).toBe(4);
  });

  it("门槛 5/5：单张 9 造伤 + 3 自伤 不够一组（旧门槛 3/3 会给）→ 无再生", () => {
    let state = battle(db, ["test_bleed_strike"], "bloodthirst");
    state = play(state, "test_bleed_strike").state;
    expect(state.dealtDamageThisTurn).toBe(9);
    expect(state.selfHpSpentThisTurn).toBe(3);
    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    expect(eventsOfType(r.events, "BuffApplied").some((e) => e.buffId === "regeneration")).toBe(false);
    // 但「造伤/自伤都没满 5」不等于惩罚段：两边都动过，不该吃虚弱
    expect(eventsOfType(r.events, "BuffApplied").some((e) => e.buffId === "weak")).toBe(false);
  });

  it("只造伤不自伤 → 不惩罚，也不给再生（木桶取短边）", () => {
    let state = battle(db, ["test_attack"], "bloodthirst");
    state = play(state, "test_attack").state;
    expect(state.dealtDamageThisTurn).toBe(7);
    expect(state.selfHpSpentThisTurn).toBe(0);
    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    expect(eventsOfType(r.events, "BuffApplied").some((e) => e.buffId === "regeneration")).toBe(false);
    expect(eventsOfType(r.events, "BuffApplied").some((e) => e.buffId === "weak")).toBe(false);
  });

  /* ---- 甲方 2026-10-08 职业平衡修订：低血段「回血 +1」/ 满血段「每回合给一张血契牌」 ---- */

  it("低血段：HP < 30% 时，每次回血 +1 点", () => {
    // 用 tank（只防御不攻击）隔离变量，免得 dummy 打掉的血把 HP 推出低血区
    const low = battle(db, ["test_guard"], "bloodthirst", {
      player: { maxHp: 100, energy: 5, hp: 29 },
      enemies: [{ id: "tank" }],
    });
    const withRegen = reduce(low, {
      type: "DebugCommand",
      actionId: "r",
      command: "add buff regeneration 2",
    }).state;
    const r = reduce(withRegen, { type: "EndTurn", actionId: "e" });
    const healed = eventsOfType(r.events, "HpHealed").filter((e) => e.targetId === "player");
    expect(healed.at(-1)?.value).toBe(3); // 2 层再生 + 低血 1
  });

  it("低血段：恰好 30% 不算低血，回血不加成", () => {
    const state = battle(db, ["test_guard"], "bloodthirst", {
      player: { maxHp: 100, energy: 5, hp: 30 },
      enemies: [{ id: "tank" }],
    });
    const withRegen = reduce(state, {
      type: "DebugCommand",
      actionId: "r",
      command: "add buff regeneration 2",
    }).state;
    const r = reduce(withRegen, { type: "EndTurn", actionId: "e" });
    const healed = eventsOfType(r.events, "HpHealed").filter((e) => e.targetId === "player");
    expect(healed.at(-1)?.value).toBe(2); // 只有再生本体
  });

  it("满血段：回合开始额外获得一张血契牌（不占常规抽牌额度）", () => {
    const full = battle(db, ["test_guard"], "bloodthirst", {
      player: { maxHp: 100, energy: 5, hp: 100 },
    });
    // 常规手牌 1 张（handSize = 牌组长度）+ 额外 1 张；
    // 测试池里唯一带血契代价的牌是 test_bleed_strike，所以必然是它。
    expect(full.piles.hand).toHaveLength(2);
    const extra = full.piles.hand.find((id) => full.cardInstances[id]?.cardId === "test_bleed_strike");
    expect(extra).toBeDefined();
  });

  it("满血段：只要掉了一点血，当回合就不再给牌", () => {
    const hurt = battle(db, ["test_guard"], "bloodthirst", {
      player: { maxHp: 100, energy: 5, hp: 99 },
    });
    expect(hurt.piles.hand).toHaveLength(1);
    expect(
      hurt.piles.hand.some((id) => hurt.cardInstances[id]?.cardId === "test_bleed_strike"),
    ).toBe(false);
  });
});

describe("docs/58 §五 炉心·铁皮王八（甲方 2026-10-07 修订）", () => {
  const db = makeContent([TRAIT.ironhide]);

  it("混合充能（docs/67 §2.2 T1）：攻击分到 ⌊充能/2⌋ 加伤，格挡仍吃满", () => {
    let state = battle(db, ["test_charge3", "test_attack"], "ironhide_turtle");
    state = play(state, "test_charge3").state;
    expect(state.player.charge).toBe(3);
    const r = play(state, "test_attack");
    const dmg = eventsOfType(r.events, "DamageDealt").find((e) => e.targetId === "dummy");
    expect(dmg?.hpLost).toBe(8); // 7 基础 + ⌊3/2⌋ = 1
  });

  it("充能改道：获得格挡 +充能层数", () => {
    let state = battle(db, ["test_charge3", "test_guard"], "ironhide_turtle");
    state = play(state, "test_charge3").state;
    const r = play(state, "test_guard");
    const block = eventsOfType(r.events, "BlockGained")[0];
    expect(block?.value).toBe(8); // 基础 5 + 充能 3
  });

  it("回合结束判定格挡：每 10 点折算 1 层荆棘（docs/67 §2.2 N2），且写成真状态（UI 才有图标）", () => {
    let state = battle(db, ["test_big_guard"], "ironhide_turtle");
    state = play(state, "test_big_guard").state;
    expect(state.player.block).toBe(24);
    // 判定只发生在回合末：局中格挡再多也不实时派生
    const mid = toDraft(state);
    expect(effectiveBrambleStacks(mid, mid.player)).toBe(0);

    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    const bramble = r.state.player.buffs.find((b) => b.id === "bramble");
    expect(bramble?.stacks).toBe(2); // ⌊24 / 10⌋
    // 荆棘是真 buff：有 BuffApplied 事件 → BuffRow 会渲染「荆」图标
    expect(eventsOfType(r.events, "BuffApplied").some((e) => e.buffId === "bramble")).toBe(true);
    expect(r.state.player.block).toBe(0); // 新回合格挡已清零，但荆棘层数不回收
    const d = toDraft(r.state);
    expect(effectiveBrambleStacks(d, d.player)).toBe(2);

    // 敌方回合攻击 → 真实反弹 2 层 × 3 = 6
    const thorn = eventsOfType(r.events, "DamageDealt").find(
      (e) => e.sourceId === "player" && e.targetId === "dummy",
    );
    expect(thorn?.value).toBe(6);
  });

  it("荆棘每回合**刷新**：同格挡不再涨层，不打格挡则下一次判定清零（甲方 2026-10-07 三次修订）", () => {
    let state = battle(db, ["test_big_guard"], "ironhide_turtle");

    // 第 1 回合：24 格挡 → ⌊24/10⌋ = 2 层
    state = play(state, "test_big_guard").state;
    state = reduce(state, { type: "EndTurn", actionId: "e1" }).state;
    expect(state.player.buffs.find((b) => b.id === "bramble")?.stacks).toBe(2);

    // 第 2 回合：还是 24 格挡 → 覆盖后仍是 2 层（旧版会累加成 4）
    state = play(state, "test_big_guard").state;
    state = reduce(state, { type: "EndTurn", actionId: "e2" }).state;
    expect(state.player.buffs.find((b) => b.id === "bramble")?.stacks).toBe(2);

    // 第 3 回合：一张格挡牌都不打（本回合格挡 = 0）→ 判定即把荆棘清零
    const r = reduce(state, { type: "EndTurn", actionId: "e3" });
    expect(r.state.player.buffs.some((b) => b.id === "bramble")).toBe(false);
    expect(eventsOfType(r.events, "BuffExpired").some((e) => e.buffId === "bramble")).toBe(true);
  });

  it("荆棘折算按**本回合**格挡：足 10 点才 1 层，不足 10 点 → 0 层", () => {
    // 一次 5 点格挡 = 不足 10 → 无荆棘
    let small = battle(db, ["test_guard"], "ironhide_turtle");
    small = reduce(play(small, "test_guard").state, { type: "EndTurn", actionId: "e" }).state;
    expect(small.player.buffs.some((b) => b.id === "bramble")).toBe(false);

    // 三张 5 点格挡 = 15 点 → ⌊15/10⌋ = 1 层
    let mid = battle(db, ["test_guard", "test_guard", "test_guard"], "ironhide_turtle");
    mid = play(mid, "test_guard").state;
    mid = play(mid, "test_guard").state;
    mid = play(mid, "test_guard").state;
    expect(mid.player.block).toBe(15);
    mid = reduce(mid, { type: "EndTurn", actionId: "e" }).state;
    expect(mid.player.buffs.find((b) => b.id === "bramble")?.stacks).toBe(1);
  });

  it("荆棘上限该特性开放至 7（docs/67 §2.2 N1；对照组 5），卡牌荆棘与折算层数一起封顶", () => {
    const state = battle(db, ["test_guard"], "ironhide_turtle");
    const d = toDraft(state);
    expect(brambleMaxStacks(d)).toBe(7);
    d.player.buffs = [{ id: "bramble", stacks: 12, duration: null }];
    expect(effectiveBrambleStacks(d, d.player)).toBe(7);
    d.player.buffs = [{ id: "bramble", stacks: 6, duration: null }];
    expect(effectiveBrambleStacks(d, d.player)).toBe(6);
  });

  it("对照组：无特性不折算荆棘，上限仍是 5", () => {
    const state = battle(makeContent(), ["test_big_guard"], "");
    const d = toDraft(state);
    expect(brambleMaxStacks(d)).toBe(5);
    expect(effectiveBrambleStacks(d, d.player)).toBe(0);

    const r = reduce(play(state, "test_big_guard").state, { type: "EndTurn", actionId: "e" });
    expect(r.state.player.buffs.some((b) => b.id === "bramble")).toBe(false);
    const after = toDraft(r.state);
    after.player.buffs = [{ id: "bramble", stacks: 9, duration: null }];
    expect(effectiveBrambleStacks(after, after.player)).toBe(5);
  });
});

describe("docs/58 §六 炉心·玻璃大炮（甲方 2026-10-07 二次修订）", () => {
  const db = makeContent([TRAIT.glass]);

  it("充能不触发过载清零；超出 10 的部分每 3 点 1 层超负荷（不再获得时即伤）", () => {
    const state = battle(db, ["test_charge16"], "glass_cannon");
    const r = play(state, "test_charge16");
    expect(r.state.player.charge).toBe(16); // 不清零
    expect(eventsOfType(r.events, "Overloaded")).toHaveLength(0);
    // 甲方 2026-10-09 加强：折算步长 5 → 3，⌊(16−10)/3⌋ = 2 层
    expect(r.state.player.buffs.find((b) => b.id === "overload")?.stacks).toBe(2);
    expect(eventsOfType(r.events, "HpLost")).toHaveLength(0); // 惩罚改到承载者回合开始
  });

  it("充能只当「弹药」：普通攻击不吃充能加伤，也不消耗充能", () => {
    let state = battle(db, ["test_charge3", "test_attack"], "glass_cannon");
    state = play(state, "test_charge3").state; // 充能 3（未过 10 → 无超负荷）
    const r = play(state, "test_attack");
    const dmg = eventsOfType(r.events, "DamageDealt").find((e) => e.targetId === "dummy");
    expect(dmg?.hpLost).toBe(7); // 7 基础，不含充能
    expect(r.state.player.charge).toBe(3);
  });

  it("没有超负荷时：第一张攻击牌不爆发——不消耗充能、不转嫁，充能继续攒", () => {
    let state = battle(db, ["test_charge3", "test_charge3", "test_attack"], "glass_cannon");
    state = play(state, "test_charge3").state; // 3
    state = play(state, "test_charge3").state; // 6（仍未过 10）
    const r = play(state, "test_attack");
    const dmg = eventsOfType(r.events, "DamageDealt").find((e) => e.targetId === "dummy");
    expect(dmg?.hpLost).toBe(7);
    expect(r.state.player.charge).toBe(6);
    expect(r.state.player.buffs.some((b) => b.id === "overload")).toBe(false);
  });

  it("超负荷只结算新跨过的层数：16→19→22 依次是 2 / 3 / 4 层（每 +3 充能补 1 层）", () => {
    let state = battle(db, ["test_charge16", "test_charge3", "test_charge3"], "glass_cannon");
    const stackOf = (s: BattleState): number => s.player.buffs.find((b) => b.id === "overload")?.stacks ?? 0;
    state = play(state, "test_charge16").state; // 16 → ⌊(16−10)/3⌋ = 2
    expect(stackOf(state)).toBe(2);
    state = play(state, "test_charge3").state; // 19 → ⌊9/3⌋ = 3
    expect(stackOf(state)).toBe(3);
    state = play(state, "test_charge3").state; // 22 → ⌊12/3⌋ = 4（只补 1）
    expect(stackOf(state)).toBe(4);
  });

  it("超负荷每层让承载者受到的伤害 +1（加区，敌我同构）", () => {
    let state = battle(db, ["test_charge16", "test_attack", "test_attack"], "glass_cannon");
    state = play(state, "test_charge16").state; // 自身 2 层超负荷
    state = play(state, "test_attack").state; // 首张攻击牌：一波打出去 → 转嫁给 dummy
    const dummy = state.enemies[0]!;
    expect(dummy.buffs.find((b) => b.id === "overload")?.stacks).toBe(2);

    const r = play(state, "test_attack");
    const dmg = eventsOfType(r.events, "DamageDealt").find((e) => e.targetId === "dummy");
    expect(dmg?.hpLost).toBe(9); // 7 基础 + 2（敌方超负荷受伤 +2）
  });

  it("承载者回合开始每层扣 1 点生命（docs/67 §2.1 B2）：玩家侧", () => {
    let state = battle(db, ["test_charge16", "test_guard"], "glass_cannon");
    state = play(state, "test_charge16").state; // 2 层超负荷
    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    const overload = eventsOfType(r.events, "HpLost").filter((e) => e.reason === "overload");
    expect(overload).toHaveLength(1);
    expect(overload[0]?.value).toBe(2); // 2 层 × 1
    // 同一时刻敌方打过来：玩家扛超负荷 → 受击伤害也 +2（5 → 7）
    const hit = eventsOfType(r.events, "HpLost").filter((e) => e.reason === "damage");
    expect(hit.reduce((s, e) => s + e.value, 0)).toBe(7);
  });

  it("承载者回合开始每层扣 1 点生命（docs/67 §2.1 B2）：敌方侧", () => {
    let state = battle(db, ["test_charge16", "test_attack"], "glass_cannon");
    state = play(state, "test_charge16").state;
    state = play(state, "test_attack").state; // 转嫁 2 层给 dummy
    const r = reduce(state, { type: "EndTurn", actionId: "e" });
    const overload = eventsOfType(r.events, "HpLost").filter(
      (e) => e.reason === "overload" && e.targetId === "dummy",
    );
    expect(overload).toHaveLength(1);
    expect(overload[0]?.value).toBe(2);
  });

  it("一波打出去：**先转嫁超负荷、再结算伤害**（转嫁到手的「受伤 +1」算进这一击）", () => {
    let state = battle(db, ["test_charge16", "test_attack", "test_attack"], "glass_cannon");
    state = play(state, "test_charge16").state; // 充能 16 → 自身 2 层超负荷
    // 压低 HP：满血时 A2 的回血会被上限吃掉、连事件都不发，看不到效果
    const hpBefore = state.player.maxHp - 20;
    state = { ...state, player: { ...state.player, hp: hpBefore } };
    const first = play(state, "test_attack");
    const firstDmg = eventsOfType(first.events, "DamageDealt").find((e) => e.targetId === "dummy");
    // docs/67 §2.1 A1：7 基础 + 16 充能爆发 + 2 层 × 5（burstPerStack）+ 2（转嫁过去的超负荷受伤 +2）= 35
    expect(firstDmg?.hpLost).toBe(35);
    // A2：爆发 = 泄压——按转嫁的 2 层 × burstHealPerStack 5 回血
    const burstHeal = eventsOfType(first.events, "HpHealed").reduce((s, e) => s + e.value, 0);
    expect(burstHeal).toBe(10);
    expect(first.state.player.hp).toBe(hpBefore + 10);
    // 转嫁必须发生在伤害之前：事件流里 BuffExpired(先) 先于 DamageDealt(后)
    const order = first.events.map((e) => e.type);
    expect(order.indexOf("BuffExpired")).toBeLessThan(order.indexOf("DamageDealt"));
    expect(first.state.player.charge).toBe(0);
    // 超负荷整体转嫁：自身清零、目标获得同等层数
    expect(first.state.player.buffs.some((b) => b.id === "overload")).toBe(false);
    expect(first.state.enemies[0]?.buffs.find((b) => b.id === "overload")?.stacks).toBe(2);
    expect(eventsOfType(first.events, "BuffExpired").some((e) => e.buffId === "overload")).toBe(true);

    // 第二张攻击不再吃充能
    const second = play(first.state, "test_attack");
    const secondDmg = eventsOfType(second.events, "DamageDealt").find((e) => e.targetId === "dummy");
    expect(secondDmg?.hpLost).toBe(9); // 7 + 2（dummy 身上的超负荷）
  });

  it("一波打出去打全体：AoE 时每个敌人各得一份超负荷", () => {
    let state = battle(db, ["test_charge16", "test_aoe"], "glass_cannon", {
      enemies: [{ id: "dummy" }, { id: "tank" }],
    });
    state = play(state, "test_charge16").state;
    const r = play(state, "test_aoe", null);
    expect(r.state.player.buffs.some((b) => b.id === "overload")).toBe(false);
    for (const enemy of r.state.enemies) {
      expect(enemy.buffs.find((b) => b.id === "overload")?.stacks).toBe(2);
    }
  });

  // 甲方 2026-10-09 实机修正：旧版在卡牌结算**之前**抽空充能，
  // 导致「充能 ≥N 时额外造成…」的条件读到 0，第二段直接不发（活塞冲拳实机只打出一段）。
  it("先让卡牌算完，再抽空充能：充能条件段照发，段间衰减照吃", () => {
    let state = battle(db, ["test_charge16", "test_two_hit_charge"], "glass_cannon");
    state = play(state, "test_charge16").state; // 16 充能 → 2 层超负荷
    const r = play(state, "test_two_hit_charge");
    const dmg = eventsOfType(r.events, "DamageDealt").filter((e) => e.targetId === "dummy");
    expect(dmg).toHaveLength(2); // 旧版只会有一段
    // 段 1：3 基础 + 2（转嫁过去的超负荷）+ 26（16 充能 + 2 层 × 5）= 31
    // 段 2：基础 5 + 2 不动，**充能那 26 点按连续攻击衰减 ×0.5** → 5 + 2 + 13 = 20
    expect(dmg.map((d) => d.hpLost)).toEqual([31, 20]);
    expect(r.state.player.charge).toBe(0); // 爆发之后才清零
  });

  it("自耗充能的牌：先按卡牌自己的汇率兑现，特性只再补超负荷折功（充能只算一遍）", () => {
    let state = battle(db, ["test_charge16", "test_discharge"], "glass_cannon");
    state = play(state, "test_charge16").state;
    const r = play(state, "test_discharge");
    const dmg = eventsOfType(r.events, "DamageDealt").filter((e) => e.targetId === "dummy");
    // 基础段 2 + 2（转嫁过去的超负荷受伤 +2）+ 超负荷折功 10 = 14；自家泄能 16 × 1 = 16 → 合计 30
    // （旧版是 2 + 2 + 26 = 30：总数相同，但充能全被特性吃掉、卡牌自己一点没兑现）
    expect(dmg.reduce((s, d) => s + d.hpLost, 0)).toBe(30);
    expect(r.state.player.charge).toBe(0);
  });

  it("对照组：无特性时充能超 10 会过载清零 + 5 反噬", () => {
    const state = battle(makeContent(), ["test_charge16"], "");
    const r = play(state, "test_charge16");
    expect(eventsOfType(r.events, "Overloaded").length).toBeGreaterThan(0);
    expect(r.state.player.charge).toBe(0);
    const lost = eventsOfType(r.events, "HpLost").reduce((sum, e) => sum + e.value, 0);
    expect(lost).toBe(5);
  });

  it("蓄势：每回合开始（含第 1 回合）充能 <10 时额外 +1 能量（甲方 2026-10-07 三次修订）", () => {
    // 开局充能恒为 0 → 第 1 回合就是基础 5 + 1 = 6
    let state = battle(db, ["test_charge3", "test_guard"], "glass_cannon");
    expect(state.player.energy).toBe(6);

    // 第 2 回合开始时充能 3（仍 <10）→ 照旧 6 点
    state = play(state, "test_charge3").state;
    const t2 = reduce(state, { type: "EndTurn", actionId: "e" }).state;
    expect(t2.player.charge).toBe(3);
    expect(t2.player.energy).toBe(6);

    // 对照组：无特性不享受这 1 点
    const plain = battle(makeContent(), ["test_guard"], "");
    expect(plain.player.energy).toBe(5);
  });

  it("蓄势：充能攒到 ≥10 后，从该回合起断供", () => {
    let state = battle(db, ["test_charge16", "test_guard"], "glass_cannon");
    expect(state.player.energy).toBe(6); // 开局充能 0 → +1
    state = play(state, "test_charge16").state; // 充能 16（已过阈值）
    const t2 = reduce(state, { type: "EndTurn", actionId: "e" }).state;
    expect(t2.player.charge).toBe(16);
    expect(t2.player.energy).toBe(5); // 充能 ≥10 → 不再 +1
  });
});

describe("docs/58 §七 锈语者·超级大畸变", () => {
  const db = makeContent([TRAIT.mutation]);

  it("污染无上限：越过 100 的整数倍立即反噬一次，且不清零", () => {
    const state = battle(db, ["test_pollute120"], "super_mutation");
    const r = play(state, "test_pollute120");
    expect(r.state.player.pollution).toBe(120);
    const lost = eventsOfType(r.events, "HpLost").filter((e) => e.reason === "pollution");
    expect(lost).toHaveLength(1);
    expect(lost[0]?.value).toBe(10);
  });

  it("对照组：无特性时污染封顶 100 → 触顶反噬并清零", () => {
    const state = battle(makeContent(), ["test_pollute120"], "");
    const r = play(state, "test_pollute120");
    expect(r.state.player.pollution).toBe(0);
    const lost = eventsOfType(r.events, "HpLost").filter((e) => e.reason === "pollution");
    expect(lost.reduce((s, e) => s + e.value, 0)).toBe(10);
  });

  it("开局快照阈值：≥200 触手 / ≥300 大鲨臂 / ≥400 神眼（只开局判定）", () => {
    const at = (pollution: number): BattleState =>
      battle(db, ["test_attack"], "super_mutation", {
        player: { maxHp: 100, energy: 5, pollution },
      });
    expect(at(199).traitSnapshot).toMatchObject({ tentacle: false, scythe: false, eye: false });
    expect(at(200).traitSnapshot).toMatchObject({ tentacle: true, scythe: false, eye: false });
    expect(at(300).traitSnapshot).toMatchObject({ tentacle: true, scythe: true, eye: false });
    expect(at(400).traitSnapshot).toMatchObject({ tentacle: true, scythe: true, eye: true });
  });

  it("触手：每回合第一张牌免能（费用按 0 计）", () => {
    const state = battle(db, ["test_expensive"], "super_mutation", {
      player: { maxHp: 100, energy: 1, pollution: 200 },
    });
    expect(previewEnergyCost(state, handIndex(state, "test_expensive"))).toBe(0);
    expect(validatePlayCardState(state, handIndex(state, "test_expensive"), "dummy").ok).toBe(true);
  });

  it("快照未达阈值时触手 / 大鲨臂都不生效（阈值只在开局判定）", () => {
    const state = battle(db, ["test_expensive", "test_attack"], "super_mutation", {
      player: { maxHp: 100, energy: 3, pollution: 0 },
    });
    // 触手未解锁 → 费用照常
    expect(previewEnergyCost(state, handIndex(state, "test_expensive"))).toBe(3);
    // 大鲨臂未解锁 → 首张牌只结算一次
    const r = play(state, "test_attack");
    const hits = eventsOfType(r.events, "DamageDealt").filter((e) => e.targetId === "dummy");
    expect(hits.reduce((s, e) => s + e.hpLost, 0)).toBe(7);
  });

  it("大鲨臂：每回合第一张牌结算两次", () => {
    const state = battle(db, ["test_attack"], "super_mutation", {
      player: { maxHp: 100, energy: 5, pollution: 300 },
    });
    const r = play(state, "test_attack");
    const hits = eventsOfType(r.events, "DamageDealt").filter((e) => e.targetId === "dummy");
    expect(hits.reduce((s, e) => s + e.hpLost, 0)).toBe(14); // 7 × 2
  });

  it("神眼：开局 ≥400 才解锁，且每回合限一次", () => {
    const locked = battle(db, ["test_attack"], "super_mutation", {
      player: { maxHp: 100, energy: 5, pollution: 300 },
      handSize: 1,
    });
    expect(eyeAvailable(locked)).toBe(false);

    const state = battle(db, ["test_attack", "test_guard"], "super_mutation", {
      player: { maxHp: 100, energy: 5, pollution: 400 },
      handSize: 1,
    });
    expect(eyeAvailable(state)).toBe(true);

    const target = state.piles.draw[0]!;
    const r = reduce(state, { type: "PickFromDraw", actionId: "eye", instanceId: target });
    expect(r.state.piles.hand).toContain(target);
    expect(r.state.piles.draw).not.toContain(target);
    expect(eyeAvailable(r.state)).toBe(false); // 本回合名额已用

    // 回合翻转后名额恢复
    const next = reduce(r.state, { type: "EndTurn", actionId: "e" }).state;
    expect(eyeAvailable(next)).toBe(true);
  });

  it("战斗胜利：污染 ≥180 才扣 50，跌回线下不扣（甲方 2026-10-08 修订）", () => {
    const below = battle(db, ["test_attack"], "super_mutation", {
      player: { maxHp: 100, energy: 5, pollution: 179 },
    });
    const r1 = reduce(below, { type: "DebugCommand", actionId: "k", command: "kill dummy" });
    expect(r1.state.phase).toBe("battleEnd");
    expect(r1.state.player.pollution).toBe(179); // 差 1 点都不给

    const at = battle(db, ["test_attack"], "super_mutation", {
      player: { maxHp: 100, energy: 5, pollution: 180 },
    });
    const r2 = reduce(at, { type: "DebugCommand", actionId: "k", command: "kill dummy" });
    expect(r2.state.phase).toBe("battleEnd");
    expect(r2.state.player.pollution).toBe(130); // 踩线即扣 50
  });

  it("战斗胜利：无特性时污染不因胜利变化（对照组）", () => {
    const state = battle(db, ["test_attack"], "", {
      player: { maxHp: 100, energy: 5, pollution: 90 },
    });
    const r = reduce(state, { type: "DebugCommand", actionId: "k", command: "kill dummy" });
    expect(r.state.player.pollution).toBe(90);
  });
});
