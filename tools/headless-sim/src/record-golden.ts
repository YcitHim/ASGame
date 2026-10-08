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

/** P11 第二幕卡组：腐蚀施加 / 腐蚀条件增伤 / 污染缩放 / 污染清除 + 召唤使 */
const act2Deck: GoldenDeckEntry[] = [
  ...Array.from({ length: 3 }, () => base("strike")),
  base("strike", ["sanctum_quench"]),
  ...Array.from({ length: 2 }, () => base("pistonjab")),
  base("brassguard"),
  base("steambolt", ["sunk_cost"]),
  base("chargedhammer", ["choir_reverb"], true),
  base("pressurevalve", ["abyssal_hush"]),
  base("gearspin"),
];

/** docs/58 特性回归：血械嗜血盘——多带血契牌，保证「自伤 + 造伤」两段都跑到 */
const bloodthirstDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 4 }, () => base("strike")),
  ...Array.from({ length: 3 }, () => base("defend")),
  ...Array.from({ length: 3 }, () => base("bloodbolt")),
];

/** docs/58 特性回归：锈语者畸变盘——开局污染 400（触手 / 大鲨臂 / 神眼三档全开） */
const mutationDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 2 }, () => base("rustspit")),
  base("rustnail"),
  ...Array.from({ length: 3 }, () => base("scrapguard")),
  ...Array.from({ length: 2 }, () => base("toxsip")),
  base("venthex"),
  base("salve"),
  base("rustspit"),
];

/**
 * docs/58 §五 铁皮王八盘：**防御 + 少量收尾**——AI 打分里格挡只值 0.7×，
 * 所以卡组以格挡牌为主（逼它每回合把格挡铺到 8 点以上，跑到「回合末判定格挡 → 得荆棘 → 反弹」），
 * 另留足量攻击牌让战斗能正常收尾（纯防御盘会拖成 60+ 回合的僵局，哨兵价值低）。
 * 甲方 2026-10-07 三次修订后荆棘改为**每回合刷新**（不再累加），输出更依赖主动攻击。
 */
const ironhideDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 5 }, () => base("brassguard")),
  ...Array.from({ length: 2 }, () => base("coiled_spring")),
  ...Array.from({ length: 4 }, () => base("pistonjab")),
];

/**
 * docs/58 §六 玻璃大炮盘：**蓄能向卡组**——
 * grandwindup(+10)/chargeup(+3) 把充能推过 10 攒出超负荷，攻击牌由 AI 优先打出，
 * 于是「身上已有超负荷时的第一张攻击牌」这条爆发链一定会被跑到（通常在第 3 回合）。
 */
const glassCannonDeck: GoldenDeckEntry[] = [
  ...Array.from({ length: 3 }, () => base("grandwindup")),
  ...Array.from({ length: 3 }, () => base("chargeup")),
  ...Array.from({ length: 3 }, () => base("pistonjab")),
];

/**
 * 甲方 2026-10-08 炉心新机制盘：三处改动各留一条回归链——
 * - **超械铁拳** overclockfist：8 格挡 + 蓄力一回合（delayTurns）→ 下回合「铁拳」入手（0 费 24 伤）；
 * - **上发条** windup：充能储蓄（bankCharge）——扣光当前充能，下回合还回等量 +1；
 * - **红线运转** redline：X 费（costX）——把当前能量全烧成充能。
 * 格挡牌留足量，保证盘能正常收尾（AI 不会玩蓄力，属预期）。
 */
const chargepackDeck: GoldenDeckEntry[] = [
  // 上发条（2026-10-08 起 2 费）占绝对多数：它卡面「零收益」，AI 只在能量有余时才打，
  // 必须靠数量把它挤进手牌，否则会被 3 费的超械铁拳吃光能量（实测如此）。
  ...Array.from({ length: 8 }, () => base("windup")),
  base("overclockfist"),
  base("redline"),
  ...Array.from({ length: 3 }, () => base("brassguard")),
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
  }),  recordBattle({
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
  // 第二幕：沉没圣堂（召唤 / 腐蚀 / 污染缩放 / 污染清除 回归）
  recordBattle({
    content,
    id: "golden-act2",
    nodeId: "l7",
    enemies: ["tidecaller", "bell_warden"],
    deck: act2Deck,
    relics: ["dentedcoil", "pressuregauge", "rust_charm"],
    seed: 20261006,
  }),
  // 职业特性（docs/58）回归盘：每个特性一张，走真实回合循环把特性钩子跑全
  recordBattle({
    content,
    id: "golden-trait-bloodthirst",
    nodeId: "n1",
    enemies: ["rust_hound", "polluting_preacher"],
    deck: bloodthirstDeck,
    relics: ["broken_oil", "blood_pump"],
    seed: 20261007,
    maxHp: 70, // docs/58 §三 血械 66 → 70
    traitId: "bloodthirst",
  }),
  recordBattle({
    content,
    id: "golden-trait-turtle",
    nodeId: "n2",
    enemies: ["corroded_swarm", "riveted_heavy"],
    deck: ironhideDeck,
    relics: ["dentedcoil", "pressuregauge"],
    seed: 20261008,
    maxHp: 50, // docs/58 §三 炉心 66 → 50
    traitId: "ironhide_turtle",
  }),
  recordBattle({
    content,
    id: "golden-trait-cannon",
    nodeId: "n2",
    enemies: ["corroded_swarm", "riveted_heavy"],
    deck: glassCannonDeck,
    relics: ["dentedcoil", "pressuregauge"],
    seed: 20261009,
    maxHp: 50,
    traitId: "glass_cannon",
  }),
  recordBattle({
    content,
    id: "golden-trait-mutation",
    nodeId: "n2",
    enemies: ["corroded_swarm", "riveted_heavy"],
    deck: mutationDeck,
    relics: ["rust_rosary"],
    seed: 20261010,
    maxHp: 60, // docs/58 §三 锈语者 66 → 60
    traitId: "super_mutation",
    pollution: 400, // 开局快照：触手 + 大鲨臂 + 神眼三档全开
  }),
  // 甲方 2026-10-08 炉心新机制（充能储蓄 / X 费 / 蓄力给牌）：不带特性，纯卡牌回归
  recordBattle({
    content,
    id: "golden-chargepack",
    nodeId: "n2",
    enemies: ["corroded_swarm", "riveted_heavy"],
    deck: chargepackDeck,
    relics: ["dentedcoil", "pressuregauge"],
    seed: 20261011,
    maxHp: 50, // docs/58 §三 炉心 66 → 50
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
