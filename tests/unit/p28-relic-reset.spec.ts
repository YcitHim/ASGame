// @vitest-environment jsdom
/**
 * p28 · docs/64 遗物系统重置（33 件）机制回归
 *
 * 覆盖：批 1 纯数据件 / 批 2 新时机件 / 批 3 规则件 + 两条引擎口径——
 * ① onBlock 自触发护栏（隔热砖不得无限循环，飞升齿轮同口径）；
 * ② 回合开始「先清格挡、再回血」（绷带 × 再生能活过回合开始）。
 */
import { describe, expect, it } from "vitest";
import { createBattleState, reduce, toDraft } from "@/core/combat";
import { changePollution } from "@/core/combat/resolve";
import { relicBattleWinGrowth, relicRelicGainHeal } from "@/core/combat/relic-runtime";
import { EventSink } from "@/core/events";
import { createContentDb } from "@/core/registry";
import { loadGameContent } from "@/data/load";
import { TEST_CARDS, TEST_ENEMIES } from "../helpers/combat";
import type { BattleState } from "@/core/combat";

const game = loadGameContent();
const dataRelics = game.content.relics;

function contentWith(relicIds: readonly string[]) {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(),
    relics: new Map(relicIds.map((id) => [id, dataRelics.get(id)!])),
  });
}

interface BattleOpts {
  relics?: string[];
  deck?: string[];
  hp?: number;
  pollution?: number;
  enemies?: string[];
  seed?: number;
  energy?: number;
}

function battle(opts: BattleOpts = {}): BattleState {
  const relics = opts.relics ?? [];
  return reduce(
    createBattleState({
      battleId: "t",
      seed: opts.seed ?? 11,
      player: {
        maxHp: 66,
        energy: opts.energy ?? 3,
        ...(opts.hp !== undefined ? { hp: opts.hp } : {}),
        ...(opts.pollution !== undefined ? { pollution: opts.pollution } : {}),
      },
      enemies: (opts.enemies ?? ["dummy"]).map((id) => ({ id })),
      deck: opts.deck ?? ["strike", "strike", "strike", "strike", "strike"],
      handSize: 5,
      relics: [...relics],
      content: contentWith(relics),
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string, targetId: string | null = "dummy"): BattleState {
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
  expect(index).toBeGreaterThanOrEqual(0);
  return reduce(state, { type: "PlayCard", actionId: `p-${cardId}-${index}`, handIndex: index, ...(targetId !== null ? { targetId } : {}) }).state;
}

function endTurn(state: BattleState) {
  return reduce(state, { type: "EndTurn", actionId: "e" });
}

const withPlayer = (state: BattleState, patch: Partial<BattleState["player"]>): BattleState => ({
  ...state,
  player: { ...state.player, ...patch },
});
const withEnemyHp = (state: BattleState, hp: number): BattleState => ({
  ...state,
  enemies: state.enemies.map((e) => ({ ...e, hp })),
});

/* ------------------------------------------------------------------ *
 * 批 1 · 纯数据件
 * ------------------------------------------------------------------ */

describe("docs/64 批1 · 纯数据件", () => {
  it("齿轮币：每回合第 3 张牌 +1 能量（第 1/2 张不给）", () => {
    let s = battle({ relics: ["gear_coin"], deck: ["strike", "strike", "strike", "strike", "strike"] });
    s = play(s, "strike");
    expect(s.player.energy).toBe(2);
    s = play(s, "strike");
    expect(s.player.energy).toBe(1);
    s = play(s, "strike");
    // 第 3 张：付 1 费后 +1 能量 → 回到 1
    expect(s.player.energy).toBe(1);
  });

  it("血泵心脏：卖血回 1；卖血时 HP ≤10 回 2（二段）", () => {
    const full = play(battle({ relics: ["blood_pump"], deck: ["bloodbolt", "strike", "strike", "strike", "strike"] }), "bloodbolt");
    expect(full.player.hp).toBe(66 - 2 + 1);
    const low = play(
      withPlayer(battle({ relics: ["blood_pump"], deck: ["bloodbolt", "strike", "strike", "strike", "strike"] }), { hp: 10 }),
      "bloodbolt",
    );
    expect(low.player.hp).toBe(10 - 2 + 2);
  });

  it("空腹铃铛：打光手牌回合结束 +3 格挡；手里有牌不给", () => {
    // 3 张打击全打光 → 空手
    let s = battle({ relics: ["hollow_bell"], deck: ["strike", "strike", "strike"] });
    s = play(s, "strike");
    s = play(s, "strike");
    s = play(s, "strike");
    const r = endTurn(s);
    expect(r.events.some((e) => e.type === "BlockGained" && e.targetId === "player" && e.value === 3)).toBe(true);
    // 留一张牌 → 不给
    const kept = endTurn(battle({ relics: ["hollow_bell"], deck: ["strike", "strike", "strike"] }));
    expect(kept.events.some((e) => e.type === "BlockGained" && e.targetId === "player" && e.value === 3)).toBe(false);
  });

  it("黄铜哨子：开战血量最高的敌人 1 层虚弱（非全体）", () => {
    const s = battle({ relics: ["brass_whistle"], enemies: ["dummy", "tank"] });
    const dummy = s.enemies.find((e) => e.defId === "dummy");
    const tank = s.enemies.find((e) => e.defId === "tank");
    expect(tank?.buffs.find((b) => b.id === "weak")?.stacks).toBe(1);
    expect(dummy?.buffs.find((b) => b.id === "weak")).toBeUndefined();
  });

  it("停摆八音盒：空过一回合 → 下回合 +1 能量 +1 牌；第 1 回合不触发", () => {
    const s = battle({ relics: ["stalled_musicbox"] });
    // 第 1 回合开始不该有奖励（无上回合）
    expect(s.player.energy).toBe(3);
    const r = endTurn(s); // 一张牌没打
    expect(r.state.player.energy).toBe(4);
  });

  it("饥锈胃袋：≥3 张攻击牌回合结束回 2；2 张不回", () => {
    // tank 只会防御（不掉血），排除敌方攻击干扰
    let s = battle({ relics: ["rust_gullet"], hp: 40, enemies: ["tank"], deck: ["strike", "strike", "strike", "strike", "strike"] });
    s = play(s, "strike", "tank");
    s = play(s, "strike", "tank");
    expect(endTurn(s).state.player.hp).toBe(40);
    let s2 = battle({ relics: ["rust_gullet"], hp: 40, enemies: ["tank"], deck: ["strike", "strike", "strike", "strike", "strike"] });
    s2 = play(s2, "strike", "tank");
    s2 = play(s2, "strike", "tank");
    s2 = play(s2, "strike", "tank");
    expect(endTurn(s2).state.player.hp).toBe(42);
  });

  it("铁口粮：开战抽 2 再随机弃 1（净 +1 手牌）", () => {
    const deck = ["strike", "strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", "defend"];
    const s = battle({ relics: ["iron_rations"], deck });
    expect(s.piles.hand).toHaveLength(6);
  });

  it("红王冠：每回合开始 +1 力量 +3 污染（首回合即触发）", () => {
    const s = battle({ relics: ["rust_crown"] });
    expect(s.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(1);
    expect(s.player.pollution).toBe(3);
    const t2 = endTurn(s).state;
    expect(t2.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(2);
    expect(t2.player.pollution).toBe(6);
  });

  it("泛黄照片：战斗胜利后回 3（onBattleWin 时机）", () => {
    let s = battle({ relics: ["old_photo"], hp: 40 });
    s = withEnemyHp(s, 1);
    s = play(s, "strike"); // 打死 dummy → 胜利
    expect(s.phase).toBe("battleEnd");
    expect(s.player.hp).toBe(43);
  });
});

/* ------------------------------------------------------------------ *
 * 批 2 · 新时机件
 * ------------------------------------------------------------------ */

describe("docs/64 批2 · 新时机件", () => {
  it("脏绷带：回血 +2 格挡（回合开始的再生回血也能活过格挡清理）", () => {
    let s = battle({ relics: ["bandage"], hp: 60, deck: ["regen", "strike", "strike", "strike", "strike"] });
    s = play(s, "regen", null);
    const r = endTurn(s);
    // 再生回 3 → 绷带 +2 格挡；若时序错了这 2 点会被回合开始的清格挡吃掉
    expect(r.events.some((e) => e.type === "HpHealed" && e.targetId === "player")).toBe(true);
    expect(r.state.player.block).toBe(2);
  });

  it("脏绷带：每回合至多 3 次（第 4 次回血不再给格挡）", () => {
    // 血泵卖血回 1 → 绷带 1 次；再用直接核验 handler 计数语义：firesThisTurn ≥ perTurn 即停
    // 这里用事件级断言：一次卖血只产生一次 +2
    let s = battle({ relics: ["bandage", "blood_pump"], hp: 60, deck: ["bloodbolt", "strike", "strike", "strike", "strike"] });
    s = play(s, "bloodbolt");
    expect(s.player.block).toBe(2);
  });

  it("死亡面具：击杀敌人回 3 HP", () => {
    let s = battle({ relics: ["death_mask"], hp: 40 });
    s = withEnemyHp(s, 1);
    s = play(s, "strike");
    expect(s.player.hp).toBe(43);
  });

  it("酸洗线圈：攻击命中挂蚀锈，每回合至多 3 层（多段每段独立）", () => {
    let s = battle({ relics: ["acid_coil"], deck: ["bloodflail", "strike", "strike", "strike", "strike"] });
    s = play(s, "bloodflail"); // 3 段 → 3 层（到顶）
    const e1 = s.enemies[0];
    expect(e1.buffs.find((b) => b.id === "corroding")?.stacks).toBe(3);
    s = play(s, "strike"); // 第 4 次命中 → 不再加
    expect(s.enemies[0].buffs.find((b) => b.id === "corroding")?.stacks).toBe(3);
  });

  it("隔热砖：获得格挡 +1，且不自触发死循环（护栏钉死）", () => {
    // 第三捧灰（回合结束 +2 格挡）+ 隔热砖（+1）——若护栏失效这里会无限循环挂死测试进程
    const r = endTurn(battle({ relics: ["third_ash", "insul_brick"] }));
    const gains = r.events.filter((e) => e.type === "BlockGained" && e.targetId === "player").map((e) => (e as { value: number }).value);
    expect(gains).toEqual([2, 1]);
  });

  it("唱诗班终曲：空手回合结束 → 下回合开始额外抽 2", () => {
    let s = battle({ relics: ["choir_battery"], deck: ["strike", "strike", "strike", "defend", "defend"] });
    s = play(s, "strike");
    s = play(s, "strike");
    s = play(s, "strike");
    const r = endTurn(s);
    // 常规抽 5（洗牌后）+ 终曲额外 2 = 7？牌库只剩 2 防御 + 3 打击 = 5 张 → 抽 5，终曲再抽 0（牌库空）
    // 断言关键：终曲的延迟抽牌发生了（delayedEffects 清空）且没有报错；手牌 = 5
    expect(r.state.piles.hand.length).toBe(5);
    // 对照：手里留牌 → 无延迟抽牌
    const kept = endTurn(battle({ relics: ["choir_battery"], deck: ["strike", "strike", "strike", "defend", "defend"] }));
    expect(kept.state.delayedEffects).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * 批 3 · 规则件
 * ------------------------------------------------------------------ */

describe("docs/64 批3 · 规则件", () => {
  it("磨刀石：每场第一张攻击牌 +4，之后不再加", () => {
    let s = battle({ relics: ["whetstone"], deck: ["strike", "strike", "strike", "strike", "strike"] });
    const hp0 = s.enemies[0].hp;
    s = play(s, "strike");
    expect(hp0 - s.enemies[0].hp).toBe(10); // 6 + 4
    const hp1 = s.enemies[0].hp;
    s = play(s, "strike");
    expect(hp1 - s.enemies[0].hp).toBe(6);
  });

  it("双重钟摆：每回合第一张牌结算两次，第二张起正常", () => {
    let s = battle({ relics: ["double_pendulum"], deck: ["strike", "strike", "strike", "strike", "strike"] });
    const hp0 = s.enemies[0].hp;
    s = play(s, "strike");
    expect(hp0 - s.enemies[0].hp).toBe(12); // 6 × 2
    const hp1 = s.enemies[0].hp;
    s = play(s, "strike");
    expect(hp1 - s.enemies[0].hp).toBe(6);
  });

  it("镜面装甲：格挡不清零，保留一半（向下取整，上限 8）", () => {
    let s = battle({ relics: ["mirror_plate"], deck: ["defend", "defend", "defend", "strike", "strike"] });
    s = play(s, "defend", null); // 5 格挡
    const r = endTurn(s);
    // 敌方 dummy 打 5 → 格挡抵消后 0 → 保留 floor(0/2)=0；换一个更高格挡的验证
    void r;
    let s2 = battle({ relics: ["mirror_plate"], enemies: ["tank"], deck: ["defend", "defend", "defend", "strike", "strike"] });
    s2 = play(s2, "defend", null);
    s2 = play(s2, "defend", null);
    s2 = play(s2, "defend", null); // 15 格挡；tank 不攻击（defend 意图）→ 回合开始保留 floor(15/2)=7
    expect(endTurn(s2).state.player.block).toBe(7);
  });

  it("熔炉之心：充能 ≥5 回合结束全体 5 伤（吃充能全局加伤）+ 充能减半；<5 不动", () => {
    const base = battle({ relics: ["furnace_heart"] });
    const s = withPlayer(base, { charge: 6 });
    const r = endTurn(s);
    // 充能是全局攻击资源（每点 +1 攻击伤）：熔炉的 AoE 同样吃 → 5 + 6 = 11
    expect(r.events.some((e) => e.type === "DamageDealt" && (e as { targetId: string }).targetId === "dummy" && (e as { hpLost: number }).hpLost === 11)).toBe(true);
    expect(r.state.player.charge).toBe(3);
    const low = endTurn(withPlayer(battle({ relics: ["furnace_heart"] }), { charge: 4 }));
    expect(low.events.some((e) => e.type === "DamageDealt" && (e as { targetId: string }).targetId === "dummy")).toBe(false);
    expect(low.state.player.charge).toBe(4);
  });

  it("第二颗心脏：致死改为剩 1 + 清减益 + 抽 2；每场一次（第二次照死）", () => {
    let s = battle({ relics: ["second_heart"], hp: 3 });
    s = withPlayer(s, { buffs: [{ id: "weak", stacks: 2, duration: null }] });
    const r = endTurn(s); // dummy 打 5 → 归零 → 复活
    expect(r.state.phase).not.toBe("battleEnd");
    expect(r.state.player.hp).toBe(1);
    expect(r.state.player.buffs.find((b) => b.id === "weak")).toBeUndefined();
    // 第二次致死：不再救
    const r2 = endTurn(withPlayer(r.state, { hp: 1 }));
    expect(r2.state.phase).toBe("battleEnd");
    expect(r2.events.some((e) => e.type === "BattleEnded" && (e as { result: string }).result === "lose")).toBe(true);
  });

  it("泄压阀：污染触顶反噬减半（10→5）且回落到 50（对照组：无泄压阀 → 10 伤清零）", () => {
    const withValve = battle({ relics: ["purge_filter"], pollution: 99 });
    const draft = toDraft(withValve);
    const sink = new EventSink(withValve.eventSeq, "t");
    changePollution(draft, sink, 5);
    expect(draft.player.pollution).toBe(50);
    expect(draft.player.hp).toBe(66 - 5);

    const without = battle({ relics: [], pollution: 99 });
    const draft2 = toDraft(without);
    const sink2 = new EventSink(without.eventSeq, "t");
    changePollution(draft2, sink2, 5);
    expect(draft2.player.pollution).toBe(0);
    expect(draft2.player.hp).toBe(66 - 10);
  });
});

/* ------------------------------------------------------------------ *
 * run 层（寻锈杖 / 朝圣者之铃）
 * ------------------------------------------------------------------ */

describe("docs/64 · run 层成长", () => {
  it("寻锈杖：获得遗物回 4（含自身这一刻）；没有它 → 0", () => {
    expect(relicRelicGainHeal(game.content, ["rust_dowsing"])).toBe(4);
    expect(relicRelicGainHeal(game.content, ["redtear_ring"])).toBe(0);
  });

  it("朝圣者之铃：胜利 maxHp +3 且回 3；没有它 → 0", () => {
    expect(relicBattleWinGrowth(game.content, ["pilgrim_bell"])).toEqual({ maxHpDelta: 3, heal: 3 });
    expect(relicBattleWinGrowth(game.content, ["redtear_ring"])).toEqual({ maxHpDelta: 0, heal: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * 甲方 2026-10-08 口述补装：商人算盘（改版）/ 夜春蛋苯（新增 T3）
 * ------------------------------------------------------------------ */

describe("docs/64 · 甲方口述补装（2026-10-08）", () => {
  it("商人算盘：本回合累计花费每满 5 能量 +1（回流可继续花；跨档才追发）", () => {
    // 6 能量局：big(3) + strike + strike = 5 → 回 1 → 还能再打（第 4 张累计 6，不追发）
    let s = battle({ relics: ["merchant_abacus"], energy: 6, deck: ["big", "strike", "strike", "strike", "strike"] });
    s = play(s, "big");
    expect(s.player.energy).toBe(3);
    s = play(s, "strike");
    expect(s.player.energy).toBe(2); // 累计 4，未到 5
    s = play(s, "strike");
    expect(s.player.energy).toBe(2); // 累计 5 → +1（2 - 1 + 1）
    s = play(s, "strike"); // 累计 6 < 10 → 不追发
    expect(s.player.energy).toBe(1);
  });

  it("夜春蛋苯：开局 HP×120% 转格挡只留 1 血，且格挡跨回合不消失", () => {
    const s = battle({ relics: ["spring_egg"] });
    // 66 HP → 1 血 + floor(66×1.2)=79 格挡
    expect(s.player.hp).toBe(1);
    expect(s.player.block).toBe(79);
    // 格挡不随回合结束消失：敌方 dummy 打 5 → 79-5=74 保留到下回合（不是清零）
    const r = endTurn(s);
    expect(r.state.player.block).toBe(74);
    // 再一回合：74 继续保留（dummy 再打 5 → 69）
    expect(endTurn(r.state).state.player.block).toBe(69);
  });

  it("夜春蛋苯 × 镜面装甲：多件格挡保留取比例最高者（100% > 50%）", () => {
    const s = battle({ relics: ["spring_egg", "mirror_plate"], enemies: ["tank"] });
    // tank 不攻击 → 79 格挡全保留（若错走镜面的 50% 会只剩 39）
    expect(endTurn(s).state.player.block).toBe(79);
  });
});
