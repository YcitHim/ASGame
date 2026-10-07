import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkEventCondition,
  createRunState,
  eventConditionCurrent,
  generateActMap,
  resolveEventOption,
} from "@/core/map";
import { loadGameContent } from "@/data/load";
import { useRunStore } from "@/stores/run";

/**
 * docs/27 §三 事件结算 + docs/54 §三 引擎扩展（E1~E7）。
 * 规则在 core，这里逐种效果对账；随机结果走 event 流（同种子同结果）。
 */

const game = loadGameContent();
const content = game.content;
const event = (id: string) => {
  const def = content.events.get(id);
  if (!def) throw new Error(`missing event ${id}`);
  return def;
};

/** 局外 HP 一律 66（= 血械满血），百分比才好算：8%→5、15%→9、10%→6、30%→19… */
const MAX = 66;
const ctx = (seed: number, over: Record<string, unknown> = {}) => ({
  seed,
  ownedRelics: [] as string[],
  maxHp: MAX,
  hp: MAX,
  pollution: 0,
  ...over,
});

function installLocalStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const T1 = [...content.relics.values()]
  .filter((r) => r.tier === 1)
  .map((r) => r.id)
  .sort();

describe("docs/54 §三 E1 hpPercent：代价随上限缩放", () => {
  it("命运齿轮三档：小押 −8% / 大押 −15%，同种子同结果", () => {
    const a1 = resolveEventOption(content, event("gear_gamble"), "a", ctx(99));
    const a2 = resolveEventOption(content, event("gear_gamble"), "a", ctx(99));
    expect(a1).toEqual(a2);
    // 66 × 8% = 5.28 → 向下取整 5
    expect(a1?.hpDelta).toBe(-5);
    expect([0, 1]).toContain(a1?.outcomeIndex);
    if (a1?.outcomeIndex === 0) expect(a1.cardIds).toHaveLength(1);
    else expect(a1?.cardIds).toHaveLength(0);

    const b = resolveEventOption(content, event("gear_gamble"), "b", ctx(99));
    expect(b?.hpDelta).toBeLessThanOrEqual(-9); // 66 × 15% = 9.9 → 9
    if (b?.outcomeIndex === 0) expect(b.relicIds).toHaveLength(1);
    else expect(b?.hpDelta).toBe(-9 - 6); // 再失 10% = 6

    const leave = resolveEventOption(content, event("gear_gamble"), "c", ctx(99));
    expect(leave?.hpDelta).toBe(0);
    expect(leave?.outcomeIndex).toBe(-1);
  });

  it("向下取整且有最低 1：上限 3 时 −10% 也扣 1 点", () => {
    const res = resolveEventOption(content, event("pure_spring"), "b", ctx(2, { maxHp: 3, hp: 3 }));
    expect(res?.hpDelta).toBe(-1);
  });

  it("换血人 −15% / −6%；净化圣泉浸入 −8%；垂死 −6%；净罪 −10%（旧版写死的点数已换算）", () => {
    expect(resolveEventOption(content, event("blood_trader"), "a", ctx(1))?.hpDelta).toBe(-9);
    expect(resolveEventOption(content, event("blood_trader"), "b", ctx(1))?.hpDelta).toBe(-3);
    expect(resolveEventOption(content, event("pure_spring"), "b", ctx(2))?.hpDelta).toBe(-5);
    expect(resolveEventOption(content, event("dying_pilgrim"), "a", ctx(4))?.hpDelta).toBe(-3);
    expect(resolveEventOption(content, event("sanctum_absolution"), "a", ctx(6))?.hpDelta).toBe(-6);
  });
});

describe("docs/54 §三 E4 maxHp / E2 removeCard / E3 upgradeRandom / E5 loseRelic", () => {
  it("E4 活扳手：只动上限（+4），当前 HP 由调用方同额写回", () => {
    const res = resolveEventOption(content, event("living_wrench"), "a", ctx(7));
    expect(res?.maxHpDelta).toBe(4);
    expect(res?.hpDelta).toBe(-5); // 代价仍是 8% 上限
  });

  it("E4 静默告解：污染 −40 换上限 −3（情节性小额，写死点数）", () => {
    const res = resolveEventOption(content, event("silent_confession"), "a", ctx(8, { pollution: 60 }));
    expect(res?.maxHpDelta).toBe(-3);
    expect(res?.pollutionDelta).toBe(-40);
  });

  it("E2 废弃诊所 / 藤壶医生：要求玩家自选删一张", () => {
    expect(resolveEventOption(content, event("abandoned_clinic"), "a", ctx(11))?.removeCard).toBe(true);
    expect(resolveEventOption(content, event("barnacle_doctor"), "a", ctx(11))?.removeCard).toBe(true);
    expect(resolveEventOption(content, event("barnacle_doctor"), "b", ctx(11))?.removeCard).toBe(false);
  });

  it("E3 磨刀人学艺 / 藤壶敷药：随机升级只从可升级的牌里点", () => {
    const res = resolveEventOption(content, event("wandering_sharpener"), "b", ctx(12, { deckUpgradeable: [2, 5] }));
    expect([2, 5]).toContain(res?.upgradeIndex);
    expect(res?.pollutionDelta).toBe(8);
    expect(
      resolveEventOption(content, event("wandering_sharpener"), "b", ctx(12, { deckUpgradeable: [] }))?.upgradeIndex,
    ).toBe(-1);
  });

  it("E5 血之当铺当货：只吃 T1，无 tier 的件与 T2/T3 都不动", () => {
    // 现池：T1 ×8 / T2 ×9 / T3 ×5 / 无 tier ×3（broken_oil 等）
    const identity = [...content.relics.values()]
      .filter((r) => r.tier === undefined)
      .map((r) => r.id);
    expect(identity.length).toBeGreaterThan(0);
    const owned = [...identity, ...T1.slice(0, 3)];
    const res = resolveEventOption(content, event("blood_pawnshop"), "a", ctx(13, { ownedRelics: owned }));
    expect(res?.loseRelicIds).toHaveLength(1);
    expect(T1).toContain(res!.loseRelicIds[0]);
    expect(identity).not.toContain(res!.loseRelicIds[0]);
  });
});

describe("docs/54 §三 E6 选项条件", () => {
  it("三种条件各自的判定与当前值同源", () => {
    const c = { hp: 30, maxHp: 60, pollution: 45, relicCount: 2 };
    expect(checkEventCondition({ kind: "hpPercentAtLeast", value: 50 }, c)).toBe(true);
    expect(checkEventCondition({ kind: "hpPercentAtLeast", value: 51 }, c)).toBe(false);
    expect(checkEventCondition({ kind: "pollutionAtLeast", value: 45 }, c)).toBe(true);
    expect(checkEventCondition({ kind: "relicCountAtLeast", value: 3 }, c)).toBe(false);
    expect(checkEventCondition(undefined, c)).toBe(true);
    // 显示与判定同源：41/100 显示 41，判 50 就该不达标
    const edge = { hp: 41, maxHp: 100, pollution: 0, relicCount: 0 };
    expect(eventConditionCurrent({ kind: "hpPercentAtLeast", value: 40 }, edge)).toBe(41);
    expect(eventConditionCurrent({ kind: "pollutionAtLeast", value: 40 }, edge)).toBe(0);
    expect(eventConditionCurrent({ kind: "relicCountAtLeast", value: 2 }, edge)).toBe(0);
  });

  it("条件不满足时 core 直接拒绝结算（不是靠 UI 拦）", () => {
    expect(
      resolveEventOption(content, event("silent_confession"), "a", ctx(9, { pollution: 10 })),
    ).toBeNull();
    expect(
      resolveEventOption(content, event("silent_confession"), "a", ctx(9, { pollution: 50 })),
    ).not.toBeNull();
    // HP 不足 20% 时做不了手术
    expect(resolveEventOption(content, event("abandoned_clinic"), "a", ctx(9, { hp: 10 }))).toBeNull();
  });
});

describe("docs/54 §三 E7 同幕事件不放回", () => {
  beforeEach(() => installLocalStorage());

  it("本幕已结算过的事件不再入池；池尽则重置回全池", async () => {
    const { rollEvent } = await import("@/core/map");
    const act = game.acts[0];
    const cls = content.classes.get("bloodwright")!;
    const node = { id: "event_1_0", kind: "event", events: ["gear_gamble", "blood_trader"] } as never;
    const base = createRunState(act, cls, 4242);
    /** 已经抽过的记账：层号故意取负数，避免撞上真正要抽的那层 */
    const seen = (ids: string[]) => ids.map((eventId, i) => ({ layer: -1 - i, eventId }));
    expect(rollEvent(content, { ...base, seenEvents: [] }, node)?.id).toBeTruthy();
    expect(rollEvent(content, { ...base, seenEvents: seen(["gear_gamble"]) }, node)?.id).toBe("blood_trader");
    expect(rollEvent(content, { ...base, seenEvents: seen(["blood_trader"]) }, node)?.id).toBe("gear_gamble");
    const reset = rollEvent(content, { ...base, seenEvents: seen(["gear_gamble", "blood_trader"]) }, node);
    expect(["gear_gamble", "blood_trader"]).toContain(reset?.id);
    // 本层已经抽过 → 原样返回（结算页的标题/正文不会再被重掷成另一个故事）
    expect(
      rollEvent(content, { ...base, seenEvents: [{ layer: base.layerIndex, eventId: "gear_gamble" }] }, node)?.id,
    ).toBe("gear_gamble");
  });

  it("转幕清空不放回池（一局两幕 ≠ 一局不重复）", async () => {
    const { applyIntermission } = await import("@/core/map");
    const act = game.acts[0];
    const cls = content.classes.get("bloodwright")!;
    const run = {
      ...createRunState(act, cls, 1),
      seenEvents: [{ layer: 3, eventId: "gear_gamble" }],
    };
    expect(applyIntermission(run).seenEvents).toEqual([]);
  });
});

describe("事件在 runStore 的落库（docs/27 §三 / docs/54）", () => {
  beforeEach(() => {
    installLocalStorage();
    setActivePinia(createPinia());
  });

  /** 把 run 定位到事件节点；only 用不放回池把抽签锁死到指定事件。 */
  function toEventNode(run: ReturnType<typeof useRunStore>, only?: string): void {
    const act = game.acts[0];
    let seed = 1;
    for (; seed < 60; seed += 1) {
      if (generateActMap(act, seed).some((l) => l.nodes.some((n) => n.kind === "event"))) break;
    }
    run.startRun("bloodwright", seed);
    const map = generateActMap(act, run.run!.seed);
    const li = map.findIndex((l) => l.nodes.some((n) => n.kind === "event"));
    const ni = map[li].nodes.findIndex((n) => n.kind === "event");
    const pool = [...content.events.keys()].sort().filter((id) => id !== only);
    // 层号取负数：只用来"标记这些事件本幕已用过"，不能占掉目标层的名额
    const seenEvents = pool.map((eventId, i) => ({ layer: -1 - i, eventId }));
    run.run = { ...run.run!, layerIndex: li, picked: [...Array(li).fill(0), ni], seenEvents };
  }

  it("结算写回并记进不放回池，继续后清空", () => {
    const run = useRunStore();
    toEventNode(run);
    const def = run.eventDef!;
    expect(def).toBeTruthy();
    const option = def.options.find((o) => run.eventConditionMet(o.condition))!;
    run.resolveEvent(option.id);
    expect(run.eventResult).toBeTruthy();
    expect(run.run!.seenEvents.some((s) => s.eventId === def.id)).toBe(true);
    // 结算之后同一节点仍然指着同一个故事（E7 的记账不能反过来重掷本层）
    expect(run.eventDef?.id).toBe(def.id);
    run.eventContinue();
    expect(run.eventResult).toBeNull();
    expect(run.eventRemovedIndex).toBeNull();
  });

  it("E4：上限变化按「当前 HP 同额」写回，并夹在 [1, 上限]", () => {
    const run = useRunStore();
    toEventNode(run, "living_wrench");
    expect(run.eventDef?.id).toBe("living_wrench");
    run.run = { ...run.run!, hp: 30 };
    run.resolveEvent("a");
    // 30 − 5（8% 上限）+ 4（同额）= 29；上限 +4
    expect(run.maxHp).toBe(MAX + 4);
    expect(run.hp).toBe(29);
  });

  it("E5：当货真的从遗物栏里扣掉一件", () => {
    const run = useRunStore();
    toEventNode(run, "blood_pawnshop");
    expect(run.eventDef?.id).toBe("blood_pawnshop");
    run.relics = [...T1.slice(0, 3)];
    run.run = { ...run.run!, hp: 20 };
    run.resolveEvent("a");
    expect(run.relics).toHaveLength(2);
    expect(run.hp).toBe(39); // 20 + 30% × 66 = 19
  });

  it("E2：结果要求删牌时先选牌，选完才能继续", () => {
    const run = useRunStore();
    toEventNode(run, "abandoned_clinic");
    expect(run.eventDef?.id).toBe("abandoned_clinic");
    run.resolveEvent("a");
    expect(run.eventResult?.removeCard).toBe(true);
    // 结算完就挂起等玩家挑牌（null = 还没挑）；-1 = 无需挑牌
    expect(run.eventRemovedIndex).toBeNull();
    const before = run.deck.length;
    expect(run.removeEventCard(0)).toBe(true);
    expect(run.deck.length).toBe(before - 1);
    expect(run.eventRemovedIndex).toBe(0);
    expect(run.removeEventCard(0)).toBe(false);
    run.eventContinue();
    expect(run.eventRemovedIndex).toBeNull();
  });
});
