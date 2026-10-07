import { formatIssues, validateContent, type ValidationIssue } from "./validate-content";
import { loadContent, REPO_ROOT } from "./load-data";
import type { ActJson } from "./schema";
import { checkMapGraph, generateMapGraph } from "../../../src/core/map/index";

/** 每个幕扫多少个种子：docs/48 §3.3「所有生成种子连通性必过」的常驻检查。 */
const MAP_SEED_SWEEP = 256;

/**
 * 树状地图连接性/平面性常驻检查（docs/48 §3.1 / §3.3）。
 * validator 不能只验静态 JSON——DAG 是生成物，必须真的生成出来看。
 */
function checkMapConnectivity(acts: readonly ActJson[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const act of acts) {
    for (let seed = 0; seed < MAP_SEED_SWEEP; seed += 1) {
      const map = generateMapGraph(act as unknown as Parameters<typeof generateMapGraph>[0], seed);
      for (const message of checkMapGraph(map)) {
        issues.push({ file: `act ${act.id}`, path: `map(seed ${seed})`, message });
      }
    }
  }
  return issues;
}

function main(): number {
  const input = loadContent();
  const result = validateContent(input);
  const issues = [...result.issues, ...checkMapConnectivity(result.acts)];
  const { cards, enhancements, enemies, acts, relics, events, classes } = result;

  if (issues.length > 0) {
    console.error(`\n[content-validator] 校验失败：${issues.length} 个问题\n`);
    console.error(formatIssues(issues));
    console.error("");
    return 1;
  }

  console.log(
    `[content-validator] 通过 · 卡牌 ${cards.length} · 强化 ${enhancements.length} · 敌人 ${enemies.length} · 遗物 ${relics.length} · 事件 ${events.length} · 职业 ${classes.length} · 关卡 ${acts.length} · i18n ${Object.keys(input.i18n).length} 条`,
  );
  console.log(`  地图连通性：${acts.length} 幕 × ${MAP_SEED_SWEEP} 种子全过（docs/48 §3.3）`);
  console.log(`  root: ${REPO_ROOT}`);
  return 0;
}

process.exitCode = main();