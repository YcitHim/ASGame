import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { buildChargeChain, generateIntent } from "@/core/intents";
import { createContentDb, type EnemyDefinition } from "@/core/registry";
import { buffStacks } from "@/core/buffs";
import { Rng } from "@/core/rng";
import type { ConditionContext } from "@/core/registry/condition";
import { loadGameContent } from "@/data/load";
import { TEST_CARDS } from "../helpers/combat";

/**
 * docs/47「锈名录」M1 / M2：
 * §三 引擎小改（everyTurns 节拍技 / playerBuff 追击 / startBuffs / 释放段附带减益）
 * + §四 §五 怪物签名诀 + §六 Boss 阶段诅咒轮换。
 */
const game = loadGameContent();

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  hp: 66,
  maxHp: 66,
  pollution: 0,
  charge: 0,
  buffs: [],
  cardsPlayedThisTurn: 0,
  handSize: 5,
  ...over,
});

const beat: EnemyDefinition = {
  id: "beat",
  name: "Beat",
  maxHp: 30,
  intents: [
    { intent: { kind: "attack", value: 5 }, weight: 1000 },
    { intent: { kind: "attack", value: 40 }, weight: 0.0001, everyTurns: 3 },
  ],
};

const doubleBeat: EnemyDefinition = {
  id: "double",
  name: "Double",
  maxHp: 30,
  intents: [
    { intent: { kind: "attack", value: 11 }, weight: 1, everyTurns: 2 },
    { intent: { kind: "attack", value: 22 }, weight: 1, everyTurns: 2 },
    { intent: { kind: "attack", value: 5 }, weight: 1000 },
  ],
};

const chase: EnemyDefinition = {
  id: "chase",
  name: "Chase",
  maxHp: 30,
  intents: [
    { intent: { kind: "attack", value: 13 }, weight: 1000, playerBuff: { buffId: "pollution", minStacks: 1 } },
    { intent: { kind: "defend", value: 4 }, weight: 0.0001 },
  ],
};

describe("docs/47 §三.2 · everyTurns 节拍技", () => {
  it("回合数到点强制顶替（无视 weight 差）", () => {
    const hit = generateIntent(beat, ctx(), [], new Rng(1).stream("combat"), undefined, 3);
    expect(hit.intent.value).toBe(40);
  });

  it("未到点的回合走常规抽取；turn=0（战前）不触发节拍", () => {
    const off = generateIntent(beat, ctx(), [], new Rng(1).stream("combat"), undefined, 4);
    expect(off.intent.value).toBe(5);
    const pre = generateIntent(beat, ctx(), [], new Rng(1).stream("combat"), undefined, 0);
    expect(pre.intent.value).toBe(5);
  });

  it("同一回合多条节拍命中时取数组序第一条", () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const roll = generateIntent(doubleBeat, ctx(), [], new Rng(seed).stream("combat"), undefined, 2);
      expect(roll.intent.value).toBe(11);
    }
  });
});

describe("docs/47 §三.3 · playerBuff 追击条件", () => {
  it("玩家身上层数不足时不抽这条", () => {
    const roll = generateIntent(chase, ctx(), [], new Rng(1).stream("combat"));
    expect(roll.intent.kind).toBe("defend");
  });

  it("玩家带污染时追击技才亮出来", () => {
    const roll = generateIntent(
      chase,
      ctx({ pollution: 3, buffs: [{ id: "pollution", stacks: 3, duration: null }] }),
      [],
      new Rng(1).stream("combat"),
    );
    expect(roll.intent.kind).toBe("attack");
    expect(roll.intent.value).toBe(13);
  });
});

function contentWith(enemy: EnemyDefinition) {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map([[enemy.id, enemy]]),
    enhancements: new Map(),
  });
}

function startWith(enemy: EnemyDefinition, deck: string[] = ["strike", "defend"]) {
  const content = contentWith(enemy);
  return reduce(
    createBattleState({
      battleId: "t",
      seed: 7,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: enemy.id }],
      deck,
      handSize: 3,
      content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

describe("docs/47 §三.4 · startBuffs 开场状态", () => {
  it("战斗开始即挂在自己身上（忏悔者开场 2 层坚韧）", () => {
    const state = startWith({
      id: "penitent",
      name: "Penitent",
      maxHp: 88,
      startBuffs: [{ buffId: "tenacity", stacks: 2 }],
      intents: [{ intent: { kind: "attack", value: 9 }, weight: 1 }],
    });
    expect(buffStacks(state.enemies[0]!.buffs, "tenacity")).toBe(2);
  });
});

describe("docs/47 §四 · 释放段附带减益（链枷手震慑重击）", () => {
  const flailer: EnemyDefinition = {
    id: "flailer",
    name: "Flailer",
    maxHp: 96,
    intents: [
      {
        intent: {
          kind: "charge",
          value: 4,
          block: 6,
          releaseOverride: 18,
          thenIntent: { kind: "attack", value: 18, buffId: "stun", stacks: 1 },
        },
        weight: 1,
      },
    ],
  };

  it("蓄力链的释放段带着眩晕走", () => {
    const { steps, releaseValue } = buildChargeChain(flailer.intents[0]!.intent);
    expect(releaseValue).toBe(18);
    expect(steps[1]).toMatchObject({ kind: "attack", value: 18, released: true, buffId: "stun", stacks: 1 });
  });

  it("释放命中后玩家吃到眩晕（不可不预告的跳回合）", () => {
    let state = startWith(flailer);
    expect(state.enemies[0]!.intent?.kind).toBe("charge");
    state = reduce(state, { type: "EndTurn", actionId: "e1" }).state; // 蓄力
    state = reduce(state, { type: "EndTurn", actionId: "e2" }).state; // 释放
    expect(buffStacks(state.player.buffs, "stun")).toBe(1);
  });
});

describe("docs/47 §四 §五 · 怪物签名诀落库", () => {
  const def = (id: string) => game.content.enemies.get(id)!;
  const entries = (id: string) => def(id).intents;

  it("act1 既有怪各补一条签名意图", () => {
    expect(entries("rust_hound").some((e) => e.intent.buffId === "timid")).toBe(true);
    expect(entries("rust_sentinel").some((e) => e.intent.kind === "selfBuff" && e.intent.buffId === "bramble")).toBe(true);
    expect(entries("riveted_heavy").some((e) => e.intent.kind === "selfBuff" && e.intent.buffId === "tenacity")).toBe(true);
    // 朝圣者：带污染才追的 attack 13
    const chaseEntry = entries("rust_pilgrim").find((e) => e.playerBuff?.buffId === "pollution");
    expect(chaseEntry?.intent).toMatchObject({ kind: "attack", value: 13 });
    expect(chaseEntry?.playerBuff?.minStacks).toBe(1);
  });

  it("锈蚀守卫：everyTurns 4 的锈崩重锤（架 10 / 释放 16）", () => {
    const beatEntry = entries("rust_warden").find((e) => e.everyTurns === 4);
    expect(beatEntry).toBeDefined();
    const chain = buildChargeChain(beatEntry!.intent);
    expect(chain.releaseValue).toBe(16);
    expect(chain.steps[0]?.block).toBe(10);
  });

  it("三只 act1 精英：忏悔者开场坚韧 2，链枷手释放带眩晕", () => {
    const penitent = def("rust_bell_penitent");
    expect(penitent.maxHp).toBe(88);
    expect(penitent.stunResistant).toBe(true);
    expect(penitent.startBuffs).toEqual([{ buffId: "tenacity", stacks: 2 }]);
    expect(entries("rust_bell_penitent").some((e) => e.intent.kind === "selfBuff" && e.intent.buffId === "tenacity")).toBe(true);
    expect(entries("rust_bell_penitent").some((e) => e.intent.buffId === "timid")).toBe(true);

    const flailer = def("chain_flailer");
    expect(flailer.maxHp).toBe(96);
    expect(flailer.stunResistant).toBe(true);
    const release = entries("chain_flailer").map((e) => buildChargeChain(e.intent).steps).flat().find((s) => s.buffId === "stun");
    expect(release).toMatchObject({ kind: "attack", value: 18, buffId: "stun", stacks: 1 });
  });

  it("新小怪：锈蛾（颠倒）/ 静默嬷嬷（everyTurns 5 眩晕）", () => {
    expect(def("rust_moth").maxHp).toBe(28);
    expect(entries("rust_moth").some((e) => e.intent.buffId === "reverse")).toBe(true);
    const matron = def("silent_matron");
    expect(matron.maxHp).toBe(64);
    const beatEntry = entries("silent_matron").find((e) => e.everyTurns === 5);
    expect(beatEntry?.intent).toMatchObject({ kind: "debuff", buffId: "stun", stacks: 1 });
  });

  it("act2 既有怪挂上九相：烙铁灼烧 / 唱诗颠倒 / 深潜冰缓 / 爬行者胆怯", () => {
    expect(entries("sanctum_jailer").some((e) => e.intent.buffId === "burn")).toBe(true);
    expect(entries("choir_echo").some((e) => e.intent.buffId === "reverse")).toBe(true);
    expect(entries("deep_diver").some((e) => e.intent.buffId === "chill")).toBe(true);
    expect(entries("drowned_crawler").some((e) => e.intent.buffId === "timid")).toBe(true);
    expect(entries("rust_acolyte").some((e) => e.intent.buffId === "chill")).toBe(true);
    expect(entries("corroded_swarm").some((e) => e.intent.buffId === "burn")).toBe(true);
  });

  it("鸣钟守卫与静默嬷嬷错拍（4 vs 5）", () => {
    const bell = entries("bell_warden").find((e) => e.everyTurns === 4);
    expect(bell?.intent).toMatchObject({ kind: "debuff", buffId: "stun" });
    const matron = entries("silent_matron").find((e) => e.everyTurns === 5);
    expect(matron?.intent).toMatchObject({ kind: "debuff", buffId: "stun" });
  });

  it("锈喉阶段诅咒：P3 灼烧在 P2 胆怯之前（同回合取数组序）", () => {
    const beats = entries("rust_throat").filter((e) => e.everyTurns === 3);
    expect(beats.map((e) => e.intent.buffId)).toEqual(["burn", "timid"]);
    expect(beats[0]?.condition).toEqual({ type: "selfHpBelow", percent: 25 });
    expect(beats[1]?.condition).toEqual({ type: "selfHpBelow", percent: 50 });
  });

  it("溺亡唱诗长三阶段诅咒轮换：眩晕(≤30) → 颠倒(≤60) → 冰缓(≥60)", () => {
    const beats = entries("drowned_choirmaster").filter((e) => e.everyTurns === 4);
    expect(beats.map((e) => e.intent.buffId)).toEqual(["stun", "reverse", "chill"]);
    expect(beats[0]?.condition).toEqual({ type: "selfHpBelow", percent: 30 });
    expect(beats[1]?.condition).toEqual({ type: "selfHpBelow", percent: 60 });
    expect(beats[2]?.condition).toEqual({ type: "selfHpAtLeast", percent: 60 });
  });

  it("act1 精英池扩到 3 只，锈蛾入中后段遭遇池", () => {
    const act1 = game.acts[0]!;
    for (const i of [2, 3, 4, 5, 6]) {
      expect(act1.layers[i]!.elitePool).toEqual(["rust_warden", "rust_bell_penitent", "chain_flailer"]);
    }
    const mothPools = act1.layers.filter((l) => (l.encounters ?? []).some((enc) => enc.enemies.includes("rust_moth")));
    expect(mothPools.length).toBeGreaterThanOrEqual(2);
  });

  it("静默嬷嬷入 act2 后段遭遇池（池 C）", () => {
    const act2 = game.acts[1]!;
    const pools = act2.layers.filter((l) => (l.encounters ?? []).some((enc) => enc.enemies.includes("silent_matron")));
    expect(pools.length).toBeGreaterThanOrEqual(1);
  });
});
