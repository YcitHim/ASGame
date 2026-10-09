import { describe, expect, it } from "vitest";
import { createBattleState } from "@/core/combat";
import { generateMapGraph } from "@/core/map";
import type { StatMult } from "@/core/registry";
import { loadGameContent } from "@/data/load";

const game = loadGameContent();
const act3 = game.acts.find((a) => a.id === "act3")!;

/** 建一场最小战斗：只关心倍率，卡组给一张打击就够。 */
function battle(enemyId: string, enemyStatMult?: StatMult, difficulty: "normal" | "rust" = "normal") {
  return createBattleState({
    battleId: "t",
    seed: 1,
    player: { maxHp: 70, energy: 3 },
    enemies: [{ id: enemyId }],
    deck: ["strike"],
    content: game.content,
    difficulty,
    ...(enemyStatMult ? { enemyStatMult } : {}),
  });
}

describe("docs/66 §四 · 第三幕 10 层定稿", () => {
  it("三幕已注册：10 层 / 锻炉高温 / 混合精锐池 7 只", () => {
    expect(act3).toBeTruthy();
    expect(act3.layers).toHaveLength(10);
    expect(act3.rules?.map((r) => r.id)).toEqual(["forgeHeat"]);
    const pools = new Set(act3.layers.flatMap((l) => l.elitePool ?? []));
    expect([...pools].sort()).toEqual(
      ["chain_flailer", "forge_colossus", "mirror_judge", "rust_bell_penitent", "rust_warden", "sanctum_jailer", "tidecaller"].sort(),
    );
    // Boss 是占位骨架的「炉前督军」，不是 docs/65 的终局 Boss 锈心
    expect(act3.layers[9]!.enemies).toEqual(["forge_marshal"]);
  });

  it("节奏骨架（pin）：l3 必现精英 / l5 必现篝火 / l6 必现精英（400 种子）", () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const map = generateMapGraph(act3, seed);
      const has = (li: number, kind: string): boolean => map.layers[li]!.nodes.some((n) => n.kind === kind);
      expect(has(3, "elite"), `seed ${seed}`).toBe(true);
      expect(has(5, "rest"), `seed ${seed}`).toBe(true);
      expect(has(6, "elite"), `seed ${seed}`).toBe(true);
    }
  });

  it("statMult（docs/66 §4.1）：混合遭遇 ×1.15/×1.1，l7 满档 ×1.2/×1.15，Boss 不吃倍率", () => {
    const map = generateMapGraph(act3, 7);
    for (const li of [0, 1, 2, 4]) {
      for (const n of map.layers[li]!.nodes) {
        expect(n.statMult, `l${li} 应带兜底倍率`).toMatchObject({ hp: 1.15, damage: 1.1 });
      }
    }
    for (const n of map.layers[7]!.nodes) expect(n.statMult).toMatchObject({ hp: 1.2, damage: 1.15 });
    // 精英 / 篝火 / 祭坛 / Boss 不吃混合遭遇倍率（Boss 数值按 §4.3 的首版值走）
    for (const li of [3, 5, 6, 8, 9]) {
      for (const n of map.layers[li]!.nodes) expect(n.statMult, `l${li} 不应带倍率`).toBeUndefined();
    }
  });

  it("statMult 真的作用在 enemy setup 级：HP 上浮、造伤倍率写进状态", () => {
    const raw = game.content.enemies.get("rust_hound")!.maxHp;
    expect(battle("rust_hound").enemies[0]!.maxHp).toBe(raw);
    expect(battle("rust_hound", { hp: 1.15, damage: 1.1 }).enemies[0]!.maxHp).toBe(Math.round(raw * 1.15));
    // 倍率与难度相乘：normal = 1.1，rust = 1.15（难度，甲方 2026-10-09 上调）× 1.1（幕内）
    expect(battle("rust_hound", { hp: 1, damage: 1.1 }).enemyDamageMul).toBeCloseTo(1.1, 5);
    expect(battle("rust_hound", { hp: 1, damage: 1.1 }, "rust").enemyDamageMul).toBeCloseTo(1.265, 5);
    expect(battle("rust_hound").enemyDamageMul).toBe(1);
  });

  it("前两幕不受影响：act1/act2 不写 statMult，所有节点都不带倍率", () => {
    for (const id of ["act1", "act2"]) {
      const act = game.acts.find((a) => a.id === id)!;
      expect(act.statMult).toBeUndefined();
      const map = generateMapGraph(act, 3);
      for (const layer of map.layers) for (const n of layer.nodes) expect(n.statMult).toBeUndefined();
    }
  });
});

describe("docs/66 §4.3 · 幕 Boss「炉前督军」", () => {
  const boss = game.content.enemies.get("forge_marshal")!;

  it("280 HP 双阶段 + docs/20 例外条款（免疫断链 / 眩晕抗性）", () => {
    expect(boss.maxHp).toBe(280);
    expect(boss.interruptImmune).toBe(true);
    expect(boss.stunResistant).toBe(true);
  });

  it("阶段一「锻压」：双环蓄力链释放写死 24，且 24 ≤ docs/20 单发上限", () => {
    const charge = boss.intents.find((e) => e.intent.kind === "charge");
    expect(charge).toBeTruthy();
    expect(charge!.intent.releaseOverride).toBe(24);
    expect(charge!.intent.thenIntent?.kind).toBe("charge");
    expect(charge!.intent.thenIntent?.thenIntent?.kind).toBe("attack");
    // 释放值取 releaseOverride，而不是「末端 value + Σ charge」
    expect(charge!.intent.releaseOverride).toBe(24);
    for (const e of boss.intents) expect(e.intent.releaseOverride ?? 0).toBeLessThanOrEqual(24);
  });

  it("阶段二「溢锈」：污染 + 灼烧 DoT + 召唤虫群 + 魔免节拍窗（everyTurns 3）", () => {
    const phase2 = boss.intents.filter((e) => e.condition?.type === "selfHpBelow");
    expect(phase2.length).toBeGreaterThanOrEqual(5);
    expect(phase2.some((e) => e.intent.buffId === "pollution")).toBe(true);
    expect(phase2.some((e) => e.intent.kind === "summon" && e.intent.enemyId === "corroded_swarm")).toBe(true);
    const ward = phase2.find((e) => e.intent.buffId === "magicimmune");
    expect(ward?.everyTurns).toBe(3);
    expect(ward?.maxConsecutive).toBe(1);
  });

  it("固定力量（everyTurns 5）不递增：只挂 2 层，没有叠加到 3+ 的条目", () => {
    const strength = boss.intents.filter((e) => e.intent.buffId === "strength");
    expect(strength).toHaveLength(1);
    expect(strength[0]!.intent.stacks).toBe(2);
    expect(strength[0]!.everyTurns).toBe(5);
  });
});
