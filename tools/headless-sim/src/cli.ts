import { loadNodeContent } from "./load";
import { buildReport, buildScenarioReport, formatReport, formatScenarioReport } from "./report";
import { simulateEliteScenario } from "./scenario";
import { simulateRun } from "./sim";

const HEALTHY_MIN = 0.3;
const HEALTHY_MAX = 0.7;

/** 用法：npm run sim -- [局数] [--scenario elite_warden] */
function parseArgs(argv: string[]): { games: number; scenario: string | null } {
  let games = 100;
  let scenario: string | null = null;
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
    const n = Number(token);
    if (Number.isFinite(n) && n > 0) games = Math.trunc(n);
  }
  return { games, scenario };
}

function main(): number {
  const { games, scenario } = parseArgs(process.argv.slice(2));
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
    const results = Array.from({ length: games }, (_, i) => simulateEliteScenario(content, act, i + 1));
    const report = buildScenarioReport(results);
    console.log(formatScenarioReport(report));
    return 0;
  }

  const results = Array.from({ length: games }, (_, i) => simulateRun(content, act, i + 1));
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
