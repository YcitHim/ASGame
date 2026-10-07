import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import {
  applyIntermission,
  createRunState,
  generateActMap,
  hasNextAct,
  actOf,
} from "@/core/map";
import { createContentDb, type ActDefinition, type EnemyDefinition } from "@/core/registry";
import { TEST_CARDS, handIndex } from "../helpers/combat";

/** docs/40 §二/§三/§五 · 转地图与召唤机制。 */

const minion: EnemyDefinition = {
  id: "mite",
  name: "Mite",
  maxHp: 5,
  intents: [{ intent: { kind: "attack", value: 99 }, weight: 1 }],
};

function summoner(over: Partial<EnemyDefinition> = {}): EnemyDefinition {
  return {
    id: "caller",
    name: "Caller",
    maxHp: 20,
    intents: [{ intent: { kind: "summon", enemyId: "mite", count: 1 }, weight: 1 }],
    ...over,
  };
}

function contentWith(enemies: EnemyDefinition[]) {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map([...enemies, minion].map((e) => [e.id, e])),
    enhancements: new Map(),
  });
}

function start(enemies: EnemyDefinition[], deck = ["strike", "strike", "strike", "strike"]) {
  const content = contentWith(enemies);
  return reduce(
    createBattleState({
      battleId: "t",
      seed: 5,
      player: { maxHp: 66, energy: 9 },
      enemies: enemies.map((e) => ({ id: e.id })),
      deck,
      handSize: deck.length,
      content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

describe("docs/40 summon 机制", () => {
  it("召唤意图生怪；新单位入场当回合不行动", () => {
    let s = start([summoner()]);
    expect(s.enemies).toHaveLength(1);
    const hp0 = s.player.hp;
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.enemies).toHaveLength(2);
    // 召唤物攻击 99 未结算（入场当回合不行动），主人只有 summon 意图
    expect(s.player.hp).toBe(hp0);
  });

  it("场上满 4 时 summon 视为不可用（重抽/兜底）", () => {
    const many = [summoner({ id: "c1" }), summoner({ id: "c2" }), summoner({ id: "c3" }), summoner({ id: "c4" })];
    let s = start(many);
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.enemies).toHaveLength(4);
  });

  it("召唤者死亡时召唤物殉爆（不触发其亡语）", () => {
    let s = start([summoner({ maxHp: 6 })], ["strike", "strike"]);
    s = reduce(s, { type: "EndTurn", actionId: "e" }).state;
    expect(s.enemies).toHaveLength(2);
    const idx = handIndex(s, "strike");
    s = reduce(s, { type: "PlayCard", actionId: "p", handIndex: idx, targetId: "caller" }).state;
    expect(s.enemies.find((e) => e.defId === "caller")?.hp).toBe(0);
    expect(s.enemies.find((e) => e.defId === "mite")?.hp).toBe(0);
  });

  it("亡语 summon：死亡时生出新单位（tide_swarm 口径）", () => {
    const swarm = summoner({
      id: "swarm",
      maxHp: 6,
      intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
      onDeath: [{ kind: "summon", enemyId: "mite", count: 1 }],
    });
    let s = start([swarm], ["strike", "strike"]);
    const idx = handIndex(s, "strike");
    s = reduce(s, { type: "PlayCard", actionId: "p", handIndex: idx, targetId: "swarm" }).state;
    expect(s.enemies.find((e) => e.defId === "mite")?.hp).toBe(5);
  });
});

describe("docs/40 转地图与精英池", () => {
  const act2ish: ActDefinition = {
    id: "act2ish",
    i18n: "act.test",
    classes: ["bloodwright"],
    weights: { battle: 50, elite: 0, rest: 0, altar: 25, event: 25 },
    layers: [
      { id: "l0", width: 1, kinds: ["battle"], enemies: ["caller"] },
      { id: "l1", width: 2, kinds: ["battle"], enemies: ["caller"] },
      { id: "l2", width: 1, kinds: ["elite"], elitePool: ["jailer", "tidecaller"] },
      { id: "l3", width: 1, kinds: ["elite"], elitePool: ["jailer", "tidecaller"] },
    ],
  };

  it("同幕双精英池不重复", () => {
    const map = generateActMap(act2ish, 12345);
    const a = map[2].nodes[0].enemies?.[0];
    const b = map[3].nodes[0].enemies?.[0];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("applyIntermission：切幕 / 回血 40%（floor）/ 污染清零 / 层进度重置", () => {
    const cls = { id: "bloodwright", i18n: "class.bloodwright", player: { maxHp: 66, energy: 3 }, startDeck: ["strike"] };
    const run = { ...createRunState(act2ish, cls as never, 1), hp: 20, pollution: 77, layerIndex: 2, picked: [0, 0, 0] };
    const next = applyIntermission(run);
    expect(next.actIndex).toBe(1);
    expect(next.layerIndex).toBe(0);
    expect(next.picked).toEqual([]);
    expect(next.pollution).toBe(0);
    expect(next.hp).toBe(20 + Math.floor(66 * 0.4));
  });

  it("actOf / hasNextAct 按幕切换", () => {
    const cls = { id: "bloodwright", i18n: "class.bloodwright", player: { maxHp: 66, energy: 3 }, startDeck: ["strike"] };
    const act1 = { ...act2ish, id: "act1" };
    const act2 = { ...act2ish, id: "act2" };
    const run = createRunState(act1, cls as never, 1);
    expect(actOf(run, [act1, act2])?.id).toBe("act1");
    expect(hasNextAct(run, [act1, act2])).toBe(true);
    const moved = applyIntermission(run);
    expect(actOf(moved, [act1, act2])?.id).toBe("act2");
    expect(hasNextAct(moved, [act1, act2])).toBe(false);
  });
});
