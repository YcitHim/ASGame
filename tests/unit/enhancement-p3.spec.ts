import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb } from "@/core/registry";
import { loadGameContent } from "@/data/load";

/**
 * docs/16 P3.1 / P3.2：
 * - 血怒（T2）：HP<50% 时此牌伤害 ×1.5，与低血沸腾同槽 → 三段各乘
 * - 血锈光环：本场所有攻击 +1（layer:"temporary"），代价 8 污染
 */

const game = loadGameContent();
const content = createContentDb({
  cards: game.content.cards,
  enemies: new Map([
    [
      "dummy",
      {
        id: "dummy",
        name: "Dummy",
        maxHp: 80,
        intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
      },
    ],
    [
      "frail",
      {
        id: "frail",
        name: "Frail",
        maxHp: 1,
        intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
      },
    ],
  ]),
  enhancements: game.content.enhancements,
  relics: new Map(),
});

function battle(
  deck: (string | { cardId: string; enhancements: string[] })[],
  hp?: number,
  enemyId = "dummy",
): BattleState {
  let state = reduce(
    createBattleState({
      battleId: "p3",
      seed: 11,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: enemyId }],
      deck,
      content,
    }),
    { type: "Noop", actionId: "s" },
  ).state;
  if (hp !== undefined) state = reduce(state, { type: "DebugCommand", actionId: "d", command: `set hp ${hp}` }).state;
  return state;
}

function play(state: BattleState, cardId: string, targetId = "dummy") {
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
  return reduce(state, { type: "PlayCard", actionId: "p", handIndex: index, targetId });
}

const hits = (events: readonly { type: string }[]) =>
  events.filter((e): e is { type: string; value: number; layers: { layer: string; sourceId: string }[] } => e.type === "DamageDealt");

describe("P3.1 血怒 × 低血沸腾（失控线爆发流）", () => {
  it("HP<50% + 同槽双强化：bloodbolt 拆三段，每段 ×1.5", () => {
    const result = play(battle([{ cardId: "bloodbolt", enhancements: ["bloodboil", "bloodrage"] }], 20), "bloodbolt");
    const dealt = hits(result.events);
    expect(dealt).toHaveLength(3);
    // 9 拆成 3/3/3，每段 ×1.5 = 4.5 → 单次取整 5
    expect(dealt.map((d) => d.value)).toEqual([5, 5, 5]);
    expect(result.state.enemies[0].hp).toBe(80 - 15);
  });

  it("HP≥50% 时两者都不生效（都是 HP<50% 条件）：单段 9", () => {
    const result = play(battle([{ cardId: "bloodbolt", enhancements: ["bloodboil", "bloodrage"] }]), "bloodbolt");
    const dealt = hits(result.events);
    expect(dealt).toHaveLength(1);
    expect(dealt.map((d) => d.value)).toEqual([9]);
  });

  it("只有低血沸腾（HP<50%）：三段 3/3/3 = 9", () => {
    const result = play(battle([{ cardId: "bloodbolt", enhancements: ["bloodboil"] }], 20), "bloodbolt");
    const dealt = hits(result.events);
    expect(dealt).toHaveLength(3);
    expect(dealt.map((d) => d.value)).toEqual([3, 3, 3]);
  });

  it("只有血怒（单段）：9 ×1.5 = 13.5 → 14", () => {
    const result = play(battle([{ cardId: "bloodbolt", enhancements: ["bloodrage"] }], 20), "bloodbolt");
    expect(hits(result.events).map((d) => d.value)).toEqual([14]);
  });
});

describe("P3.3 强化铺量（docs/23 §1）", () => {
  it("减重：redtear 费用 2 → 1（走 cardCost 管线）", () => {
    const result = play(battle([{ cardId: "redtear", enhancements: ["lighten"] }]), "redtear");
    // 基础 2 费，减重 -1 → 花 1 点能量（血契另行扣血）
    expect(result.state.player.energy).toBe(2);
  });

  it("淬锈：命中给目标 1 回合易伤", () => {
    const result = play(battle([{ cardId: "bloodbolt", enhancements: ["rustbite"] }]), "bloodbolt");
    const vul = result.state.enemies[0].buffs.find((b) => b.id === "vulnerable");
    expect(vul?.duration).toBe(1);
  });

  it("血偿：此牌击杀敌人时回复 4 点 HP", () => {
    const result = play(
      battle([{ cardId: "strike", enhancements: ["bloodwage"] }], 40, "frail"),
      "strike",
      "frail",
    );
    expect(result.state.enemies[0].hp).toBe(0);
    expect(result.state.player.hp).toBe(44);
  });
});

describe("P3.2 血锈光环（本场临时修饰层）", () => {
  it("写入 BattleState.modifiers，且攻击 +1 在事件层可追溯", () => {
    const cast = play(battle(["bloodrust", "strike"]), "bloodrust");
    expect(cast.state.player.pollution).toBe(8);
    expect(cast.state.modifiers).toHaveLength(1);
    expect(cast.state.modifiers[0]).toMatchObject({ layer: "temporary", op: "add", value: 1, kind: "attackDamage" });

    const struck = play(cast.state, "strike");
    const [hit] = hits(struck.events);
    expect(hit?.value).toBe(7);
    // 战斗日志靠 layers 追溯临时层
    expect(hit?.layers.some((l) => l.layer === "temporary")).toBe(true);
  });

  it("跨回合持续：下一回合的攻击仍然 +1", () => {
    const cast = play(battle(["bloodrust", "strike", "strike"]), "bloodrust");
    const nextTurn = reduce(cast.state, { type: "EndTurn", actionId: "e" }).state;
    expect(nextTurn.modifiers).toHaveLength(1);
    const struck = play(nextTurn, "strike");
    expect(hits(struck.events)[0]?.value).toBe(7);
  });
});
