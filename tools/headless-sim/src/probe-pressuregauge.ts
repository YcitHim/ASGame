/**
 * probe · pressuregauge 阈值扫描（docs/43 §2.2 的复核证据）
 *
 * 在内存里改写 clampCharge 的 value，同一批种子跑 400 局，隔离「阈值」这一个变量。
 * value = 0 → 等同于没有这件遗物（core 里 value > 0 才生效）。
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

console.log("[probe] pressuregauge clampCharge 阈值扫描 · 400 局 · normal · 单幕");
for (const cls of ["engineer", "bloodwright", "rustspeaker"]) {
  console.log(`  ${cls} 空随身槽基线 ${(baseline(cls) * 100).toFixed(1)}%`);
}
for (const value of [0, 3, 4, 5, 6, 8]) {
  const effects = def.effects.map((e) =>
    e.kind === "clampCharge" ? { ...e, value } : e,
  );
  (content.relics as unknown as Map<string, RelicDefinition>).set("pressuregauge", { ...def, effects });
  const cells: string[] = [];
  for (const cls of ["engineer", "bloodwright", "rustspeaker"]) {
    const r = buildReport(seeds.map((s) => simulateRun(content, act, s, cls, "normal", [], "pressuregauge")));
    cells.push(`${cls} ${(r.winRate * 100).toFixed(1)}%`);
  }
  console.log(`  value=${value}  ${cells.join("  ")}`);
}
