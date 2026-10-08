import { describe, expect, it } from "vitest";
import { previewEnergyCost, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition, type ContentDb, type EnemyDefinition } from "@/core/registry";
import { handIndex, startState, testConfig, testContent } from "../helpers/combat";

/**
 * docs/49 Phase 2a · 九相后半（玩家侧诅咒降临）：冰缓 / 颠倒 / 眩晕 / 灼烧 + 三张新卡。
 * 分裂按 §四 保持锁定，本文件不测。
 */

const buffSelf = (id: string, cardId: string, stacks: number): CardDefinition => ({
  id: cardId,
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "applyBuff", target: { type: "self" }, buff: id as never, stacks }],
});
const buffEnemy = (id: string, cardId: string, stacks: number): CardDefinition => ({
  id: cardId,
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: id as never, stacks }],
});

const CARDS: CardDefinition[] = [
  buffSelf("chill", "self_chill", 2),
  buffSelf("burn", "self_burn", 2),
  buffSelf("reverse", "self_reverse", 2),
  buffSelf("stun", "self_stun", 1),
  buffEnemy("chill", "foe_chill", 3),
  buffEnemy("reverse", "foe_reverse", 2),
  buffEnemy("stun", "foe_stun", 1),
];

const ENEMIES: EnemyDefinition[] = [
  { id: "idle", name: "Idle", maxHp: 500, intents: [{ intent: { kind: "defend", value: 1 }, weight: 1 }] },
  { id: "hitter", name: "Hitter", maxHp: 500, intents: [{ intent: { kind: "attack", value: 5 }, weight: 1 }] },
  {
    id: "elite_test",
    name: "Elite",
    maxHp: 500,
    stunResistant: true,
    intents: [{ intent: { kind: "attack", value: 5 }, weight: 1 }],
  },
];

function content(): ContentDb {
  const base = testContent();
  return createContentDb({
    cards: new Map([...base.cards, ...CARDS.map((c) => [c.id, c] as const)]),
    enemies: new Map([...base.enemies, ...ENEMIES.map((e) => [e.id, e] as const)]),
    enhancements: new Map(),
  });
}

function start(deck: string[], enemy = "idle", maxHp = 66): BattleState {
  return startState(testConfig({ deck: [...deck, "strike", "strike"], enemies: [{ id: enemy }], content: content(), player: { maxHp, energy: 3 } }));
}

/** 打出一张 0 费测试牌（自带手牌索引）。 */
function play(s: BattleState, cardId: string): BattleState {
  const def = CARDS.find((c) => c.id === cardId);
  if (def) return reduce(s, { type: "PlayCard", actionId: "p", handIndex: handIndex(s, cardId) }).state;
  return s;
}

describe("docs/49 Phase 2a · 冰缓 chill", () => {
  it("玩家：手牌费用 +1；回合开始 −1 层，归零即恢复原价", () => {
    let s = start(["self_chill", "strike"]);
    s = play(s, "self_chill");
    expect(s.player.buffs.find((b) => b.id === "chill")?.stacks).toBe(2);
    expect(previewEnergyCost(s, handIndex(s, "strike"))).toBe(2); // 打击 1 + 冰缓 1

    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.player.buffs.find((b) => b.id === "chill")?.stacks).toBe(1);
    expect(previewEnergyCost(s, handIndex(s, "strike"))).toBe(2);

    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.player.buffs.find((b) => b.id === "chill")).toBeUndefined();
    expect(previewEnergyCost(s, handIndex(s, "strike"))).toBe(1);
  });

  it("敌人：冰缓期间造伤 ×0.8", () => {
    let s = start(["foe_chill", "strike"], "hitter");
    s = play(s, "foe_chill");
    expect(s.enemies[0].buffs.find((b) => b.id === "chill")?.stacks).toBe(3);
    const before = s.player.hp;
    const after = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    // 5 × 0.8 = 4（round）
    expect(before - after.player.hp).toBe(4);
  });
});

describe("docs/49 Phase 2a · 颠倒 reverse", () => {
  it("玩家：回合开始把手牌费用覆盖为 0~3（同回合内稳定）", () => {
    let s = start(["self_reverse", "big", "big"]);
    s = play(s, "self_reverse");
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    const idx = handIndex(s, "big");
    const first = previewEnergyCost(s, idx);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(3);
    // 同一回合内再问一次必须一样（不是每次渲染重掷）
    expect(previewEnergyCost(s, idx)).toBe(first);
  });

  it("敌人：意图数值被随机化并打上 fuzzed 标记", () => {
    let s = start(["foe_reverse", "strike"], "hitter");
    s = play(s, "foe_reverse");
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    const intent = s.enemies[0].intent;
    expect(intent?.fuzzed).toBe(true);
    // 5 的 50%~150% → 3~8
    expect(intent?.value ?? 0).toBeGreaterThanOrEqual(3);
    expect(intent?.value ?? 0).toBeLessThanOrEqual(8);
  });
});

describe("docs/49 Phase 2a · 眩晕 stun", () => {
  it("玩家：被眩晕的回合不可出牌，但仍可结束回合", () => {
    let s = start(["self_stun", "strike"]);
    s = play(s, "self_stun");
    const hand = s.piles.hand.length;
    const next = reduce(s, { type: "PlayCard", actionId: "p2", handIndex: 0 }).state;
    expect(next.piles.hand.length).toBe(hand); // 出牌被拒
    const ended = reduce(next, { type: "EndTurn", actionId: "e" }).state;
    expect(ended.player.buffs.find((b) => b.id === "stun")).toBeUndefined();
  });

  it("敌人：跳过行动并清空意图", () => {
    let s = start(["foe_stun", "strike"], "hitter");
    s = play(s, "foe_stun");
    const before = s.player.hp;
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.player.hp).toBe(before); // 攻击没有打出来
    expect(s.enemies[0].buffs.find((b) => b.id === "stun")).toBeUndefined();
  });

  it("眩晕抗性：精英首次被眩晕后，本场免疫后续", () => {
    let s = start(["foe_stun", "foe_stun", "strike"], "elite_test");
    s = play(s, "foe_stun");
    expect(s.enemies[0].buffs.find((b) => b.id === "stun")?.stacks).toBe(1);
    const res = reduce(s, { type: "PlayCard", actionId: "p2", handIndex: handIndex(s, "foe_stun") });
    expect(res.events.some((e) => e.type === "StunResisted")).toBe(true);
    // 第二次不再刷新（refreshOnly 恒为 1），但也不会叠加
    expect(res.state.enemies[0].buffs.find((b) => b.id === "stun")?.stacks).toBe(1);
  });
});

describe("docs/49 Phase 2a · 灼烧 burn", () => {
  it("每层每回合扣 1 点生命上限，超出部分从当前 HP 扣", () => {
    let s = start(["self_burn", "strike"], "idle", 20);
    s = play(s, "self_burn");
    expect(s.player.maxHp).toBe(20);
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.player.maxHp).toBe(18);
    expect(s.player.hp).toBe(18);
  });

  it("带灼烧时生命恢复 −50%（向下取整）：4 层再生只回 2 点", () => {
    let s = start(["self_burn", "strike"], "idle", 40);
    s = play(s, "self_burn"); // 2 层灼烧
    s = reduce(s, { type: "DebugCommand", actionId: "hp", command: "set hp 20" }).state;
    s = reduce(s, { type: "DebugCommand", actionId: "regen", command: "add buff regeneration 4" }).state;
    const r = reduce(s, { type: "EndTurn", actionId: "e" });
    const healed = r.events.filter(
      (e): e is Extract<(typeof r.events)[number], { type: "HpHealed" }> =>
        e.type === "HpHealed" && e.targetId === "player",
    );
    expect(healed.at(-1)?.value).toBe(2); // 4 → 2
  });

  it("没有灼烧时回血不打折（对照组）", () => {
    let s = start(["strike", "strike"], "idle", 40);
    s = reduce(s, { type: "DebugCommand", actionId: "hp", command: "set hp 20" }).state;
    s = reduce(s, { type: "DebugCommand", actionId: "regen", command: "add buff regeneration 4" }).state;
    const r = reduce(s, { type: "EndTurn", actionId: "e" });
    const healed = r.events.filter(
      (e): e is Extract<(typeof r.events)[number], { type: "HpHealed" }> =>
        e.type === "HpHealed" && e.targetId === "player",
    );
    expect(healed.at(-1)?.value).toBe(4);
  });

  it("战斗结束时上限恢复、已损失的当前 HP 不补", () => {
    let s = start(["self_burn", "strike"], "idle", 20);
    s = play(s, "self_burn");
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.player.maxHp).toBe(18);
    // 把敌人打死 → 战斗结束
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 1 })) };
    s = reduce(s, { type: "PlayCard", actionId: "kill", handIndex: handIndex(s, "strike") }).state;
    expect(s.phase).toBe("battleEnd");
    expect(s.player.maxHp).toBe(20);
    expect(s.player.hp).toBeLessThanOrEqual(18);
  });
});

describe("docs/49 Phase 2a · 三张新卡（真实数据）", () => {
  it("卡面：锈咒 / 谵语 / 震爆锤", async () => {
    const { loadGameContent } = await import("@/data/load");
    const game = loadGameContent();
    const rust = game.content.cards.get("rust_curse");
    const raving = game.content.cards.get("raving");
    const hammer = game.content.cards.get("shockhammer");
    expect((rust?.effects ?? []).some((e) => e.kind === "applyBuff" && e.buff === "burn")).toBe(true);
    expect((raving?.effects ?? []).some((e) => e.kind === "applyBuff" && e.buff === "reverse")).toBe(true);
    expect((hammer?.effects ?? []).some((e) => e.kind === "applyBuff" && e.buff === "stun")).toBe(true);
    // docs/46 §3.5：玩家侧眩晕只允许稀有卡
    expect(hammer?.rarity).toBe("rare");
    // 血痂已按 docs/49 §3.1 删除，荆棘血痂接管定位
    expect(game.content.cards.has("blood_scab")).toBe(false);
    expect(game.content.cards.get("thornscab")?.effects?.[0]).toMatchObject({ buff: "bramble", stacks: 2 });
  });

  it("血痂删除后不再出现在任何奖池（图鉴/掉落只剩旧卡）", async () => {
    const { loadGameContent } = await import("@/data/load");
    const game = loadGameContent();
    const ids = [...game.content.cards.keys()];
    expect(ids).not.toContain("blood_scab");
    expect(ids).toContain("thornscab");
  });
});
