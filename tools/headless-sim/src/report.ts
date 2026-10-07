/**
 * headless-sim · 报表聚合
 */
import { SCENARIO_TARGET, type ScenarioResult } from "./scenario";
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
  /** docs/19 §3.1：精英 / Boss 战后剩余 HP 分位数（可触发的验收指标） */
  eliteHpP10: number;
  eliteHpP50: number;
  eliteCleared: number;
  bossHpP10: number;
  bossHpP50: number;
  bossCleared: number;
  /** docs/23 §10：失控线爆发流（血怒 + 低血沸腾）出现率 / 对应局胜率 / 平均回合 */
  comboGames: number;
  comboRate: number;
  comboWinRate: number;
  comboAvgTurns: number;
  /** 跨卡同时持有（血怒 + 低血沸腾，可不同卡）——诊断 AI 会不会凑对（docs/25 §1.6） */
  comboAnyGames: number;
  comboAnyRate: number;
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

/** 口径 b（docs/23 §10）：出现率 + 对应局胜率 + 平均回合。 */
function comboReport(results: SimResult[]): {
  comboGames: number;
  comboRate: number;
  comboWinRate: number;
  comboAvgTurns: number;
  comboAnyGames: number;
  comboAnyRate: number;
} {
  const games = results.filter((r) => r.bloodrageBoil);
  const wins = games.filter((r) => r.outcome === "win").length;
  const anyGames = results.filter((r) => r.bloodrageBoilAny);
  return {
    comboGames: games.length,
    comboRate: results.length === 0 ? 0 : games.length / results.length,
    comboWinRate: games.length === 0 ? 0 : wins / games.length,
    comboAvgTurns: avg(games.map((r) => r.turns)),
    comboAnyGames: anyGames.length,
    comboAnyRate: results.length === 0 ? 0 : anyGames.length / results.length,
  };
}

export function buildReport(results: SimResult[]): Report {
  const wins = results.filter((r) => r.outcome === "win").length;
  const nodeReach: Record<number, number> = {};
  for (const r of results) nodeReach[r.nodeReached] = (nodeReach[r.nodeReached] ?? 0) + 1;
  const turns = results.map((r) => r.turns);
  const taken = results.map((r) => r.damageTaken);
  const eliteHp = results.map((r) => r.hpAfterElite).filter((v): v is number => v !== null);
  const bossHp = results.map((r) => r.hpAfterBoss).filter((v): v is number => v !== null);
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
    eliteHpP10: percentile(eliteHp, 10),
    eliteHpP50: percentile(eliteHp, 50),
    eliteCleared: eliteHp.length,
    bossHpP10: percentile(bossHp, 10),
    bossHpP50: percentile(bossHp, 50),
    bossCleared: bossHp.length,
    ...comboReport(results),
    nodeReach,
    topPlayed: mergeCounts(results, (r) => r.cardsPlayed),
    topPicked: mergeCounts(results, (r) => r.cardsPicked),
    topEnhancements: mergeCounts(results, (r) => r.enhancements),
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

export interface ScenarioReport {
  games: number;
  wins: number;
  winRate: number;
  avgDamageTaken: number;
  avgTurns: number;
  hpLeftP10: number;
  hpLeftP50: number;
}

export function buildScenarioReport(results: ScenarioResult[]): ScenarioReport {
  const wins = results.filter((r) => r.win).length;
  return {
    games: results.length,
    wins,
    winRate: results.length === 0 ? 0 : wins / results.length,
    avgDamageTaken: avg(results.map((r) => r.damageTaken)),
    avgTurns: avg(results.map((r) => r.turns)),
    hpLeftP10: percentile(results.map((r) => r.hpLeft), 10),
    hpLeftP50: percentile(results.map((r) => r.hpLeft), 50),
  };
}

/**
 * 精英直开场景（docs/43 §五 备案）：**已退役，仅记录**。
 * 不再按 70%~90% / 25~40 判线，也不再让 CI 因它失败——数字只用于回归对比。
 */
export function formatScenarioReport(report: ScenarioReport): string {
  const { minRate, maxRate, minTaken, maxTaken } = SCENARIO_TARGET;
  return [
    "[headless-sim] 场景直开 · 精英（铁锈看守 · HP 45 · 起始卡组+2 张抓牌+1 升级）",
    "  ⚠ 已退役 · 仅记录（docs/43 §五）：不再判线，退出码恒为 0",
    `  局数 ${report.games} · 胜率 ${pct(report.winRate)}（历史目标 ${pct(minRate)}~${pct(maxRate)}，现在只看趋势）`,
    `  平均承伤 ${report.avgDamageTaken.toFixed(1)}（历史目标 ${minTaken}~${maxTaken}）· 平均回合 ${report.avgTurns.toFixed(1)}`,
    `  战后剩余 HP P10 ${report.hpLeftP10} / P50 ${report.hpLeftP50}`,
    "  结论：已退役——保留这项只为横向对比，不代表任何验收。",
  ].join("\n");
}

export function formatReport(report: Report): string {
  const lines = [
    "[headless-sim] 线性地图数值体检",
    `  局数 ${report.games} · 胜率 ${pct(report.winRate)}（${report.wins}/${report.games}）`,
    `  平均回合 ${report.avgTurns.toFixed(1)}（P50 ${report.turnP50} / P90 ${report.turnP90}） · 平均战斗数 ${report.avgBattles.toFixed(1)}`,
    `  平均造成伤害 ${report.avgDamageDealt.toFixed(0)} · 平均承伤 ${report.avgDamageTaken.toFixed(0)}（P90 ${report.damageTakenP90}）`,
    `  精英战后剩余 HP P10 ${report.eliteHpP10} / P50 ${report.eliteHpP50}（过精英 ${report.eliteCleared} 局；设计意图 P50 ≥ 25）`,
    `  Boss 战后剩余 HP P10 ${report.bossHpP10} / P50 ${report.bossHpP50}（过 Boss ${report.bossCleared} 局）`,
    `  失控线爆发流（血怒+低血沸腾 同卡）出现率 ${pct(report.comboRate)}（${report.comboGames} 局）· 对应胜率 ${pct(report.comboWinRate)} · 平均回合 ${report.comboAvgTurns.toFixed(1)}（参考：出现率 ≥15%、胜率 ≤ 全局 +15pp）`,
    `  同局持有两者（可不同卡）${pct(report.comboAnyRate)}（${report.comboAnyGames} 局）——用于区分"结构不可达"与"AI 不会凑对"`,
    `  到达节点分布 ${Object.entries(report.nodeReach).map(([k, v]) => `${k}:${v}`).join(" ")}`,
    `  出牌 Top：${report.topPlayed.slice(0, 8).map(([k, v]) => `${k}(${v})`).join(" ")}`,
    `  抓牌 Top：${report.topPicked.slice(0, 8).map(([k, v]) => `${k}(${v})`).join(" ")}`,
    `  强化选择：${report.topEnhancements.map(([k, v]) => `${k}(${v})`).join(" ") || "无"}`,
  ];
  return lines.join("\n");
}
