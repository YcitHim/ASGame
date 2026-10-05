/**
 * headless-sim · 报表聚合
 */
import type { SimResult } from "./sim";

export interface Report {
  games: number;
  wins: number;
  winRate: number;
  avgTurns: number;
  avgBattles: number;
  avgDamageDealt: number;
  avgDamageTaken: number;
  turnP50: number;
  turnP90: number;
  damageTakenP90: number;
  nodeReach: Record<number, number>;
  topPlayed: [string, number][];
  topPicked: [string, number][];
  topEnhancements: [string, number][];
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function mergeCounts(results: SimResult[], pick: (r: SimResult) => Record<string, number>): [string, number][] {
  const total: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(pick(r))) total[k] = (total[k] ?? 0) + v;
  return Object.entries(total).sort((a, b) => b[1] - a[1]);
}

export function buildReport(results: SimResult[]): Report {
  const wins = results.filter((r) => r.outcome === "win").length;
  const nodeReach: Record<number, number> = {};
  for (const r of results) nodeReach[r.nodeReached] = (nodeReach[r.nodeReached] ?? 0) + 1;
  const turns = results.map((r) => r.turns);
  const taken = results.map((r) => r.damageTaken);
  return {
    games: results.length,
    wins,
    winRate: results.length === 0 ? 0 : wins / results.length,
    avgTurns: avg(turns),
    avgBattles: avg(results.map((r) => r.battles)),
    avgDamageDealt: avg(results.map((r) => r.damageDealt)),
    avgDamageTaken: avg(taken),
    turnP50: percentile(turns, 50),
    turnP90: percentile(turns, 90),
    damageTakenP90: percentile(taken, 90),
    nodeReach,
    topPlayed: mergeCounts(results, (r) => r.cardsPlayed),
    topPicked: mergeCounts(results, (r) => r.cardsPicked),
    topEnhancements: mergeCounts(results, (r) => r.enhancements),
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

export function formatReport(report: Report): string {
  const lines = [
    "[headless-sim] 线性地图数值体检",
    `  局数 ${report.games} · 胜率 ${pct(report.winRate)}（${report.wins}/${report.games}）`,
    `  平均回合 ${report.avgTurns.toFixed(1)}（P50 ${report.turnP50} / P90 ${report.turnP90}） · 平均战斗数 ${report.avgBattles.toFixed(1)}`,
    `  平均造成伤害 ${report.avgDamageDealt.toFixed(0)} · 平均承伤 ${report.avgDamageTaken.toFixed(0)}（P90 ${report.damageTakenP90}）`,
    `  到达节点分布 ${Object.entries(report.nodeReach).map(([k, v]) => `${k}:${v}`).join(" ")}`,
    `  出牌 Top：${report.topPlayed.slice(0, 8).map(([k, v]) => `${k}(${v})`).join(" ")}`,
    `  抓牌 Top：${report.topPicked.slice(0, 8).map(([k, v]) => `${k}(${v})`).join(" ")}`,
    `  强化选择：${report.topEnhancements.map(([k, v]) => `${k}(${v})`).join(" ") || "无"}`,
  ];
  return lines.join("\n");
}
