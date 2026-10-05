import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { createContentDb, type EnemyDefinition } from "@/core/registry";

const BOSS: EnemyDefinition = {
  id: "boss",
  name: "Boss",
  maxHp: 100,
  intents: [{ intent: { kind: "charge", value: 2 }, weight: 1, thenIntent: { kind: "attack", value: 20 } }],
};

const content = createContentDb({
  cards: new Map(),
  enemies: new Map([["boss", BOSS]]),
  enhancements: new Map(),
  relics: new Map(),
});

describe("Boss 蓄力 → 大招（策划 Q13）", () => {
  it("蓄力揭示带 thenValue，且下一意图被强制为指定大招", () => {
    const started = reduce(
      createBattleState({
        battleId: "b",
        seed: 1,
        player: { maxHp: 66, energy: 3 },
        enemies: [{ id: "boss" }],
        deck: ["x", "x", "x", "x", "x"],
        handSize: 5,
        content,
      }),
      { type: "Noop", actionId: "s" },
    ).state;

    expect(started.enemies[0].intent?.kind).toBe("charge");
    expect(started.enemies[0].intent?.thenValue).toBe(20);
    expect(started.enemies[0].forcedIntent).toEqual({ kind: "attack", value: 20 });

    const after = reduce(started, { type: "EndTurn", actionId: "e" });
    expect(after.state.enemies[0].intent).toEqual({ kind: "attack", value: 20 });
    expect(after.state.enemies[0].forcedIntent).toBeNull();
    const revealed = after.events.filter((e) => e.type === "IntentRevealed");
    expect(revealed).toHaveLength(1);
  });

  it("锈喉数值：一阶段蓄力接 16，二阶段蓄力接 24（数据校验）", async () => {
    const { loadGameContent } = await import("@/data/load");
    const boss = loadGameContent().content.enemies.get("rust_throat");
    expect(boss).toBeDefined();
    const charges = boss!.intents.filter((e) => e.intent.kind === "charge");
    expect(charges.map((c) => c.thenIntent?.value)).toEqual([16, 24]);
    expect(boss!.intents.some((e) => e.condition?.type === "selfHpBelow")).toBe(true);
  });
});
