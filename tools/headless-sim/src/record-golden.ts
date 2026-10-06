import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadNodeContent, REPO_ROOT } from "./load";
import { recordBattle, type GoldenDeckEntry, type GoldenFile } from "./record";

const { content } = loadNodeContent();

function base(cardId: string, enhancements: string[] = [], upgraded = false): GoldenDeckEntry {
  return { cardId, upgraded, enhancements };
}

const startDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 5 }, () => base("strike")),
  ...Array.from({ length: 4 }, () => base("defend")),
  base("bloodbolt"),
];

/** 覆盖升级 / 三种强化 / 多段 / 关键词的进阶卡组 */
const runDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 4 }, () => base("strike")),
  base("strike", ["empower"]),
  ...Array.from({ length: 3 }, () => base("defend")),
  base("bloodbolt", ["thrifty_pact"]),
  base("bloodflail", ["empower"]),
  base("redtear", ["bloodboil"]),
  base("brace", [], true),
  base("exsanguinate"),
];

/** P2 连锁卡组：反伤（荆棘血痂，占多数保证 AI 一定打出）+ 事件回看（以血还血）+ 面对带亡语的虫群 */
const chainDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 8 }, () => base("thornscab")),
  base("bloodforblood"),
  base("strike"),
];

/** P5 炉心机士卡组：多段 / 蓄压 / spendCharge / 充能固定加伤 回归 */
const engineerDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 4 }, () => base("pistonjab")),
  ...Array.from({ length: 3 }, () => base("brassguard")),
  base("gearspin"),
  base("sparkplug"),
  base("chargedhammer", [], true),
  base("pressurevalve"),
  base("steambolt"),
];

const battles = [
  recordBattle({
    content,
    id: "golden-n1",
    nodeId: "n1",
    enemies: ["rust_hound", "polluting_preacher"],
    deck: startDeck,
    relics: ["broken_oil", "blood_pump"],
    seed: 20261005,
  }),
  recordBattle({
    content,
    id: "golden-n2",
    nodeId: "n2",
    enemies: ["corroded_swarm", "riveted_heavy"],
    deck: runDeck,
    relics: ["broken_oil", "blood_pump", "redtear_ring"],
    seed: 424242,
  }),
  recordBattle({
    content,
    id: "golden-chain",
    nodeId: "n2",
    enemies: ["corroded_swarm", "riveted_heavy"],
    deck: chainDeck,
    relics: ["broken_pump", "broken_oil"],
    seed: 31337,
  }),
  recordBattle({
    content,
    id: "golden-boss",
    nodeId: "n6",
    enemies: ["rust_throat"],
    deck: runDeck,
    relics: ["broken_oil", "blood_pump", "redtear_ring", "rust_charm"],
    seed: 777,
  }),
  recordBattle({
    content,
    id: "golden-engineer",
    nodeId: "n2",
    enemies: ["corroded_swarm", "riveted_heavy"],
    deck: engineerDeck,
    relics: ["dentedcoil", "pressuregauge"],
    seed: 909090,
  }),
  // 分支地图：在「中期分支层」的遭遇池里打一场（docs/16 5.4 golden）
  recordBattle({
    content,
    id: "golden-branch",
    nodeId: "l5",
    enemies: ["rust_sentinel", "corroded_swarm"],
    deck: runDeck,
    relics: ["broken_oil", "blood_pump", "redtear_ring"],
    seed: 515151,
  }),
];

const outDir = join(REPO_ROOT, "tests", "golden-replays");
mkdirSync(outDir, { recursive: true });

for (const battle of battles) {
  const file: GoldenFile = {
    version: 1,
    recordedAt: "2026-10-05",
    content: "rust-and-blood",
    battle,
  };
  const path = join(outDir, `${battle.id}.json`);
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf8");
  console.log(`${battle.id}: ${battle.actions.length} actions · ${battle.turns} turns · ${battle.outcome} · ${battle.eventHash.slice(0, 12)}`);
}
console.log("golden replays written to tests/golden-replays/");
