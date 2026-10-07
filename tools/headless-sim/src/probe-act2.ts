/**
 * probe · 第二幕小怪 HP 压降曲线（docs/40 §九-5 / docs/43 Q5）
 *
 * 只在内存里缩放第二幕敌人的 maxHp，同批种子跑双幕，量出「压多少 → 胜率到哪」。
 * row A：只压小怪（不含 bell_warden）；row B：小怪 + bell_warden。
 * 精英（sanctum_jailer / tidecaller）与 Boss（drowned_choirmaster）不动。
 */
import { loadNodeContent } from "./load";
import { buildReport } from "./report";
import { simulateRun } from "./sim";

const { content, acts } = loadNodeContent();
if (acts.length < 2) throw new Error("需要两幕数据");
const SMALL = ["drowned_crawler", "tide_swarm", "choir_echo", "rust_pilgrim", "deep_diver", "tide_mite", "rust_acolyte"];
const WITH_BELL = [...SMALL, "bell_warden"];
const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
const cls = process.argv[2] ?? "engineer";
const original = new Map<string, number>();
for (const id of WITH_BELL) {
  const def = content.enemies.get(id);
  if (def) original.set(id, def.maxHp);
}

function scale(ids: readonly string[], factor: number): void {
  for (const [id, hp] of original) {
    const def = content.enemies.get(id);
    if (!def) continue;
    const target = ids.includes(id) ? Math.max(1, Math.round(hp * factor)) : hp;
    (content.enemies as unknown as Map<string, { maxHp: number }>).set(id, { ...def, maxHp: target });
  }
}

function run(): string {
  const results = seeds.map((seed) => simulateRun(content, acts[0]!, seed, cls, "normal", [acts[0]!, acts[1]!]));
  const r = buildReport(results);
  return `胜率 ${(r.winRate * 100).toFixed(1)}% · 过精英 P50 ${r.eliteHpP50} · 过Boss P50 ${r.bossHpP50}`;
}

console.log(`[probe] 第二幕 HP 压降曲线 · ${cls} · 200 局双幕 · 同批种子`);
for (const factor of [1.0, 0.85, 0.7, 0.55, 0.4]) {
  scale(SMALL, factor);
  console.log(`  小怪 ×${factor.toFixed(2)}        ${run()}`);
}
for (const factor of [0.85, 0.7, 0.55]) {
  scale(WITH_BELL, factor);
  console.log(`  小怪+bell ×${factor.toFixed(2)}   ${run()}`);
}
