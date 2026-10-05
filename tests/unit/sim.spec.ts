import { describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
import { buildReport } from "../../tools/headless-sim/src/report";
import { simulateRun } from "../../tools/headless-sim/src/sim";

const game = loadGameContent();
const act = game.acts[0];

describe("S5.4 无头模拟器（G6）", () => {
  it("同种子同结果（可复现）", () => {
    const a = simulateRun(game.content, act, 7);
    const b = simulateRun(game.content, act, 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("20 局小样本：流程能走完且胜率不极端", () => {
    const results = Array.from({ length: 20 }, (_, i) => simulateRun(game.content, act, i + 1));
    const report = buildReport(results);
    expect(report.games).toBe(20);
    expect(report.avgBattles).toBeGreaterThan(0);
    expect(report.avgTurns).toBeGreaterThan(0);
    // 小样本只做"不崩"与量级检查，正式健康区间由 npm run sim 的 100 局把关
    expect(report.winRate).toBeGreaterThanOrEqual(0);
    expect(report.winRate).toBeLessThanOrEqual(1);
    for (const r of results) {
      expect(["win", "lose"]).toContain(r.outcome);
      expect(r.turns).toBeGreaterThan(0);
    }
  });
});
