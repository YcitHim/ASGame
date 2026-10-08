import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";

/**
 * docs/51 §二 F2：六张资源转换卡（血/充能/污染 → 能量/牌）。
 * 同时钉住新增的 `chargeCost`（固定充能代价，与 bloodCost 同构）。
 */
const game = loadGameContent();

function start(cardId: string, opts: { charge?: number; upgraded?: boolean } = {}) {
  const state = reduce(
    createBattleState({
      battleId: "conv",
      seed: 3,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: "rust_hound" }],
      // 10 张同名牌：手牌 5 张，牌堆还留 5 张，抽 2 才有牌可抽
      deck: Array.from({ length: 10 }, () => ({ cardId, upgraded: opts.upgraded === true })),
      handSize: 5,
      content: game.content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
  if (opts.charge !== undefined) (state.player as { charge: number }).charge = opts.charge;
  return state;
}

const play = (state: ReturnType<typeof start>) =>
  reduce(state, { type: "PlayCard", actionId: "p", handIndex: 0, targetId: "rust_hound" });

describe("docs/51 §二 · 资源转换卡", () => {
  it("血涌（血械）：卖 2 血 → 能量 +1、抽 1；升级能量 +2", () => {
    const base = start("bloodsurge");
    const after = play(base);
    expect(after.state.player.hp).toBe(64);
    expect(after.state.player.energy).toBe(3); // 1 费 +1 能 → 净 0
    expect(after.state.piles.hand).toHaveLength(5); // 打 1 抽 1
    expect(after.state.player.energy).toBeLessThanOrEqual(4); // 护栏：能量净增 ≤ +1
    const up = play(start("bloodsurge", { upgraded: true }));
    expect(up.state.player.energy).toBe(4);
    expect(up.state.player.hp).toBe(64);
  });

  it("祭血狂热（血械）：1 费卖 3 血 → 待选销毁一张手牌；升级只减代价", () => {
    const base = play(start("bloodfrenzy"));
    expect(base.state.player.hp).toBe(63);
    expect(base.state.player.energy).toBe(2); // 起始 3 − 1 费
    expect(base.state.destroyPending).toBe(1); // 待玩家选一张手牌销毁
    expect(base.state.piles.hand).toHaveLength(4); // 起始 5 张，打掉 1
    const up = play(start("bloodfrenzy", { upgraded: true }));
    expect(up.state.player.hp).toBe(64); // 升级 = 减代价（docs/50 惯例）
    expect(up.state.destroyPending).toBe(1);
  });

  it("回压阀（炉心）：充能不足打不出去；够则恰好扣 2 点", () => {
    const poor = play(start("backpressure_valve", { charge: 1 }));
    expect(poor.events.some((e) => e.type === "CardPlayed")).toBe(false);
    expect(poor.state.player.charge).toBe(1); // 失败零改动
    expect(poor.state.piles.hand).toHaveLength(5);
    const rich = play(start("backpressure_valve", { charge: 5 }));
    expect(rich.state.player.charge).toBe(3);
    expect(rich.state.player.energy).toBe(3); // 1 费 +1 能
    expect(rich.state.piles.hand).toHaveLength(5);
  });

  it("齿轮过驳（炉心）：0 费，扣 1 充能抽 1；升级抽 2", () => {
    const after = play(start("gearbox_transfer", { charge: 2 }));
    expect(after.state.player.charge).toBe(1);
    expect(after.state.player.energy).toBe(3);
    expect(after.state.piles.hand).toHaveLength(5);
    const up = play(start("gearbox_transfer", { charge: 2, upgraded: true }));
    expect(up.state.piles.hand).toHaveLength(6);
  });

  it("锈蚀代谢（锈语者）：污染 +6 抽 2；升级只减代价（+5）", () => {
    const after = play(start("rust_metabolism"));
    expect(after.state.player.pollution).toBe(6);
    expect(after.state.piles.hand).toHaveLength(6);
    const up = play(start("rust_metabolism", { upgraded: true }));
    expect(up.state.player.pollution).toBe(5);
  });

  it("污能转化（锈语者）：0 费，污染 +5 → 能量 +1；升级只减代价（+4）", () => {
    const after = play(start("toxic_transmutation"));
    expect(after.state.player.pollution).toBe(5);
    expect(after.state.player.energy).toBe(4);
    const up = play(start("toxic_transmutation", { upgraded: true }));
    expect(up.state.player.pollution).toBe(4);
    expect(up.state.player.energy).toBe(4);
  });

  it("充能代价是卡面资源成本：不打折扣、不吃增幅", () => {
    const def = game.content.cards.get("backpressure_valve")!;
    expect(def.chargeCost).toBe(2);
    expect(game.content.cards.get("gearbox_transfer")!.chargeCost).toBe(1);
    // 其余四张没有充能代价
    for (const id of ["bloodsurge", "bloodfrenzy", "rust_metabolism", "toxic_transmutation"]) {
      expect(game.content.cards.get(id)!.chargeCost, id).toBeUndefined();
    }
  });
});
