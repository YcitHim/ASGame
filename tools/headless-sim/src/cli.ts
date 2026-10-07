import type { RunDifficulty } from "../../../src/core/map";
import { loadNodeContent } from "./load";
import { buildReport, buildScenarioReport, formatReport, formatScenarioReport } from "./report";
import { simulateEliteScenario } from "./scenario";
import { simulateRun } from "./sim";

/** docs/27 §一：sim 补上精英遗物模拟后基线抬升，sim 口径目标区间暂定为 45%~65%（真人实测仍按 45~60%）。 */
const HEALTHY_MIN = 0.45;
const HEALTHY_MAX = 0.65;

/** 用法：npm run sim -- [局数] [--scenario elite_warden] [--class engineer] [--difficulty rust] [--acts 2] [--trait glass_cannon] */
function parseArgs(argv: string[]): {
  games: number;
  scenario: string | null;
  classId: string;
  difficulty: RunDifficulty;
  /** 已知 AI 下限：低于健康区间只记录、不判失败（策划裁定，见 docs/program Q2） */
  aiFloor: boolean;
  /** 连打幕数（docs/40 §九-15）：1 = 单幕，2 = 双幕连打 */
  actCount: number;
  /** 哨兵模式（docs/49 §二）：只记录数字、不判健康区间，不卡批次 */
  sentinel: boolean;
  /** 职业特性（docs/58 §二）：空串 = 无特性（现版基线） */
  traitId: string;
} {
  let games = 100;
  let scenario: string | null = null;
  let classId = "bloodwright";
  let difficulty: RunDifficulty = "normal";
  let aiFloor = false;
  let actCount = 1;
  let sentinel = false;
  let traitId = "";
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--sentinel") {
      sentinel = true;
      continue;
    }
    if (token === "--ai-floor") {
      aiFloor = true;
      continue;
    }
    if (token === "--trait") {
      traitId = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token.startsWith("--trait=")) {
      traitId = token.slice("--trait=".length);
      continue;
    }
    if (token === "--no-trait") {
      traitId = "";
      continue;
    }
    if (token === "--acts") {
      actCount = Math.max(1, Math.trunc(Number(argv[i + 1] ?? 1)) || 1);
      i += 1;
      continue;
    }
    if (token.startsWith("--acts=")) {
      actCount = Math.max(1, Math.trunc(Number(token.slice("--acts=".length))) || 1);
      continue;
    }
    if (token === "--difficulty") {
      difficulty = (argv[i + 1] as RunDifficulty) ?? "normal";
      i += 1;
      continue;
    }
    if (token.startsWith("--difficulty=")) {
      difficulty = token.slice("--difficulty=".length) as RunDifficulty;
      continue;
    }
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
  return { games, scenario, classId, difficulty, aiFloor, actCount, sentinel, traitId };
}

function main(): number {
  const { games, scenario, classId, difficulty, aiFloor, actCount, sentinel, traitId } = parseArgs(
    process.argv.slice(2),
  );
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
    const results = Array.from({ length: games }, (_, i) =>
      simulateEliteScenario(content, act, i + 1, classId, difficulty, traitId),
    );
    const report = buildScenarioReport(results);
    console.log(formatScenarioReport(report));
    return 0;
  }

  const actList = actCount > 1 ? acts.slice(0, actCount) : [];
  const results = Array.from({ length: games }, (_, i) =>
    simulateRun(content, act, i + 1, classId, difficulty, actList, undefined, traitId),
  );
  console.log(
    `[headless-sim] 职业 ${classId} · 难度 ${difficulty}${traitId ? ` · 特性 ${traitId}` : " · 无特性"}${
      actList.length > 0 ? ` · 连打 ${actList.length} 幕` : ""
    }`,
  );
  const report = buildReport(results);
  console.log(formatReport(report));

  // 哨兵模式（docs/49 §二）：通关率不再作放行门禁，只记录 + 抓断崖
  if (sentinel) {
    console.log(
      `\n[headless-sim] 哨兵记录：${(report.winRate * 100).toFixed(1)}%（docs/49 §二：健康区间暂停使用，数字只作观察基线）`,
    );
    return 0;
  }

  // 锈蚀档只摸底不设线（docs/36 §四）；普通档沿用 45~65% 健康区间
  if (difficulty !== "normal") {
    console.log("\n[headless-sim] 锈蚀档：只摸底，不设健康线（docs/36 §四）");
    return 0;
  }

  // AI 下限记录（策划裁定 2026-10-06 Q2：血械起手放血在 sim 里被 AI 误判，
  // 真人手感优先，不拿 sim 数字逼数值）——只提示、不判失败。
  if (aiFloor && report.winRate < HEALTHY_MIN) {
    console.log(
      `\n[headless-sim] AI 下限记录：${(report.winRate * 100).toFixed(1)}% 低于 ${HEALTHY_MIN * 100}%，按 Q2 裁定不判失败`,
    );
    return 0;
  }
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
