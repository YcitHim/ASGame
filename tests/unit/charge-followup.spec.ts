import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { buildChargeChain } from "@/core/intents";
import { createContentDb, type EnemyDefinition } from "@/core/registry";

/**
 * 蓄力链（docs/18）：
 * - 链长按敌型：法术 2（蓄→蓄→释放）/ 物理 1（蓄→释放）
 * - 释放值 = 普攻基准 + 蓄力值 × 层数；Boss 用 releaseOverride 写死
 * - 蓄力回合架格挡；增幅一次性消耗、不残留
 * - 历史 bug（0.1 初版）：蓄力只加永久力量、不接大招 → 由 thenIntent 链根治
 */

function charger(charge: EnemyDefinition["intents"][number]["intent"]): EnemyDefinition {
  return { id: "charger", name: "Charger", maxHp: 60, intents: [{ intent: charge, weight: 1 }] };
}

const content = createContentDb({
  cards: new Map(),
  enemies: new Map([
    ["chain1", charger({ kind: "charge", value: 2, block: 6, thenIntent: { kind: "attack", value: 10 } })],
    [
      "chain2",
      charger({
        kind: "charge",
        value: 2,
        block: 4,
        thenIntent: { kind: "charge", value: 2, block: 4, thenIntent: { kind: "attack", value: 7 } },
      }),
    ],
  ]),
  enhancements: new Map(),
  relics: new Map(),
});

function start(enemyId: string) {
  return reduce(
    createBattleState({
      battleId: "c",
      seed: 7,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: enemyId }],
      deck: ["x", "x", "x", "x", "x"],
      handSize: 5,
      content,
    }),
    { type: "Noop", actionId: "s" },
  ).state;
}

describe("蓄力链：物理型（蓄 1）", () => {
  it("蓄力回合架格挡、不掉血、不给永久力量", () => {
    const state = start("chain1");
    expect(state.enemies[0].intent?.thenValue).toBe(12);

    const after = reduce(state, { type: "EndTurn", actionId: "e" });
    expect(after.state.player.hp).toBe(66);
    expect(after.state.enemies[0].block).toBe(6);
    expect(after.state.enemies[0].buffs.some((b) => b.id === "strength")).toBe(false);
  });

  it("释放值 = 普攻基准 + 蓄力值 × 层数，玩家真实掉血", () => {
    const afterCharge = reduce(start("chain1"), { type: "EndTurn", actionId: "e1" }).state;
    expect(afterCharge.enemies[0].intent).toEqual({ kind: "attack", value: 12, released: true });

    const afterHit = reduce(afterCharge, { type: "EndTurn", actionId: "e2" });
    expect(afterHit.state.player.hp).toBe(54);
  });
});

describe("蓄力链：法术型（蓄 2，越蓄越痛）", () => {
  it("两回合链：预告带倒计时，释放值 7 + 2×2 = 11", () => {
    const state = start("chain2");
    expect(state.enemies[0].intent?.thenValue).toBe(11);
    expect(state.enemies[0].intent?.thenIn).toBe(2);
    // 剩余两环：第二次蓄力 + 释放攻击
    expect(state.enemies[0].forcedChain).toHaveLength(2);

    const afterFirst = reduce(state, { type: "EndTurn", actionId: "e1" }).state;
    expect(afterFirst.enemies[0].intent?.kind).toBe("charge");
    expect(afterFirst.enemies[0].intent?.thenIn).toBe(1);
    expect(afterFirst.player.hp).toBe(66);

    const afterSecond = reduce(afterFirst, { type: "EndTurn", actionId: "e2" }).state;
    expect(afterSecond.enemies[0].intent).toEqual({ kind: "attack", value: 11, released: true });
    expect(afterSecond.player.hp).toBe(66);

    const afterHit = reduce(afterSecond, { type: "EndTurn", actionId: "e3" });
    expect(afterHit.state.player.hp).toBe(55);
  });
});

describe("真实内容：蓄力链数值表（docs/18 冻结值）", () => {
  it("释放值与格挡与策划表一致", async () => {
    const { loadGameContent } = await import("@/data/load");
    const db = loadGameContent().content;

    const expected: Record<string, { release: number[]; block: number[] }> = {
      polluting_preacher: { release: [11], block: [4, 4] },
      riveted_heavy: { release: [14], block: [6] },
      rust_warden: { release: [17], block: [8, 8] },
      rust_sentinel: { release: [12], block: [4] },
      rust_throat: { release: [16, 24], block: [] },
    };

    for (const [id, want] of Object.entries(expected)) {
      const def = db.enemies.get(id);
      expect(def, `敌人 ${id} 不存在`).toBeDefined();
      const charges = def!.intents.filter((e) => e.intent.kind === "charge");
      expect(charges.map((c) => buildChargeChain(c.intent).releaseValue)).toEqual(want.release);
      expect(charges.map((c) => buildChargeChain(c.intent).steps.map((s) => s.block ?? 0)).flat().filter((b) => b > 0))
        .toEqual(want.block);
    }
  });
});
