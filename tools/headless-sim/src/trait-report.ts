/**
 * headless-sim · 职业特性对照报表（docs/58 §八.8）
 *
 * 策划要的是一张「三职业 × 有无特性」的通关率对照表，用来在 v1.1 封版前
 * 判断每条特性把职业推到什么水位。口径：
 *   - 单幕 + normal + 同一批种子贯穿所有组合（特性之间的差 = 特性本身的差，种子噪声互相抵消）；
 *   - 每个组合的「无特性」行 = 该职业的现版基线，特性行与它同种子对比；
 *   - 通关率按 docs/49 §二 只作**回归哨兵**，不判健康区间、不卡批次——本脚本不返回失败码。
 *
 * 用法：npm run sim:traits -- [每组合局数] [--class bloodwright]
 */
import { traitsForClass } from "../../../src/core/registry/content";
import { loadNodeContent } from "./load";
import { buildReport } from "./report";
import { simulateRun } from "./sim";

interface Options {
  games: number;
  classId: string | null;
}

function parseArgs(argv: string[]): Options {
  let games = 200;
  let classId: string | null = null;
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
    const n = Number(token);
    if (Number.isFinite(n) && n > 0) games = Math.trunc(n);
  }
  return { games, classId };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** 相对基线的差值（带正负号，单位 pp）。 */
function delta(rate: number, base: number): string {
  const pp = (rate - base) * 100;
  const sign = pp >= 0 ? "+" : "−";
  return `${sign}${Math.abs(pp).toFixed(1)}pp`;
}

function main(): number {
  const { games, classId } = parseArgs(process.argv.slice(2));
  const { content, acts } = loadNodeContent();
  const act = acts[0];
  if (!act) {
    console.error("[trait-report] 找不到第一幕数据");
    return 1;
  }
  const classes = classId ? [classId] : [...content.classes.keys()];
  const seeds = Array.from({ length: games }, (_, i) => i + 1);

  console.log(
    `[trait-report] 职业特性对照 · 每组合 ${games} 局 · 单幕 normal · 职业 ${classes.join(" / ")}`,
  );
  console.log("[trait-report] 通关率按 docs/49 §二 只作回归哨兵，不判健康区间、不卡批次\n");

  const header = ["职业".padEnd(12), "特性".padEnd(18), "通关率".padEnd(9), "相对无特性".padEnd(12), "平均承伤".padEnd(10)];
  console.log(header.join(" "));

  for (const cls of classes) {
    // 基线：同种子、同局数的「无特性」——特性行的差全部相对它算
    const baseResults = seeds.map((seed) => simulateRun(content, act, seed, cls, "normal", [], undefined, ""));
    const base = buildReport(baseResults);
    console.log(
      `${cls.padEnd(12)} ${"（无特性）".padEnd(16)} ${pct(base.winRate).padEnd(9)} ${"—".padEnd(12)} ${base.avgDamageTaken.toFixed(1).padEnd(10)}`,
    );

    const traits = traitsForClass(content, cls);
    if (traits.length === 0) {
      console.log(`${"".padEnd(12)} （本职业暂无特性档）`);
      continue;
    }
    for (const trait of traits) {
      const results = seeds.map((seed) =>
        simulateRun(content, act, seed, cls, "normal", [], undefined, trait.id),
      );
      const report = buildReport(results);
      console.log(
        `${"".padEnd(12)} ${trait.id.padEnd(18)} ${pct(report.winRate).padEnd(9)} ${delta(
          report.winRate,
          base.winRate,
        ).padEnd(12)} ${report.avgDamageTaken.toFixed(1).padEnd(10)}`,
      );
    }
  }

  console.log("\n[trait-report] 对照完成（数字仅供观察，最终数值平衡以 v1.1 封版前真人实测为准，docs/49 §七.3）");
  return 0;
}

process.exitCode = main();
