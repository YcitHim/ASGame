import { formatIssues, validateContent, type ValidationIssue } from "./validate-content";
import { loadContent, REPO_ROOT } from "./load-data";
import type { ActJson } from "./schema";
import { analyzeMapGraph, checkMapGraph, generateMapGraph } from "../../../src/core/map/index";

/** 每个幕扫多少个种子：docs/48 §3.3「所有生成种子连通性必过」的常驻检查。 */
const MAP_SEED_SWEEP = 256;
/** 跨种子方差抽样数（docs/48 §3.3 修订 4）：≥100。 */
const MAP_VARIANCE_SEEDS = 128;

function topShare(counts: Map<string, number>, total: number): { value: string; share: number; distinct: number } {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { value: sorted[0]?.[0] ?? "", share: sorted[0] ? sorted[0][1] / total : 1, distinct: counts.size };
}

/**
 * 跨种子方差断言（docs/48 §3.3 修订 4）：分支点数 / 精英层位 / 可行路径数 / 节点数不聚类。
 * 「同种子同图」是复现性，「不同种子不同图」是内容量——后者也要门禁。
 */
function checkMapVariance(acts: readonly ActJson[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const act of acts) {
    const typed = act as unknown as Parameters<typeof generateMapGraph>[0];
    const forks = new Map<string, number>();
    const eliteSigs = new Map<string, number>();
    const paths = new Map<string, number>();
    const nodeCounts = new Map<string, number>();
    for (let seed = 0; seed < MAP_VARIANCE_SEEDS; seed += 1) {
      const map = generateMapGraph(typed, seed);
      const analysis = analyzeMapGraph(map);
      const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
      bump(forks, String(analysis.forks));
      bump(eliteSigs, map.layers.map((l, i) => (l.nodes.some((n) => n.kind === "elite") ? i : -1)).filter((i) => i >= 0).join(","));
      bump(paths, String(analysis.paths));
      bump(nodeCounts, String(analysis.nodes));
    }
    const n = MAP_VARIANCE_SEEDS;
    const check = (label: string, m: Map<string, number>, minDistinct: number, maxShare: number): void => {
      const t = topShare(m, n);
      if (t.distinct < minDistinct) {
        issues.push({ file: `act ${act.id}`, path: "map-variance", message: `${label} 只有 ${t.distinct} 种取值（应 ≥${minDistinct}）——地图在重复自己` });
      } else if (t.share > maxShare) {
        issues.push({ file: `act ${act.id}`, path: "map-variance", message: `${label} 有 ${Math.round(t.share * 100)}% 的种子落在 "${t.value}"（应 ≤${Math.round(maxShare * 100)}%）——聚类明显` });
      }
    };
    check("三分叉数", forks, 2, 0.85);
    check("精英层位", eliteSigs, 5, 0.5);
    check("可行路径数", paths, 4, 0.7);
    check("节点总数", nodeCounts, 3, 0.6);
  }
  return issues;
}

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
  const issues = [...result.issues, ...checkMapConnectivity(result.acts), ...checkMapVariance(result.acts)];
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
  console.log(`  地图方差：${acts.length} 幕 × ${MAP_VARIANCE_SEEDS} 种子——分支点 / 精英层位 / 路径数 / 节点数不聚类（§3.3 修订 4）`);
  console.log(`  root: ${REPO_ROOT}`);
  return 0;
}

process.exitCode = main();