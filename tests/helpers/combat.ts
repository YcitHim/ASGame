import { createBattleState, reduce, type BattleConfig, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition, type ContentDb, type EnemyDefinition } from "@/core/registry";

export const TEST_CARDS: CardDefinition[] = [
  {
    id: "strike",
    class: "bloodwright",
    type: "attack",
    rarity: "starter",
    cost: 1,
    effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 6 }],
  },
  {
    id: "defend",
    class: "bloodwright",
    type: "skill",
    rarity: "starter",
    cost: 1,
    effects: [{ kind: "block", target: { type: "self" }, value: 5 }],
  },
  {
    id: "bloodbolt",
    class: "bloodwright",
    type: "attack",
    rarity: "common",
    cost: 1,
    keywords: ["bloodpact"],
    bloodCost: 2,
    effects: [
      { kind: "damage", target: { type: "chosenEnemy" }, value: 9 },
      { kind: "draw", value: 1, condition: { type: "hpBelow", percent: 50 } },
    ],
  },
  {
    id: "bloodflail",
    class: "bloodwright",
    type: "attack",
    rarity: "uncommon",
    cost: 1,
    keywords: ["exhaust"],
    play: { handler: "multihit", params: { hits: 3, split: [0.4, 0.3, 0.3], value: 6 } },
  },
  {
    id: "weaken",
    class: "bloodwright",
    type: "skill",
    rarity: "common",
    cost: 1,
    effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: "weak", stacks: 1 }],
  },
  {
    id: "big",
    class: "bloodwright",
    type: "attack",
    rarity: "common",
    cost: 3,
    effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 20 }],
  },
  {
    id: "retain_guard",
    class: "bloodwright",
    type: "skill",
    rarity: "uncommon",
    cost: 0,
    keywords: ["retain"],
    effects: [{ kind: "block", target: { type: "self" }, value: 3 }],
  },
  {
    id: "ethereal_hex",
    class: "bloodwright",
    type: "skill",
    rarity: "uncommon",
    cost: 0,
    keywords: ["ethereal"],
    effects: [{ kind: "draw", value: 1 }],
  },
  {
    id: "expose",
    class: "bloodwright",
    type: "skill",
    rarity: "common",
    cost: 0,
    effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: "vulnerable", stacks: 1 }],
  },
  {
    id: "curse_weak",
    class: "bloodwright",
    type: "skill",
    rarity: "common",
    cost: 0,
    effects: [{ kind: "applyBuff", target: { type: "self" }, buff: "weak", stacks: 1 }],
  },
  {
    id: "regen",
    class: "bloodwright",
    type: "power",
    rarity: "uncommon",
    cost: 1,
    effects: [{ kind: "applyBuff", target: { type: "self" }, buff: "regeneration", stacks: 3 }],
  },
];

export const TEST_ENEMIES: EnemyDefinition[] = [
  { id: "dummy", name: "Dummy", maxHp: 50, intents: [{ intent: { kind: "attack", value: 5 }, weight: 1, maxConsecutive: 1 }] },
  { id: "tank", name: "Tank", maxHp: 80, intents: [{ intent: { kind: "defend", value: 5 }, weight: 1 }] },
];

export function testContent(): ContentDb {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(),
  });
}

export function testConfig(overrides: Partial<BattleConfig> = {}): BattleConfig {
  return {
    battleId: "test",
    seed: 424242,
    player: { maxHp: 66, energy: 3 },
    enemies: [{ id: "dummy" }],
    deck: ["strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", "bloodbolt"],
    handSize: 5,
    content: testContent(),
    ...overrides,
  };
}

export function startState(config: BattleConfig = testConfig()): BattleState {
  return reduce(createBattleState(config), { type: "Noop", actionId: "start" }).state;
}

export function handIndex(state: BattleState, cardId: string): number {
  return state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
}

export function eventsOfType<T extends string>(
  events: readonly { type: string }[],
  type: T,
): (typeof events)[number][] {
  return events.filter((e) => e.type === type);
}