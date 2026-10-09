import { describe, expect, it } from "vitest";
import { createBattleState, previewEnergyCost, reduce, type BattleState } from "@/core/combat";
import { loadGameContent } from "@/data/load";
import { handIndex } from "../helpers/combat";

/**
 * 颠倒（docs/46 §3.8）甲方反馈的差一 bug：
 * 敌人给我挂的颠倒，会在**玩家回合开始**就被 resolveCurses 扣成 0 —— 玩家还没轮到出手，
 * 诅咒已经没了，于是「卡牌费用没变 + 状态栏看不到」。
 * 现在冰缓 / 颠倒改成在**受影响单位自己的回合结束**递减：挂上之后至少活过对方一整个回合。
 *
 * 注意测试路径必须走"敌人挂"：判定时点跟"谁在哪一回合挂"是强绑定的，
 * 直接往玩家身上塞 buff 会把两种口径混在一起。
 */
const game = loadGameContent();
let seq = 0;

function start(enemies: string[], deck: string[], handSize = 5): BattleState {
  return reduce(
    createBattleState({
      battleId: "rev",
      seed: 515,
      player: { maxHp: 66, energy: 9 },
      enemies: enemies.map((id) => ({ id })),
      deck,
      handSize,
      content: game.content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

/** 钉住敌人意图：这一回合它一定会给我挂颠倒。 */
function pinReverseIntent(state: BattleState, enemyId: string, stacks: number): BattleState {
  return reduce(state, {
    type: "DebugCommand",
    actionId: "d" + ++seq,
    command: `intent ${enemyId} debuff reverse ${stacks}`,
  }).state;
}

const endTurn = (state: BattleState) => reduce(state, { type: "EndTurn", actionId: "e" + ++seq }).state;

describe("颠倒（诅咒 · 规则）", () => {
  it("敌人挂的颠倒必须活过玩家一整个回合：状态栏看得到、手牌费用被随机", () => {
    let s = pinReverseIntent(start(["rust_hound"], ["strike", "defend", "jab", "cleave"]), "rust_hound", 1);
    s = endTurn(s);

    // 玩家回合 2：诅咒必须还在（旧版在回合开始就被扣没了 → 状态栏看不到）
    expect(s.player.buffs.find((b) => b.id === "reverse")?.stacks).toBe(1);

    const hand = s.piles.hand;
    expect(hand.length).toBeGreaterThan(0);
    expect(Object.keys(s.reverseCosts).sort()).toEqual([...hand].sort());
    for (const id of hand) {
      expect(s.reverseCosts[id]).toBeGreaterThanOrEqual(0);
      expect(s.reverseCosts[id]).toBeLessThanOrEqual(3);
    }
    for (let i = 0; i < hand.length; i += 1) {
      expect(previewEnergyCost(s, i), "UI 显示的必须是颠倒后的费用").toBe(s.reverseCosts[hand[i]!]);
    }

    // 打一张牌：实付能量按随机费用走，而不是卡面费用
    const index = handIndex(s, "strike");
    const instance = hand[index]!;
    const cost = s.reverseCosts[instance]!;
    const before = s.player.energy;
    const played = reduce(s, { type: "PlayCard", actionId: "p" + ++seq, handIndex: index, targetId: "rust_hound" });
    s = played.state;
    const paid = played.events.find((e) => e.type === "CardPlayed");
    expect(paid && paid.type === "CardPlayed" ? paid.costPaid : -1).toBe(cost);
    expect(s.player.energy).toBe(before - cost);

    // 本回合结束时才递减：1 层 → 归零移除
    s = endTurn(s);
    expect(s.player.buffs.find((b) => b.id === "reverse")).toBeUndefined();
    expect(s.reverseCosts).toEqual({});
  });

  it("2 回合颠倒能撑两个自己的回合（每回合结束 −1 回合）", () => {
    let s = pinReverseIntent(start(["rust_hound"], ["strike", "defend"]), "rust_hound", 2);
    s = endTurn(s);
    // 甲方 2026-10-09：颠倒也是时长型——层数恒 1，参数 2 = 2 回合
    expect(s.player.buffs.find((b) => b.id === "reverse")?.duration).toBe(2);
    s = endTurn(s);
    expect(s.player.buffs.find((b) => b.id === "reverse")?.duration).toBe(1);
    s = endTurn(s);
    expect(s.player.buffs.find((b) => b.id === "reverse")).toBeUndefined();
  });

  it("玩家给敌人挂的颠倒同样在敌人回合结束时递减（谵语 2 回合）", () => {
    let s = start(["rust_hound", "bell_warden"], ["raving", "strike"]);
    const index = handIndex(s, "raving");
    s = reduce(s, { type: "PlayCard", actionId: "p" + ++seq, handIndex: index, targetId: "rust_hound" }).state;
    expect(s.enemies[0].buffs.find((b) => b.id === "reverse")?.stacks).toBe(1);
    expect(s.enemies[0].buffs.find((b) => b.id === "reverse")?.duration).toBe(2);
    // 玩家回合结束 → 敌人回合（带着颠倒行动）→ 敌方回合结束 −1
    // 关键：玩家回合里挂的，回合实例是玩家侧（2N），到敌方侧（2N+1）必须能递减——
    // 若只按 draft.turn 判新鲜度，这里会被误判成"敌人自己回合挂的"而白吃一个回合。
    s = endTurn(s);
    expect(s.enemies[0].buffs.find((b) => b.id === "reverse")?.duration).toBe(1);
  });

  it("回合内抽到的牌也吃随机费用（抽牌流绕不过诅咒）", () => {
    let s = pinReverseIntent(
      start(["rust_hound"], ["quickcut", "quickcut", "strike", "strike", "defend", "defend", "jab"]),
      "rust_hound",
      1,
    );
    s = endTurn(s);
    expect(s.player.buffs.find((b) => b.id === "reverse")).toBeDefined();
    const known = new Set(Object.keys(s.reverseCosts));
    const index = handIndex(s, "quickcut");
    s = reduce(s, { type: "PlayCard", actionId: "p" + ++seq, handIndex: index, targetId: "rust_hound" }).state;
    const fresh = s.piles.hand.filter((id) => !known.has(id));
    expect(fresh.length, "至少要有新抽到的牌").toBeGreaterThan(0);
    for (const id of fresh) {
      expect(s.reverseCosts[id], "新抽的牌必须有随机费用").toBeGreaterThanOrEqual(0);
      expect(s.reverseCosts[id]).toBeLessThanOrEqual(3);
    }
  });
});
