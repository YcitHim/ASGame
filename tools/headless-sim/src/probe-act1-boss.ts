/**
 * probe · 第一幕 Boss（锈喉）死亡构成（docs/45 Q7-6）
 *
 * 目的：回答"第一幕 Boss 单点吃掉 41%"是「玩家残血进 Boss」还是「锈喉本身超线」。
 * 只看单幕 normal：记录进 Boss 战时的 HP / 牌组张数 / 遗物件数，以及这些局的胜负。
 */
import { loadNodeContent } from "./load";
import { simulateRun } from "./sim";

const { content, acts } = loadNodeContent();
const act = acts[0];
if (!act) throw new Error("找不到第一幕");
const bossLayer = act.layers.findIndex((l) => l.kinds.includes("boss"));
const games = Number(process.argv[2] ?? 400);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};
const avg = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

console.log(`[probe] 第一幕 Boss 死亡构成 · 单幕 normal · ${games} 局 · Boss 层 l${bossLayer}`);
for (const cls of ["engineer", "bloodwright", "rustspeaker"]) {
  const results = Array.from({ length: games }, (_, i) => simulateRun(content, act, i + 1, cls, "normal", []));
  const reached = results.filter((r) => r.hpAtBoss !== null);
  const won = reached.filter((r) => r.outcome === "win");
  const diedAtBoss = reached.filter((r) => r.outcome === "lose" && r.nodeReached === bossLayer);
  const hp = reached.map((r) => r.hpAtBoss!);
  const hpRatio = reached.map((r) => r.hpAtBoss! / 66);
  console.log(`  ${cls}`);
  console.log(`    到 Boss ${reached.length}/${games}（${pct(reached.length / games)}）· 过 Boss ${won.length}（条件胜率 ${pct(reached.length ? won.length / reached.length : 0)}）`);
  console.log(`    进 Boss 时 HP：均值 ${avg(hp).toFixed(1)}（${pct(avg(hpRatio))}）· P10 ${quantile(hp, 0.1)} / P50 ${quantile(hp, 0.5)} / P90 ${quantile(hp, 0.9)}`);
  console.log(`    进 Boss 时牌组 ${avg(reached.map((r) => r.deckSizeAtBoss!)).toFixed(1)} 张 · 遗物 ${avg(reached.map((r) => r.relicsAtBoss!)).toFixed(1)} 件`);
  console.log(`    死在 Boss ${diedAtBoss.length} 局：进战 HP 均值 ${avg(diedAtBoss.map((r) => r.hpAtBoss!)).toFixed(1)} · P50 ${quantile(diedAtBoss.map((r) => r.hpAtBoss!), 0.5)}`);
  if (won.length > 0) {
    console.log(`    过 Boss 的局：进战 HP 均值 ${avg(won.map((r) => r.hpAtBoss!)).toFixed(1)} · 牌组 ${avg(won.map((r) => r.deckSizeAtBoss!)).toFixed(1)} 张`);
  }
}
