import { describe, expect, it } from "vitest";
import type { Action } from "@/core/actions";
import { createBattleState, reduce, type BattleConfig } from "@/core/combat";

function config(overrides: Partial<BattleConfig> = {}): BattleConfig {
  return {
    battleId: "test-battle",
    seed: 20261005,
    player: { maxHp: 66, energy: 3 },
    enemies: [
      { id: "cultist", maxHp: 20 },
      { id: "hound", maxHp: 30 },
    ],
    deck: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"],
    handSize: 5,
    ...overrides,
  };
}

const noop: Action = { type: "Noop", actionId: "a0" };
const endTurn = (n: number): Action => ({ type: "EndTurn", actionId: `a${n}` });

describe("reduce 主循环空转（2.2 / 门禁 2）", () => {
  it("(state, dummyAction) → events：首个动作触发 battleStart 并发出 BattleStarted", () => {
    const s0 = createBattleState(config());
    expect(s0.phase).toBe("battleStart");
    const r = reduce(s0, noop);
    expect(r.events.map((e) => e.type)).toEqual(["BattleStarted", "CardsDrawn"]);
    expect(r.state.phase).toBe("playerAction");
    expect(r.state.turn).toBe(1);
    expect(r.state.piles.hand).toHaveLength(5);
  });

  it("EndTurn 产出 回合结束 → 回合开始 → 抽牌 的完整序列", () => {
    const r0 = reduce(createBattleState(config()), noop);
    const r1 = reduce(r0.state, endTurn(1));
    expect(r1.events.map((e) => e.type)).toEqual(["TurnEnded", "TurnStarted", "CardsDrawn"]);
    expect(r1.state.turn).toBe(2);
    expect(r1.state.phase).toBe("playerAction");
    expect(r1.state.player.energy).toBe(3);
    expect(r1.state.player.block).toBe(0);
  });

  it("事件 seq 跨 reduce 连续递增", () => {
    const r0 = reduce(createBattleState(config()), noop);
    const lastSeq = r0.events[r0.events.length - 1].seq;
    expect(r0.state.eventSeq).toBe(lastSeq + 1);
    const r1 = reduce(r0.state, endTurn(1));
    expect(r1.events[0].seq).toBe(lastSeq + 1);
  });

  it("抽牌堆耗尽时洗入弃牌堆并发出 DeckShuffled", () => {
    const r0 = reduce(createBattleState(config({ deck: ["c1", "c2", "c3", "c4", "c5", "c6"] })), noop);
    expect(r0.state.piles.draw).toHaveLength(1);
    const r1 = reduce(r0.state, endTurn(1));
    expect(r1.events.some((e) => e.type === "DeckShuffled")).toBe(true);
    expect(r1.state.piles.hand).toHaveLength(5);
  });

  it("回合开始 tick 会移除到期的计时型 Buff 并发 BuffExpired", () => {
    const r0 = reduce(createBattleState(config()), noop);
    const poisoned = {
      ...r0.state,
      player: { ...r0.state.player, buffs: [{ id: "vulnerable" as const, stacks: 1, duration: 1 }] },
    };
    const r1 = reduce(poisoned, endTurn(1));
    expect(r1.events.find((e) => e.type === "BuffExpired")).toBeDefined();
    expect(r1.state.player.buffs).toEqual([]);
  });

  it("同种子同输入流产出逐条一致的事件流（回放地基）", () => {
    const run = () => {
      let state = createBattleState(config());
      const events: unknown[] = [];
      for (const action of [noop, endTurn(1), endTurn(2), endTurn(3)]) {
        const r = reduce(state, action);
        state = r.state;
        events.push(...r.events);
      }
      return { events, finalState: state };
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("BattleStarted 带敌人配置与起始手牌", () => {
    const r = reduce(createBattleState(config()), noop);
    const started = r.events[0];
    expect(started.type).toBe("BattleStarted");
    if (started.type === "BattleStarted") {
      expect(started.enemies.map((e) => e.id)).toEqual(["cultist", "hound"]);
      expect(started.startingHand).toHaveLength(5);
    }
  });
});
