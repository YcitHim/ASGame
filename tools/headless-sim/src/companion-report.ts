/**
 * headless-sim · T1 随身遗物强度分布（docs/41 §五 / docs/43 Q4）
 *
 * 策划要的是「8 件 T1 各自的首幕通关率分布」，用来做逐件裁决。
 * 口径：单幕（只打第一幕）+ normal 难度 + 三职业各跑 N 局，同一批种子横向对比，
 * 所以件与件之间的差就是遗物本身的差（种子噪声被同一批种子抵消）。
 *
 * docs/43 Q4 起加一条**绝对线**：任何一件都不得低于本职业「空随身槽」基线 -1.5pp
 * （同一批种子，400 局）。低于绝对线的件必须改触发条件，不许改数字。
 *
 * 用法：npm run sim:companions -- [每件局数] [--class bloodwright]
 */
import { loadNodeContent } from "./load";
import { relicPool } from "../../../src/core/map";
import { buildReport } from "./report";
import { simulateRun } from "./sim";
// docs/50 §三：人工标注「仅某职业可评」的件——其余职业行标 N/A，不进绝对线计算。
// relic-fit 是纯类型依赖（无运行期 import），工具侧复用同一份口径，避免两处判定漂移。
import { MANUAL_CLASS_ONLY } from "../../../src/ui/relic-fit";

interface Options {
  games: number;
  classId: string | null;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options {
  let games = 200;
  let classId: string | null = null;
  let quiet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--class") {
      classId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token.startsWith("--class=")) {
      classId = token.slice("--class=".length);
      continue;
    }
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    const n = Number(token);
    if (Number.isFinite(n) && n > 0) games = Math.trunc(n);
  }
  return { games, classId, quiet };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function main(): number {
  const { games, classId, quiet } = parseArgs(process.argv.slice(2));
  const { content, acts } = loadNodeContent();
  const act = acts[0];
  if (!act) {
    console.error("[companion-report] 找不到第一幕数据");
    return 1;
  }
  const allRelics = [...content.relics.keys()];
  const pool = relicPool(content, 1, allRelics);
  const classes = classId ? [classId] : [...content.classes.keys()];

  console.log(
    `[companion-report] T1 随身遗物 ${pool.length} 件 · 每件 ${games} 局 · 单幕 normal · 职业 ${classes.join(" / ")}`,
  );

  // 同一批种子贯穿所有组合：件间差异 = 遗物差异
  const seeds = Array.from({ length: games }, (_, i) => i + 1);
  /** null = 该件对该职业无意义（N/A，docs/50 §三），不参与任何区间判定 */
  const perClass: Record<string, Record<string, number | null>> = {};
  const totals: Record<string, { wins: number; games: number }> = {};
  for (const id of pool) totals[id] = { wins: 0, games: 0 };

  // 绝对线（docs/43 Q4）：同种子、同局数下的「空随身槽」基线。
  // 注意：simulateRun 的 companionId 缺省 = 职业默认偏好件，不是"没有遗物"；
  // 真正的空槽要显式传空串（sim.ts 里 `companion ? [companion] : []`）。
  const RELIC_FLOOR_PP = 1.5;
  const baseline: Record<string, number> = {};
  for (const cls of classes) {
    const results = seeds.map((seed) => simulateRun(content, act, seed, cls, "normal", [], ""));
    baseline[cls] = buildReport(results).winRate;
  }

  for (const cls of classes) {
    perClass[cls] = {};
    for (const relicId of pool) {
      const lock = MANUAL_CLASS_ONLY[relicId];
      if (lock && lock !== cls) {
        perClass[cls][relicId] = null;
        if (!quiet) console.log(`  ${cls.padEnd(11)} ${relicId.padEnd(15)} N/A（仅 ${lock} 评测）`);
        continue;
      }
      const results = seeds.map((seed) => simulateRun(content, act, seed, cls, "normal", [], relicId));
      const report = buildReport(results);
      perClass[cls][relicId] = report.winRate;
      totals[relicId].wins += report.wins;
      totals[relicId].games += report.games;
      if (!quiet) console.log(`  ${cls.padEnd(11)} ${relicId.padEnd(15)} ${pct(report.winRate)}`);
    }
  }

  const overall = pool.map((id) => ({
    id,
    rate: totals[id].games === 0 ? 0 : totals[id].wins / totals[id].games,
  }));
  const rates = overall.map((r) => r.rate).sort((a, b) => a - b);
  const median =
    rates.length % 2 === 1
      ? rates[(rates.length - 1) / 2]
      : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;
  const best = rates[rates.length - 1];
  const worst = rates[0];

  // 表头：件 × 职业
  const header = ["遗物".padEnd(15), ...classes.map((c) => c.padEnd(11)), "合计".padEnd(8), "份数".padEnd(7)];
  console.log(`
${header.join(" ")}`);
  for (const row of [...overall].sort((a, b) => b.rate - a.rate)) {
    const cells = classes.map((c) => {
      const value = perClass[c][row.id];
      return (value == null ? "N/A" : pct(value)).padEnd(11);
    });
    // 目标区间（docs/41 §五）：最弱件 ≥ 池子中位数的 70%
    const share = median === 0 ? 0 : row.rate / median;
    console.log(
      `${row.id.padEnd(15)} ${cells.join(" ")} ${pct(row.rate).padEnd(8)} ${(share * 100).toFixed(0).padStart(3)}%`,
    );
  }

  console.log(
    `
[companion-report] 中位数 ${pct(median)} · 最强 ${pct(best)} · 最弱 ${pct(worst)} · 极差 ${((best - worst) * 100).toFixed(1)}pp`,
  );

  // —— 绝对线（docs/43 Q4）——
  const offendersAbs: string[] = [];
  console.log("[companion-report] 绝对线：每件 ≥ 本职业空随身槽基线 -1.5pp");
  for (const cls of classes) {
    const bar = baseline[cls] - RELIC_FLOOR_PP / 100;
    // N/A 的件（docs/50 §三）不进绝对线——它们本来就不该出现在这个职业的池子里
    const under = pool.filter((id) => {
      const value = perClass[cls][id];
      return value != null && value < bar;
    });
    console.log(
      `  ${cls.padEnd(11)} 基线 ${pct(baseline[cls])} · 底线 ${pct(bar)} · ${
        under.length === 0 ? "全部达标" : `不达标 ${under.join(" / ")}`
      }`,
    );
    for (const id of under) offendersAbs.push(`${cls}/${id}`);
  }
  const offenders = overall.filter((r) => median > 0 && r.rate / median < 0.7).map((r) => r.id);
  console.log(
    offenders.length === 0
      ? "[companion-report] 相对区间达标：最弱件 ≥ 中位数 70%（docs/41 §五）"
      : `[companion-report] 低于 70% 中位数的垫底件：${offenders.join(" / ")}`,
  );
  console.log(
    offendersAbs.length === 0
      ? "[companion-report] 绝对线达标：没有低于基线 -1.5pp 的件"
      : `[companion-report] 低于绝对线的件（必须改触发，不许改数字）：${offendersAbs.join(" / ")}`,
  );
  return 0;
}

process.exitCode = main();
