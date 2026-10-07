import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition, type EnemyDefinition } from "@/core/registry";

/**
 * docs/16 P2 · 首批连锁内容三锚点：
 * - 荆棘血痂（反伤）：逐段触发 + 队列中途插入
 * - 虫群亡语：死亡清理后结算
 * - 以血还血：本回合事件回看条件
 */

const CARDS: CardDefinition[] = [
  {
    id: "thorncard",
    class: "bloodwright",
    type: "skill",
    rarity: "common",
    cost: 1,
    effects: [
      { kind: "applyBuff", target: { type: "self" }, buff: "bramble", stacks: 1 },
    ],
  },
  {
    id: "bforb",
    class: "bloodwright",
    type: "attack",
    rarity: "rare",
    cost: 2,
    effects: [
      { kind: "damage", target: { type: "chosenEnemy" }, value: 8 },
      { kind: "damage", target: { type: "chosenEnemy" }, value: 6, condition: { type: "tookDamageThisTurn" } },
    ],
  },
  {
    id: "triple",
    class: "bloodwright",
    type: "attack",
    rarity: "common",
    cost: 1,
    play: { handler: "multihit", params: { hits: 3, split: [0.34, 0.33, 0.33], value: 6 } },
  },
];

const ENEMIES: EnemyDefinition[] = [
  { id: "dummy", name: "Dummy", maxHp: 50, intents: [{ intent: { kind: "attack", value: 5, hits: 3 }, weight: 1 }] },
  { id: "single", name: "Single", maxHp: 60, intents: [{ intent: { kind: "attack", value: 6 }, weight: 1 }] },
  {
    id: "tinyswarm",
    name: "Tiny Swarm",
    maxHp: 1,
    intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
    onDeath: [{ kind: "gainPollution", value: 3 }],
  },
];

function content() {
  return createContentDb({
    cards: new Map(CARDS.map((c) => [c.id, c])),
    enemies: new Map(ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(),
    relics: new Map(),
  });
}

function battle(deck: string[], enemyId = "dummy"): BattleState {
  return reduce(
    createBattleState({
      battleId: "p2",
      seed: 99,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: enemyId }],
      deck,
      content: content(),
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string, targetId = "dummy") {
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
  return reduce(state, { type: "PlayCard", actionId: "p", handIndex: index, targetId });
}

function debug(state: BattleState, command: string) {
  return reduce(state, { type: "DebugCommand", actionId: "d", command });
}

const damageTrail = (events: readonly { type: string }[]): string[] =>
  events
    .filter((e): e is { type: string; sourceId: string; targetId: string } => e.type === "DamageDealt")
    .map((e) => `${e.sourceId}->${e.targetId}`);

describe("P2.1 荆棘血痂（荆棘）", () => {
  it("多段受击逐段触发，且每段之后立即结算（队列中途插入）", () => {
    const armed = play(battle(["thorncard"]), "thorncard");
    expect(armed.state.player.buffs.some((b) => b.id === "bramble")).toBe(true);

    const hit = reduce(armed.state, { type: "EndTurn", actionId: "e" });
    // 敌三段 → 玩家三段反伤，严格交替：证明反伤不是攒到最后一起算
    expect(damageTrail(hit.events)).toEqual([
      "dummy->player",
      "player->dummy",
      "dummy->player",
      "player->dummy",
      "dummy->player",
      "player->dummy",
    ]);
    expect(hit.state.enemies[0].hp).toBe(50 - 9);
    expect(hit.state.player.hp).toBe(66 - 15);
  });

  it("荆棘是固定伤害：不吃力量加成", () => {
    let state = battle(["thorncard"]);
    state = debug(state, "add buff bramble 1").state;
    state = debug(state, "add buff strength 5").state;
    const hit = reduce(state, { type: "EndTurn", actionId: "e" });
    // 若反伤走了攻击修饰，每段会是 3+5=8；固定值应为 3×3 = 9
    expect(hit.state.enemies[0].hp).toBe(50 - 9);
  });
});

describe("P2.2 虫群亡语", () => {
  it("死亡清理记账，并在清理后结算亡语（污染 +3）", () => {
    const result = play(battle(["triple"], "tinyswarm"), "triple", "tinyswarm");
    const died = result.events.find((e) => e.type === "UnitDied");
    expect(died?.type === "UnitDied" ? died.clearedEffects : 0).toBe(2);

    const types = result.events.map((e) => e.type);
    expect(types).toContain("UnitDied");
    expect(types).toContain("PollutionChanged");
    // 亡语必须在死亡清理之后结算
    expect(types.indexOf("UnitDied")).toBeLessThan(types.indexOf("PollutionChanged"));
    expect(result.state.player.pollution).toBe(3);
  });
});

describe("P2.2b 真实内容接入", () => {
  it("蚀肉锈虫群的亡语真的挂在数据上（死亡 → 玩家 +3 污染）", async () => {
    const { loadGameContent } = await import("@/data/load");
    const game = loadGameContent();
    const swarm = game.content.enemies.get("corroded_swarm");
    expect(swarm?.onDeath).toEqual([{ kind: "gainPollution", value: 3 }]);

    const started = reduce(
      createBattleState({
        battleId: "p2-real",
        seed: 1,
        player: { maxHp: 66, energy: 3 },
        enemies: [{ id: "corroded_swarm" }],
        deck: ["strike", "strike", "strike", "strike", "strike"],
        content: game.content,
      }),
      { type: "Noop", actionId: "s" },
    ).state;
    const killed = reduce(started, { type: "DebugCommand", actionId: "d", command: "kill corroded_swarm" });
    expect(killed.state.player.pollution).toBe(3);
    expect(killed.events.some((e) => e.type === "UnitDied")).toBe(true);
  });
});

describe("P2.3 以血还血（本回合事件回看）", () => {
  it("本回合未受伤只打 8；受伤后额外 +6", () => {
    const started = battle(["bforb", "bforb"], "single");
    const first = play(started, "bforb");
    expect(first.state.enemies[0].hp).toBe(60 - 8);

    const afterEnemy = reduce(first.state, { type: "EndTurn", actionId: "e1" }).state;
    expect(afterEnemy.tookDamageThisTurn).toBe(true);
    expect(afterEnemy.player.hp).toBe(60);

    const second = play(afterEnemy, "bforb");
    expect(second.state.enemies[0].hp).toBe(60 - 8 - 14);
  });
});
