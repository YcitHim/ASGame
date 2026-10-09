import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition, type ContentDb, type EnemyDefinition } from "@/core/registry";
import type { DomainEvent } from "@/core/events";
import { loadGameContent } from "@/data/load";
import { handIndex } from "../helpers/combat";

/**
 * docs/62 之后 · 闲置机制上怪（甲方 2026-10-08「把没用上的特性做成怪物」）：
 * 引擎里注册了但**零怪物使用**的四类资产，本批各安排使用者：
 *  - 魔免 `magicimmune`（只吃攻击牌）→ 釉壳残躯（普通）+ 镜面判官上半场（精英）
 *  - 不屈 `unbreakable`（每回合受伤上限 15% maxHp）→ 沉箱桩（普通）+ 镜面判官下半场（精英）
 *  - 力量 `strength`（敌方自挂，**限时** duration，不碰「禁永久力量」铁律 docs/14 Q12）→ 白热锻渣
 *  - 再生 `regeneration`（敌方自挂，DPs 门槛怪）→ 厚苔机仆（普通）+ 熔锻巨像（精英）
 * 本 spec 钉住：数据挂点 / 幕注册 / i18n 三条 / 机制层真跑一场。
 */
const game = loadGameContent();
const def = (id: string) => game.content.enemies.get(id)!;
const entries = (id: string) => def(id).intents;
const selfBuff = (id: string, buffId: string) =>
  entries(id).find((e) => e.intent.kind === "selfBuff" && e.intent.buffId === buffId);

/* ---------------- 数据层 ---------------- */

describe("新怪 6 只入内容库（25 → 32，含第三幕 Boss 炉前督军）", () => {
  it("六只全部可解析，含各自的招牌机制", () => {
    // docs/66 §四：三幕 Boss「炉前督军」在 31 之上再 +1
    expect(game.content.enemies.size).toBe(32);
    for (const id of ["glazed_husk", "caisson_pile", "white_slag", "moss_servant", "forge_colossus", "mirror_judge"]) {
      expect(def(id), `缺少敌人 ${id}`).toBeTruthy();
    }
  });

  it("魔免：釉壳残躯用 everyTurns 3 节拍挂 1 回合（玩家数得出来）", () => {
    const e = selfBuff("glazed_husk", "magicimmune");
    expect(e?.intent).toMatchObject({ kind: "selfBuff", buffId: "magicimmune", stacks: 1 });
    expect(e?.everyTurns).toBe(3);
  });

  it("不屈：沉箱桩随机挂 1 回合（maxConsecutive 1，不会连续硬）", () => {
    const e = selfBuff("caisson_pile", "unbreakable");
    expect(e?.intent).toMatchObject({ kind: "selfBuff", buffId: "unbreakable", stacks: 1 });
    expect(e?.maxConsecutive).toBe(1);
  });

  it("力量：白热锻渣走**开场固定 2 层**（startBuffs），不递增 —— 见下方引擎限制", () => {
    // ⚠️ 引擎限制（buff.ts：applyAs === "stacks" 的 buff，duration 会被强制置 null）：
    // 「限时力量」在数据层做不到，selfBuff strength 只会变成**永久力量**，
    // 违反 docs/14 Q12「禁新增永久力量 / 增幅优先限时或一次性」。
    // 因此白热锻渣的开场力量是**固定 2 层、全程不递增**（不是滚雪球），由 startBuffs 表达。
    expect(def("white_slag").startBuffs).toEqual([{ buffId: "strength", stacks: 2 }]);
    expect(selfBuff("white_slag", "strength")).toBeUndefined();
  });

  it("过热自损：白热锻渣给自己挂灼烧（烧到自燃，拖长战斗它自己先烧没）", () => {
    const e = selfBuff("white_slag", "burn");
    expect(e?.intent).toMatchObject({ kind: "selfBuff", buffId: "burn", stacks: 1 });
  });

  it("再生：厚苔机仆挂 3 层 × 3 回合（DPs 门槛怪）", () => {
    const e = selfBuff("moss_servant", "regeneration");
    expect(e?.intent).toMatchObject({ kind: "selfBuff", buffId: "regeneration", stacks: 3, duration: 3 });
  });

  it("精英 · 熔锻巨像：再生 + 法术型蓄 2 链（释放 12 + 6×2 = 24）+ 眩晕抗性", () => {
    expect(def("forge_colossus").maxHp).toBe(112);
    expect(selfBuff("forge_colossus", "regeneration")).toBeTruthy();
    const chain = entries("forge_colossus").find((e) => e.intent.kind === "charge");
    // docs/18：链长 ≤3、末端必须攻击；释放值 = 末端基准 + 蓄力值 × 层数
    expect(chain?.intent.thenIntent?.thenIntent).toMatchObject({ kind: "attack", value: 12 });
    expect(chain?.intent.value).toBe(6);
    expect(chain?.intent.thenIntent?.value).toBe(6);
  });

  it("精英 · 镜面判官：上半场魔免 / 下半场不屈，按 50% 血线分段", () => {
    const upper = selfBuff("mirror_judge", "magicimmune");
    const lower = selfBuff("mirror_judge", "unbreakable");
    expect(upper?.condition).toEqual({ type: "selfHpAtLeast", percent: 50 });
    expect(lower?.condition).toEqual({ type: "selfHpBelow", percent: 50 });
    expect(def("mirror_judge").maxHp).toBe(132);
  });
});

describe("幕注册（只追加条目，不动既有遭遇）", () => {
  const act1 = game.acts[0]!;
  const act2 = game.acts[1]!;
  const poolsWith = (act: typeof act1, id: string) =>
    act.layers.filter((l) => (l.encounters ?? []).some((enc) => enc.enemies.includes(id))).length;

  it("act1：釉壳残躯 / 沉箱桩入遭遇池，熔锻巨像入精英池", () => {
    expect(poolsWith(act1, "glazed_husk")).toBeGreaterThanOrEqual(3);
    expect(poolsWith(act1, "caisson_pile")).toBeGreaterThanOrEqual(2);
    for (const i of [2, 3, 4, 5, 6]) {
      expect(act1.layers[i]!.elitePool).toContain("forge_colossus");
    }
  });

  it("act2：白热锻渣 / 厚苔机仆入遭遇池，镜面判官入精英池", () => {
    expect(poolsWith(act2, "white_slag")).toBeGreaterThanOrEqual(2);
    expect(poolsWith(act2, "moss_servant")).toBeGreaterThanOrEqual(3);
    for (const i of [2, 3, 4, 5, 6]) {
      expect(act2.layers[i]!.elitePool).toContain("mirror_judge");
    }
  });

  it("i18n 三条齐全（name / title / lore）", () => {
    for (const id of ["glazed_husk", "caisson_pile", "white_slag", "moss_servant", "forge_colossus", "mirror_judge"]) {
      expect(game.i18n[`enemy.${id}.name`], `${id}.name`).toBeTruthy();
      expect(game.i18n[`enemy.${id}.title`], `${id}.title`).toBeTruthy();
      expect(game.i18n[`enemy.${id}.lore`], `${id}.lore`).toBeTruthy();
    }
  });
});

/* ---------------- 机制层（此前零使用者，实跑一场钉住） ---------------- */

const dummy: EnemyDefinition = {
  id: "dummy",
  name: "Dummy",
  maxHp: 60,
  intents: [{ intent: { kind: "attack", value: 10 }, weight: 1, maxConsecutive: 99 }],
};

const hexStrength: CardDefinition = {
  id: "test_hex_strength",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: "strength", stacks: 2 }],
};

const hexRegen: CardDefinition = {
  id: "test_hex_regen",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: "regeneration", stacks: 3 }],
};

const hit10: CardDefinition = {
  id: "test_hit10",
  class: "bloodwright",
  type: "attack",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "damage", target: { type: "chosenEnemy" }, value: 10 }],
};

function content(): ContentDb {
  return createContentDb({
    cards: new Map([hexStrength, hexRegen, hit10].map((c) => [c.id, c])),
    enemies: new Map([[dummy.id, dummy]]),
    enhancements: new Map(),
  });
}

function battle(deck: string[]): BattleState {
  return reduce(
    createBattleState({
      battleId: "new-enemies",
      seed: 424242,
      player: { maxHp: 66, energy: 9 },
      enemies: [{ id: "dummy" }],
      deck,
      handSize: 8,
      content: content(),
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string) {
  return reduce(state, { type: "PlayCard", actionId: `p-${cardId}-${state.eventSeq}`, handIndex: handIndex(state, cardId) });
}

function playerDamage(events: readonly DomainEvent[]): number {
  return events
    .filter((e): e is Extract<DomainEvent, { type: "DamageDealt" }> => e.type === "DamageDealt")
    .filter((e) => e.targetId === "player")
    .reduce((sum, e) => sum + e.hpLost, 0);
}

describe("机制层 · 敌方力量（引擎此前从未被数据用过）", () => {
  it("敌人身上 2 层力量 → 它的 10 点攻击打出 12 点伤害", () => {
    let state = battle(["test_hex_strength"]);
    const r1 = play(state, "test_hex_strength");
    state = r1.state;
    expect(state.enemies[0]!.buffs.some((b) => b.id === "strength")).toBe(true);

    // 结束回合 → 敌人打 10（+2 力量）
    const r2 = reduce(state, { type: "EndTurn", actionId: "e1" });
    expect(playerDamage(r2.events)).toBe(12);
  });

  it("引擎限制钉死：力量的 duration 无效（applyAs=stacks → duration 置 null），所以它只能固定、不能限时", () => {
    let state = battle(["test_hex_strength"]);
    state = play(state, "test_hex_strength").state;
    // 推进 5 个回合：若 duration 生效，力量早该过期、伤害回落 10
    for (const i of [1, 2, 3, 4, 5]) {
      state = reduce(state, { type: "EndTurn", actionId: `e${i}` }).state;
    }
    expect(state.enemies[0]!.buffs.some((b) => b.id === "strength")).toBe(true);
    const r = reduce(state, { type: "EndTurn", actionId: "e6" });
    expect(playerDamage(r.events)).toBe(12); // 仍是 12 → duration 被丢弃，力量是永久型
  });
});

describe("机制层 · 敌方再生（引擎此前从未被数据用过）", () => {
  it("敌人挂 3 层再生 → 回合开始回 3 点血", () => {
    let state = battle(["test_hit10", "test_hex_regen"]);
    state = play(state, "test_hit10").state; // 60 → 50
    expect(state.enemies[0]!.hp).toBe(50);
    state = play(state, "test_hex_regen").state;
    expect(state.enemies[0]!.buffs.some((b) => b.id === "regeneration")).toBe(true);

    // 结束回合 → 敌人回合开始 tick 再生 → 回 3
    const r = reduce(state, { type: "EndTurn", actionId: "e1" });
    expect(r.state.enemies[0]!.hp).toBe(53);
  });
});
