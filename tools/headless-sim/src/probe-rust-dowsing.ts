/**
 * probe · 寻锈杖（rust_dowsing）排查（docs/43 §2.2 / §五）
 *
 * 该件 = 「每场战斗开始抽 2 张」。在确定性引擎里这是单调增益，但 400 局口径一直贴/低于基线。
 * 本探针做两件事：① 换三批互不相交的种子看重复性；② 把局内计数摊开看有没有机制性解释。
 */
import { loadNodeContent } from "./load";
import { buildReport } from "./report";
import { simulateRun } from "./sim";

const { content, acts } = loadNodeContent();
const act = acts[0]!;
const cls = "rustspeaker";
const batches: { label: string; seeds: number[] }[] = [
  { label: "1..400", seeds: Array.from({ length: 400 }, (_, i) => i + 1) },
  { label: "1001..1400", seeds: Array.from({ length: 400 }, (_, i) => i + 1001) },
  { label: "2001..2400", seeds: Array.from({ length: 400 }, (_, i) => i + 2001) },
];
const variants: { label: string; companion: string }[] = [
  { label: "空随身槽", companion: "" },
  { label: "寻锈杖", companion: "rust_dowsing" },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`[probe] 寻锈杖 · ${cls} · 单幕 normal · 每批 400 局`);
for (const batch of batches) {
  const cells: string[] = [];
  for (const v of variants) {
    const rs = batch.seeds.map((s) => simulateRun(content, act, s, cls, "normal", [], v.companion));
    const r = buildReport(rs);
    cells.push(
      `${v.label} ${pct(r.winRate)}（承伤 ${r.avgDamageTaken.toFixed(1)} · 回合 ${r.avgTurns.toFixed(1)} · 战斗 ${r.avgBattles.toFixed(1)}）`,
    );
  }
  console.log(`  ${batch.label.padEnd(10)} ${cells.join("  |  ")}`);
}
