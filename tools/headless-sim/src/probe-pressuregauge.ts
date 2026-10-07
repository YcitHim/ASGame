/**
 * probe · pressuregauge 效果值扫描（docs/45 Q5）
 *
 * 在内存里把遗物的效果值改成 N，同一批种子跑 400 局，量出它相对「空随身槽」基线的位置。
 * 兼容两种效果：clampCharge（封顶）与 gainCharge（战斗开始给 N 点）。
 * 两种口径的结论完全不同——clamp 越高越强、约白装；gainCharge 是通用伤害加成，一点都不能给。
 */
import type { RelicDefinition } from "../../../src/core/registry/content";
import { loadNodeContent } from "./load";
import { buildReport } from "./report";
import { simulateRun } from "./sim";

const { content, acts } = loadNodeContent();
const act = acts[0];
if (!act) throw new Error("找不到第一幕");
const seeds = Array.from({ length: 400 }, (_, i) => i + 1);
const baseline = (cls: string): number =>
  buildReport(seeds.map((s) => simulateRun(content, act, s, cls, "normal", [], ""))).winRate;

const def = content.relics.get("pressuregauge");
if (!def) throw new Error("找不到 pressuregauge");

const effectKind = def.effects[0]?.kind ?? "?";
console.log(`[probe] pressuregauge（${effectKind}）值扫描 · 400 局 · normal · 单幕`);
for (const cls of ["engineer", "bloodwright", "rustspeaker"]) {
  console.log(`  ${cls} 空随身槽基线 ${(baseline(cls) * 100).toFixed(1)}%`);
}
for (const value of [0, 1, 2, 3, 5, 8]) {
  const effects = def.effects.map((e) => (e.kind === effectKind ? { ...e, value } : e));
  (content.relics as unknown as Map<string, RelicDefinition>).set("pressuregauge", { ...def, effects });
  const cells: string[] = [];
  for (const cls of ["engineer", "bloodwright", "rustspeaker"]) {
    const r = buildReport(seeds.map((s) => simulateRun(content, act, s, cls, "normal", [], "pressuregauge")));
    cells.push(`${cls} ${(r.winRate * 100).toFixed(1)}%`);
  }
  console.log(`  value=${value}  ${cells.join("  ")}`);
}
