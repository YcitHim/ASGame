import { describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
import { buildReport, buildScenarioReport, formatScenarioReport } from "../../tools/headless-sim/src/report";
import { simulateEliteScenario } from "../../tools/headless-sim/src/scenario";
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

  it("主线记录精英/Boss 战后剩余 HP（docs/19 §3.1 可触发指标）", () => {
    const results = Array.from({ length: 20 }, (_, i) => simulateRun(game.content, act, i + 1));
    const report = buildReport(results);
    // 至少有一局打到精英；过精英的局必须有剩余 HP 样本
    expect(report.eliteCleared).toBeGreaterThan(0);
    expect(report.eliteHpP50).toBeGreaterThanOrEqual(0);
    expect(report.bossHpP50).toBeGreaterThanOrEqual(0);
  });

  it("场景直开精英战（docs/19 §3.2）：可复现、不崩、落在合理量级", () => {
    const a = simulateEliteScenario(game.content, act, 7);
    const b = simulateEliteScenario(game.content, act, 7);
    expect(a).toEqual(b);
    const results = Array.from({ length: 20 }, (_, i) => simulateEliteScenario(game.content, act, i + 1));
    const report = buildScenarioReport(results);
    expect(report.games).toBe(20);
    expect(report.winRate).toBeGreaterThanOrEqual(0);
    expect(report.winRate).toBeLessThanOrEqual(1);
    expect(report.avgTurns).toBeGreaterThan(0);
    expect(formatScenarioReport(report)).toContain("场景直开");
  });
});
