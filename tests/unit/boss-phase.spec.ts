import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { buildChargeChain } from "@/core/intents";
import { createContentDb, type EnemyDefinition } from "@/core/registry";

const BOSS: EnemyDefinition = {
  id: "boss",
  name: "Boss",
  maxHp: 100,
  intents: [
    {
      // Boss 例外（docs/18 Q2）：写死释放值，绕过叠加公式
      intent: { kind: "charge", value: 2, releaseOverride: 20, thenIntent: { kind: "attack", value: 20 } },
      weight: 1,
    },
  ],
};

const content = createContentDb({
  cards: new Map(),
  enemies: new Map([["boss", BOSS]]),
  enhancements: new Map(),
  relics: new Map(),
});

describe("Boss 蓄力 → 大招（策划 Q13 / docs/18）", () => {
  it("蓄力揭示带 thenValue，且释放段被排进蓄力链", () => {
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
    expect(started.enemies[0].intent?.thenIn).toBe(1);
    expect(started.enemies[0].forcedChain).toEqual([{ kind: "attack", value: 20, released: true }]);

    const after = reduce(started, { type: "EndTurn", actionId: "e" });
    expect(after.state.enemies[0].intent).toEqual({ kind: "attack", value: 20, released: true });
    expect(after.state.enemies[0].forcedChain).toEqual([]);
    const revealed = after.events.filter((e) => e.type === "IntentRevealed");
    expect(revealed).toHaveLength(1);
  });

  it("锈喉数值：一阶段蓄力接 16，二阶段蓄力接 24（数据校验，含 releaseOverride）", async () => {
    const { loadGameContent } = await import("@/data/load");
    const boss = loadGameContent().content.enemies.get("rust_throat");
    expect(boss).toBeDefined();
    const charges = boss!.intents.filter((e) => e.intent.kind === "charge");
    expect(charges.map((c) => buildChargeChain(c.intent).releaseValue)).toEqual([16, 24]);
    expect(charges.every((c) => c.intent.releaseOverride !== undefined)).toBe(true);
    expect(boss!.intents.some((e) => e.condition?.type === "selfHpBelow")).toBe(true);
  });
});
