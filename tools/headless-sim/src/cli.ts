import { loadNodeContent } from "./load";
import { buildReport, buildScenarioReport, formatReport, formatScenarioReport } from "./report";
import { simulateEliteScenario } from "./scenario";
import { simulateRun } from "./sim";

/** docs/27 §一：sim 补上精英遗物模拟后基线抬升，sim 口径目标区间暂定为 45%~65%（真人实测仍按 45~60%）。 */
const HEALTHY_MIN = 0.45;
const HEALTHY_MAX = 0.65;

/** 用法：npm run sim -- [局数] [--scenario elite_warden] [--class engineer] */
function parseArgs(argv: string[]): { games: number; scenario: string | null; classId: string } {
  let games = 100;
  let scenario: string | null = null;
  let classId = "bloodwright";
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--scenario") {
      scenario = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token.startsWith("--scenario=")) {
      scenario = token.slice("--scenario=".length);
      continue;
    }
    if (token === "--class") {
      classId = argv[i + 1] ?? classId;
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
  return { games, scenario, classId };
}

function main(): number {
  const { games, scenario, classId } = parseArgs(process.argv.slice(2));
  const { content, acts } = loadNodeContent();
  const act = acts[0];
  if (!act) {
    console.error("[headless-sim] 找不到关卡数据");
    return 1;
  }

  if (scenario) {
    if (scenario !== "elite_warden") {
      console.error(`[headless-sim] 未知场景 "${scenario}"（可用：elite_warden）`);
      return 1;
    }
    const results = Array.from({ length: games }, (_, i) => simulateEliteScenario(content, act, i + 1, classId));
    const report = buildScenarioReport(results);
    console.log(formatScenarioReport(report));
    return 0;
  }

  const results = Array.from({ length: games }, (_, i) => simulateRun(content, act, i + 1, classId));
  console.log(`[headless-sim] 职业 ${classId}`);
  const report = buildReport(results);
  console.log(formatReport(report));

  if (report.winRate < HEALTHY_MIN || report.winRate > HEALTHY_MAX) {
    console.error(
      `\n[headless-sim] 胜率 ${(report.winRate * 100).toFixed(1)}% 不在健康区间 ${HEALTHY_MIN * 100}%~${HEALTHY_MAX * 100}%，需要修数值`,
    );
    return 1;
  }
  console.log("\n[headless-sim] 胜率落在健康区间");
  return 0;
}

process.exitCode = main();
