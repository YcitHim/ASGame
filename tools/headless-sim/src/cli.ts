import { loadNodeContent } from "./load";
import { buildReport, formatReport } from "./report";
import { simulateRun } from "./sim";

const HEALTHY_MIN = 0.3;
const HEALTHY_MAX = 0.7;

function main(): number {
  const games = Number(process.argv[2] ?? 100);
  const { content, acts } = loadNodeContent();
  const act = acts[0];
  if (!act) {
    console.error("[headless-sim] 找不到关卡数据");
    return 1;
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
