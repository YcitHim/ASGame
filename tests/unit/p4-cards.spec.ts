import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";

/**
 * docs/27 §二 副线卡 ×5 + 两处新机制：
 * - 新效果 `spendCharge`（泄能重锤）
 * - 新条件 `pollutionAtLeast`（蚀心之刃）
 */

const game = loadGameContent();

/** 测试辅助卡：一次性攒 8 充能（充能无 debug 指令） */
const CHARGE8: CardDefinition = {
  id: "charge8",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "gainCharge", value: 8 }],
};

/** 测试辅助卡：一次性攒 4 充能（复现玩家反馈的起手刻度） */
const CHARGE4: CardDefinition = {
  id: "charge4",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "gainCharge", value: 4 }],
};

/** 测试辅助卡：0 费占位（只加 1 格挡），用来把牌铺进弃牌堆而不动能量/充能 */
const PAD: CardDefinition = {
  id: "pad",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "block", target: { type: "self" }, value: 1 }],
};

const content = createContentDb({
  cards: new Map([...game.content.cards, ["charge8", CHARGE8], ["charge4", CHARGE4], ["pad", PAD]]),
  enemies: new Map([
    [
      "dummy",
      {
        id: "dummy",
        name: "Dummy",
        maxHp: 200,
        intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
      },
    ],
  ]),
  enhancements: game.content.enhancements,
  relics: new Map(),
});

function battle(deck: readonly (string | { cardId: string; upgraded?: boolean })[]): BattleState {
  return reduce(
    createBattleState({
      battleId: "p4",
      seed: 5,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: "dummy" }],
      deck,
      content,
    }),
    { type: "Noop", actionId: "s" },
  ).state;
}

function play(state: BattleState, cardId: string) {
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
  return reduce(state, { type: "PlayCard", actionId: "p", handIndex: index, targetId: "dummy" });
}

const dealt = (events: readonly { type: string }[]) =>
  events
    .filter((e): e is { type: string; value: number } => e.type === "DamageDealt")
    .map((e) => e.value);

/** 这一批事件里实际抽到的牌（用来验证条件抽牌真的发生了）。 */
const drawn = (events: readonly { type: string }[]) =>
  events.flatMap((e) =>
    e.type === "CardsDrawn" && "cardIds" in e ? ((e as { cardIds: readonly string[] }).cardIds) : [],
  );

describe("P4.1 副线卡", () => {
  it("火芯刺：4 伤 + 2 充能", () => {
    const r = play(battle(["sparkjab"]), "sparkjab");
    expect(dealt(r.events)).toEqual([4]);
    expect(r.state.player.charge).toBe(2);
  });

  it("泄能重锤：先吃充能固定加伤，再按每点 +2 消耗清零", () => {
    const first = play(battle(["sparkjab", "discharge"]), "sparkjab");
    expect(first.state.player.charge).toBe(2);
    const r = play(first.state, "discharge");
    // 基础 8 + 固定充能 2 = 10；再消耗 2 点充能 ×2 = 4
    expect(dealt(r.events)).toEqual([10, 4]);
    expect(r.state.player.charge).toBe(0);
  });

  it("红线运转：耗能为 X（= 当前剩余能量）；过载才抽 2 张（甲方 2026-10-08 改版）", () => {
    // ① 普通：能量 3 → X 费把 3 点**全部花掉**，充能 +3；不过载 → 不抽
    const plain = play(battle(["redline"]), "redline");
    expect(plain.state.player.charge).toBe(3);
    expect(plain.state.player.energy).toBe(0); // X 费 = 有多少花多少
    expect(drawn(plain.events)).toHaveLength(0);

    // ② 过载：充能 8 + 能量 3 = 11 > 10 → 反噬清零、扣 5 HP，并抽 2 张
    const prepared = play(battle(["charge8", "pad", "redline"]), "charge8");
    expect(prepared.state.player.charge).toBe(8);
    const padded = play(prepared.state, "pad"); // 0 费占位：把牌铺进弃牌堆但不改能量
    expect(padded.state.player.energy).toBe(3);
    const boom = play(padded.state, "redline");
    expect(boom.events.some((e) => e.type === "Overloaded")).toBe(true);
    expect(boom.state.player.charge).toBe(0);
    expect(boom.state.player.hp).toBe(66 - 5); // 过载反噬固定 5 点
    expect(boom.state.player.energy).toBe(0);
    expect(drawn(boom.events)).toHaveLength(2);

    // ③ 升级 = X+1：同样 3 能量 → 充能 +4
    const up = play(battle([{ cardId: "redline", upgraded: true }]), "redline");
    expect(up.state.player.charge).toBe(4);
    expect(drawn(up.events)).toHaveLength(0);
  });

  it("污血献祭：污染 +12 并抽 2 张", () => {
    const r = play(battle(["blightoffering"]), "blightoffering");
    expect(r.state.player.pollution).toBe(12);
    expect(r.events.filter((e) => e.type === "CardsDrawn").length).toBeGreaterThanOrEqual(1);
  });

  it("蚀心之刃：污染 <50 打 7，≥50 打 14（新条件 pollutionAtLeast）", () => {
    const low = play(battle(["corrodededge"]), "corrodededge");
    expect(dealt(low.events)).toEqual([7]);

    const dirty = reduce(battle(["corrodededge"]), {
      type: "DebugCommand",
      actionId: "d",
      command: "add buff pollution 50",
    }).state;
    const high = play(dirty, "corrodededge");
    expect(dealt(high.events)).toEqual([14]);
  });
});

/** 甲方 2026-10-08：上发条改版（充能储蓄）+ 新卡超械铁拳（蓄力一回合给「铁拳」）。 */
describe("P4.2 充能储蓄与延迟给牌", () => {
  const handIds = (state: BattleState) => state.piles.hand.map((id) => state.cardInstances[id].cardId);

  it("上发条：扣掉当前充能，下回合一次性还回「扣掉的层数 +1」", () => {
    const charged = play(battle(["charge4", "windup"]), "charge4");
    expect(charged.state.player.charge).toBe(4);

    const up = play(charged.state, "windup");
    expect(up.state.player.charge).toBe(0); // 全扣掉
    expect(up.state.delayedEffects).toHaveLength(1);

    // 结束回合 → 敌方行动 → 新回合开始结算延迟队列
    const next = reduce(up.state, { type: "EndTurn", actionId: "e" });
    expect(next.state.player.charge).toBe(5); // 4 + 1
    expect(next.state.delayedEffects).toHaveLength(0);
  });

  it("上发条升级：额外 +2（同样 4 充能 → 还 6）", () => {
    const charged = play(battle(["charge4", { cardId: "windup", upgraded: true }]), "charge4");
    const up = play(charged.state, "windup");
    const next = reduce(up.state, { type: "EndTurn", actionId: "e" });
    expect(next.state.player.charge).toBe(6);
  });

  it("充能为 0 时仍按期还回 +1（「消耗 0 层 → 下回合 1 点」）", () => {
    const r = play(battle(["windup"]), "windup");
    expect(r.state.player.charge).toBe(0);
    const next = reduce(r.state, { type: "EndTurn", actionId: "e" });
    expect(next.state.player.charge).toBe(1);
  });

  it("超械铁拳：8 格挡 + 蓄力一回合后「铁拳」入手（0 费 24 伤）", () => {
    const r = play(battle(["overclockfist"]), "overclockfist");
    expect(r.state.player.block).toBe(8);
    // 蓄力期：铁拳还没到手
    expect(handIds(r.state)).not.toContain("ironfist");
    expect(r.state.delayedEffects).toHaveLength(1);

    const next = reduce(r.state, { type: "EndTurn", actionId: "e" });
    expect(handIds(next.state)).toContain("ironfist");
    expect(next.state.delayedEffects).toHaveLength(0);

    // 铁拳本体：0 费、24 伤、打出后消耗
    const hit = play(next.state, "ironfist");
    expect(dealt(hit.events)).toEqual([24]);
    expect(hit.state.piles.exhaust.some((id) => hit.state.cardInstances[id].cardId === "ironfist")).toBe(true);
  });

  it("铁拳带「保留」（甲方 2026-10-09）：不打出就一直留在手上，不会进弃牌堆", () => {
    const r = play(battle(["overclockfist"]), "overclockfist");
    const next = reduce(r.state, { type: "EndTurn", actionId: "e" });
    expect(handIds(next.state)).toContain("ironfist");

    // 不打出：再过一整个回合，铁拳仍在手牌（保留），且不在弃牌堆
    const kept = reduce(next.state, { type: "EndTurn", actionId: "e2" });
    expect(handIds(kept.state)).toContain("ironfist");
    expect(kept.state.piles.discard.some((id) => kept.state.cardInstances[id].cardId === "ironfist")).toBe(false);
  });

  it("超械铁拳升级：依旧 3 费，格挡 12，且下回合给的是升级「铁拳」（32 伤）", () => {
    const r = play(battle([{ cardId: "overclockfist", upgraded: true }]), "overclockfist");
    expect(r.state.player.block).toBe(12);
    // 升级面不改费：仍花光 3 点能量
    expect(r.state.player.energy).toBe(0);

    const next = reduce(r.state, { type: "EndTurn", actionId: "e" });
    const inst = next.state.piles.hand
      .map((id) => next.state.cardInstances[id])
      .find((c) => c.cardId === "ironfist");
    expect(inst?.upgraded).toBe(true);

    const hit = play(next.state, "ironfist");
    expect(dealt(hit.events)).toEqual([32]);
  });
});

/** 甲方 2026-10-08：所有「打出一次即全场持续」的牌一律带消耗，防回流牌库。 */
describe("P4.3 「全场持续」类卡一律消耗", () => {
  const SET = [
    "redlineprotocol",
    "ascensiongear",
    "kineticcell",
    "slagarmor",
    "bloodrust",
    "ironstomach",
    "rustapotheosis",
    "redzone",
    "ninety_nine",
    "crimsonpact",
    "immortality",
    "frenzy",
    // 甲方 2026-10-09：炉心本场能力牌「能量释放」（每个回合开始 +1 充能）
    "energy_release",
  ];

  it("全部带 exhaust 关键词", () => {
    for (const id of SET) {
      const def = game.content.cards.get(id);
      expect(def, `${id} 应存在`).toBeDefined();
      expect(def?.keywords ?? [], `${id} 应带消耗`).toContain("exhaust");
    }
  });

  it("type=power 的卡（除衍生物外）应全部在名单内", () => {
    for (const def of game.content.cards.values()) {
      if (def.type !== "power" || def.token) continue;
      expect(SET, `${def.id} 是 power 却漏了消耗`).toContain(def.id);
    }
  });
});

/**
 * 甲方 2026-10-08 第三批：腐蚀 2 费 → 1 费，升级面再降到 0 费。
 * 起因是同为中立的「磁化」2 费给 2 层胆怯还抽 1 张，2 费的腐蚀被完全压制，
 * 定 1 费（升级 0 费）把它重新拉回「廉价单点减益」的定位。
 */
describe("P4.4 腐蚀费用（中立 · 单点减益）", () => {
  it("本体 1 费、升级面 0 费", () => {
    const def = game.content.cards.get("corrode");
    expect(def, "corrode 应存在").toBeDefined();
    expect(def?.cost).toBe(1);
    expect(def?.upgraded?.cost).toBe(0);
  });

  it("升级面仍只改层数（1 → 2 层胆怯）", () => {
    const def = game.content.cards.get("corrode");
    const base = (def?.effects ?? [])[0];
    const up = (def?.upgraded?.effects ?? [])[0];
    expect(base).toMatchObject({ kind: "applyBuff", buff: "timid", stacks: 1 });
    expect(up).toMatchObject({ kind: "applyBuff", buff: "timid", stacks: 2 });
  });
});
