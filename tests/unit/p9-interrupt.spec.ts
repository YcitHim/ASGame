import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { createContentDb, type EnemyDefinition } from "@/core/registry";
import { TEST_CARDS, handIndex } from "../helpers/combat";

/** docs/38 §三 C-1 · 打断蓄力。 */

function charger(immune = false): EnemyDefinition {
  return {
    id: "charger",
    name: "Charger",
    maxHp: 60,
    ...(immune ? { interruptImmune: true } : {}),
    intents: [
      {
        intent: {
          kind: "charge",
          value: 1,
          thenIntent: { kind: "attack", value: 9 },
        },
        weight: 1,
      },
    ],
  };
}

function contentWith(immune = false) {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map([[charger(immune).id, charger(immune)]]),
    enhancements: new Map(),
  });
}

function start(immune = false) {
  const content = contentWith(immune);
  const state = reduce(
    createBattleState({
      battleId: "t",
      seed: 99,
      player: { maxHp: 66, energy: 9 },
      enemies: [{ id: "charger" }],
      deck: ["weaken", "expose", "strike", "strike"],
      handSize: 4,
      content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
  return state;
}

function play(state: ReturnType<typeof start>, cardId: string) {
  return reduce(state, {
    type: "PlayCard",
    actionId: "p-" + cardId,
    handIndex: handIndex(state, cardId),
    targetId: "charger",
  });
}

describe("1.0-C 打断蓄力", () => {
  it("虚弱命中蓄力链 → 断链：意图作废、剩余链清空、发事件", () => {
    let state = start();
    expect(state.enemies[0].intent?.kind).toBe("charge");
    expect(state.enemies[0].forcedChain).toHaveLength(1);
    const result = play(state, "weaken");
    state = result.state;
    expect(result.events.some((e) => e.type === "ChargeInterrupted")).toBe(true);
    expect(state.enemies[0].intent?.kind).toBe("unknown");
    expect(state.enemies[0].forcedChain).toHaveLength(0);
    expect(state.enemies[0].interruptsTaken).toBe(1);
  });

  it("易伤同样断链；断链后敌方回合不再释放蓄力伤害", () => {
    let state = start();
    const hp0 = state.player.hp;
    state = play(state, "expose").state;
    expect(state.enemies[0].intent?.kind).toBe("unknown");
    state = reduce(state, { type: "EndTurn", actionId: "e" }).state;
    // 原本会 9 点释放；断链后本回合空转（可能受其他意图 0 伤害）
    expect(hp0 - state.player.hp).toBe(0);
  });

  it("Boss 例外：interruptImmune 的敌人免疫断链", () => {
    let state = start(true);
    state = play(state, "weaken").state;
    expect(state.enemies[0].intent?.kind).toBe("charge");
    expect(state.enemies[0].interruptsTaken).toBe(0);
  });

  it("每场最多断链 2 次（护栏）", () => {
    let state = start();
    state = { ...state, enemies: [{ ...state.enemies[0], interruptsTaken: 2 }] };
    const result = play(state, "weaken");
    expect(result.events.some((e) => e.type === "ChargeInterrupted")).toBe(false);
    expect(result.state.enemies[0].intent?.kind).toBe("charge");
  });
});
