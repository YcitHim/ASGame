import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { createContentDb, type EnemyDefinition } from "@/core/registry";

/**
 * 实机 bug（2026-10-05）：部分怪物蓄力后不放大招。
 * 根因：charge 执行只给自己挂"永久力量"，且 4 只怪的蓄力没声明 thenIntent。
 * docs/16 工作约定：一切蓄力必须声明 thenIntent；禁止永久力量类效果。
 */

const CHARGER: EnemyDefinition = {
  id: "charger",
  name: "Charger",
  maxHp: 50,
  intents: [{ intent: { kind: "charge", value: 2 }, weight: 1, thenIntent: { kind: "attack", value: 20 } }],
};

const content = createContentDb({
  cards: new Map(),
  enemies: new Map([["charger", CHARGER]]),
  enhancements: new Map(),
  relics: new Map(),
});

function start() {
  return reduce(
    createBattleState({
      battleId: "c",
      seed: 7,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: "charger" }],
      deck: ["x", "x", "x", "x", "x"],
      handSize: 5,
      content,
    }),
    { type: "Noop", actionId: "s" },
  ).state;
}

describe("蓄力 → 必接大招", () => {
  it("蓄力回合不掉血、不给敌人永久力量", () => {
    const state = start();
    expect(state.enemies[0].intent?.kind).toBe("charge");

    const after = reduce(state, { type: "EndTurn", actionId: "e" });
    expect(after.state.player.hp).toBe(66);
    expect(after.state.enemies[0].buffs.some((b) => b.id === "strength")).toBe(false);
  });

  it("下一回合强制打出声明的 thenIntent，玩家真实掉血", () => {
    const afterCharge = reduce(start(), { type: "EndTurn", actionId: "e1" }).state;
    expect(afterCharge.enemies[0].intent).toEqual({ kind: "attack", value: 20 });

    const afterHit = reduce(afterCharge, { type: "EndTurn", actionId: "e2" });
    expect(afterHit.state.player.hp).toBe(46);
  });

  it("真实内容：所有蓄力都声明了可兑现的 thenIntent", async () => {
    const { loadGameContent } = await import("@/data/load");
    const db = loadGameContent().content;
    const chargers: string[] = [];
    for (const [id, def] of db.enemies) {
      for (const entry of def.intents) {
        if (entry.intent.kind !== "charge") continue;
        chargers.push(id);
        expect(entry.thenIntent, `${id} 的蓄力缺 thenIntent`).toBeDefined();
        expect(entry.thenIntent?.kind).toBe("attack");
        expect(entry.thenIntent?.value ?? 0).toBeGreaterThan(0);
      }
    }
    expect([...new Set(chargers)].sort()).toEqual([
      "polluting_preacher",
      "riveted_heavy",
      "rust_sentinel",
      "rust_throat",
      "rust_warden",
    ]);
  });
});
