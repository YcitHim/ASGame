/**
 * probe · 双幕死亡点分布（docs/43 Q5）
 * 用小怪 HP 压降曲线证明「小怪不是瓶颈」后，这里定位到底死在哪一层、哪一类节点。
 */
import { loadNodeContent } from "./load";
import { buildReport } from "./report";
import { simulateRun } from "./sim";

const { content, acts } = loadNodeContent();
if (acts.length < 2) throw new Error("需要两幕数据");
const cls = process.argv[2] ?? "engineer";
const games = Number(process.argv[3] ?? 400);
const factor = Number(process.argv[4] ?? 1);
/** 第二幕小怪（与 probe-act2 同口径，不含 bell_warden / 精英 / Boss）。 */
const SMALL = ["drowned_crawler", "tide_swarm", "choir_echo", "rust_pilgrim", "deep_diver", "tide_mite", "rust_acolyte"];
if (factor !== 1) {
  for (const id of SMALL) {
    const def = content.enemies.get(id);
    if (def) {
      (content.enemies as unknown as Map<string, { maxHp: number }>).set(id, {
        ...def,
        maxHp: Math.max(1, Math.round(def.maxHp * factor)),
      });
    }
  }
}
const seeds = Array.from({ length: games }, (_, i) => i + 1);
const results = seeds.map((seed) => simulateRun(content, acts[0]!, seed, cls, "normal", [acts[0]!, acts[1]!]));
const report = buildReport(results);
console.log(`[probe] ${cls} · ${games} 局双幕 · 胜率 ${(report.winRate * 100).toFixed(1)}% · 过精英 P50 ${report.eliteHpP50} · 过Boss P50 ${report.bossHpP50}`);

const hist: Record<string, number> = {};
for (const r of results) {
  const act = acts[r.reachedAct];
  const kinds = act?.layers[r.nodeReached]?.kinds?.join("+") ?? "?";
  const key = `${r.outcome === "win" ? "胜" : "负"} a${r.reachedAct + 1} l${r.nodeReached} [${kinds}]`;
  hist[key] = (hist[key] ?? 0) + 1;
}
for (const [key, n] of Object.entries(hist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key.padEnd(28)} ${n}`);
}
