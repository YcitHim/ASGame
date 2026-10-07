import { describe, expect, it } from "vitest";
import { applyBuff, type BuffInstance } from "@/core/buffs";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";

/**
 * 血链重做（甲方 2026-10-07）：消耗自己全部的「有利状态」（含充能），每 1 层造成 1 点伤害。
 * 旧版是 multihit 拆 6 点伤害（40/30/30 是「这张牌自己的 6 点」在 3 段里的分配比例，
 * 不是敌人最大生命的百分比）——多段吃平A增幅，力量越高越离谱，所以改成一次性兑现筹码。
 */
const game = loadGameContent();

function start(
  opts: { upgraded?: boolean; charge?: number; pollution?: number; buffs?: readonly BuffInstance[] } = {},
) {
  const state = reduce(
    createBattleState({
      battleId: "bloodflail",
      seed: 5,
      player: { maxHp: 66, energy: 3, ...(opts.pollution !== undefined ? { pollution: opts.pollution } : {}) },
      enemies: [{ id: "rust_hound", maxHp: 200 }],
      deck: Array.from({ length: 10 }, () => ({ cardId: "bloodflail", upgraded: opts.upgraded === true })),
      handSize: 5,
      content: game.content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
  const p = state.player as { charge: number; buffs: readonly BuffInstance[] };
  if (opts.charge !== undefined) p.charge = opts.charge;
  // applyBuff(buffs, input) → BuffInstance[]（applyAs 语义在 core 里折算）
  for (const buff of opts.buffs ?? []) {
    p.buffs = applyBuff(p.buffs, { id: buff.id, stacks: buff.stacks, duration: buff.duration ?? null });
  }
  return state;
}

const play = (state: ReturnType<typeof start>) =>
  reduce(state, { type: "PlayCard", actionId: "p", handIndex: 0, targetId: "rust_hound" });

const dealtToEnemy = (events: readonly { type: string }[]): number =>
  events
    .filter((e): e is { type: "DamageDealt"; targetId: string; hpLost: number } => e.type === "DamageDealt")
    .filter((e) => e.targetId === "rust_hound")
    .reduce((sum, e) => sum + e.hpLost, 0);

describe("血链 · consumeBoons", () => {
  it("力量 3 + 充能 2 = 5 层 → 5 点伤害，且两者都被吃掉", () => {
    const before = start({ charge: 2, buffs: [{ id: "strength", stacks: 3, duration: null }] });
    const { state, events } = play(before);
    expect(dealtToEnemy(events)).toBe(5);
    expect(state.player.charge).toBe(0);
    expect(state.player.buffs.some((b) => b.id === "strength")).toBe(false);
    // 消耗不该被当成「获得充能」——不过载、不反噬
    expect(events.some((e) => e.type === "Overloaded")).toBe(false);
    expect(state.player.hp).toBe(66);
  });

  it("负面状态既不计数也不被消耗（虚弱 / 污染 / 冰缓）", () => {
    const before = start({
      charge: 0,
      pollution: 30,
      buffs: [
        { id: "weak", stacks: 2, duration: null },
        { id: "chill", stacks: 1, duration: null },
      ],
    });
    const { state, events } = play(before);
    expect(dealtToEnemy(events)).toBe(0);
    expect(state.player.buffs.map((b) => b.id).sort()).toEqual(["chill", "pollution", "weak"]);
    expect(state.player.pollution).toBe(30);
  });

  it("格挡是资源不是状态：不吃（它已经在替玩家挡刀了）", () => {
    const before = start({ charge: 2 });
    (before.player as { block: number }).block = 12;
    const { state, events } = play(before);
    expect(dealtToEnemy(events)).toBe(2); // 只有充能那 2 层
    expect(state.player.block).toBe(12);
  });

  it("身上什么都没有 → 0 伤害、不崩、不留残余", () => {
    const { state, events } = play(start());
    expect(dealtToEnemy(events)).toBe(0);
    expect(state.player.charge).toBe(0);
    expect(state.piles.exhaust.some((id) => state.cardInstances[id].cardId === "bloodflail")).toBe(true);
  });

  it("升级：每层 2 点（3 层力量 → 6 点）", () => {
    const { events } = play(start({ upgraded: true, buffs: [{ id: "strength", stacks: 3, duration: null }] }));
    expect(dealtToEnemy(events)).toBe(6);
  });

  it("再生 / 坚韧 / 荆棘 / 回血印记都算筹码（加持全类）", () => {
    const before = start({
      buffs: [
        { id: "regeneration", stacks: 2, duration: 3 },
        { id: "tenacity", stacks: 2, duration: null },
        { id: "bramble", stacks: 1, duration: null },
        { id: "mending", stacks: 4, duration: 1 },
      ],
    });
    const { state, events } = play(before);
    expect(dealtToEnemy(events)).toBe(9);
    expect(state.player.buffs.some((b) => ["regeneration", "tenacity", "bramble", "mending"].includes(b.id))).toBe(false);
  });
});
