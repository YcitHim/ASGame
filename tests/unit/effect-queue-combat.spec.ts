import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, registerEnhancementHandler, type EnhancementDefinition } from "@/core/registry";
import { TEST_CARDS, TEST_ENEMIES } from "../helpers/combat";

/**
 * P1（0.5）栈式队列接入实战结算的回归：
 * - 连锁动作只入栈、LIFO 中途插入（onHit 紧跟在触发它的那一段之后）
 * - 单位死亡时清除队列中所有以它为目标的挂起动作，并把真实数量回填到 UnitDied.clearedEffects
 */

registerEnhancementHandler({
  id: "bloodrage",
  onHit: () => [{ kind: "damage", target: { type: "chosenEnemy" }, value: 1 }],
});

const ENHANCEMENTS: EnhancementDefinition[] = [
  {
    id: "boil",
    tier: 2,
    appliesTo: ["strike"],
    handler: "bloodboil",
    params: { condition: { type: "hpBelow", percent: 50 }, hits: 3, split: [0.4, 0.3, 0.3] },
  },
  { id: "spark", tier: 1, appliesTo: ["strike"], handler: "bloodrage", params: {} },
];

function content() {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    // 2 HP 的靶子：多段的第一段就能击杀，用于验证"死亡清理"
    enemies: new Map([
      ...TEST_ENEMIES.map((e) => [e.id, e] as const),
      ["tinydummy", { id: "tinydummy", name: "Tiny", maxHp: 2, intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }] }],
    ]),
    enhancements: new Map(ENHANCEMENTS.map((e) => [e.id, e])),
    relics: new Map(),
  });
}

function battle(
  deck: (string | { cardId: string; enhancements: string[] })[],
  enemyId = "dummy",
): BattleState {
  return reduce(
    createBattleState({
      battleId: "t",
      seed: 99,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: enemyId }],
      deck,
      content: content(),
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string, targetId = "dummy") {
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
  return reduce(state, { type: "PlayCard", actionId: "p", handIndex: index, targetId });
}

describe("P1 栈式队列 · 实战结算", () => {
  it("中途插入：多段的每一段后立刻结算 onHit 连锁，且不打断后续段序", () => {
    const started = battle([{ cardId: "strike", enhancements: ["boil", "spark"] }]);
    const low = reduce(started, { type: "DebugCommand", actionId: "d", command: "set hp 20" }).state;
    const result = play(low, "strike");

    const hits = result.events.filter((e) => e.type === "DamageDealt");
    // 主段(1/2/3) 与 spark 连锁(段恒为1) 交替：1,1,2,1,3,1
    expect(hits.map((h) => h.segment)).toEqual([1, 1, 2, 1, 3, 1]);
  });

  it("死亡清理：首段击杀后，剩余挂起段被移除并回填真实 clearedEffects", () => {
    const state = battle(["bloodflail"], "tinydummy");
    const result = play(state, "bloodflail", "tinydummy");

    const died = result.events.find((e) => e.type === "UnitDied");
    expect(died).toBeDefined();
    expect(died?.type === "UnitDied" ? died.clearedEffects : 0).toBe(2);
    // 只有第一段真正结算，后两段随死亡清理一并取消
    expect(result.events.filter((e) => e.type === "DamageDealt")).toHaveLength(1);
    expect(result.state.enemies[0].hp).toBe(0);
  });

  it("队列未挂起动作时 clearedEffects 保持 0（不虚构清理数）", () => {
    const state = battle(["big"], "tinydummy");
    const result = play(state, "big", "tinydummy");
    const died = result.events.find((e) => e.type === "UnitDied");
    expect(died?.type === "UnitDied" ? died.clearedEffects : -1).toBe(0);
  });
});
