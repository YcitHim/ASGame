// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "@/core/events";
import { useBattleStore } from "@/stores/battle";
import { eventDelay } from "@/ui/anim-queue";
import DamageFloat from "@/ui/components/DamageFloat.vue";

/** docs/41 §3.1 / §3.2：挨打要看得见——前扑、护盾微光、受击飘字、减益浮名。 */

let seq = 0;
function ev<T extends DomainEvent["type"]>(
  type: T,
  payload: Omit<Extract<DomainEvent, { type: T }>, "seq" | "actionId" | "type">,
): Extract<DomainEvent, { type: T }> {
  seq += 1;
  return { seq, actionId: "t", type, ...payload } as Extract<DomainEvent, { type: T }>;
}

describe("docs/41 §3.2 受击飘字", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("掉血飘红 −N，被格挡部分单独飘蓝 挡N", () => {
    const store = useBattleStore();
    store.onAnimEvent(
      ev("DamageDealt", {
        sourceId: "e1",
        targetId: "player",
        base: 10,
        layers: [],
        value: 10,
        blocked: 4,
        hpLost: 6,
        segment: 1,
        segments: 1,
      }),
    );
    expect(store.floaters.map((f) => f.kind)).toEqual(["damage", "block"]);
    expect(store.floaters[0].targetId).toBe("player");
    expect(store.floaters[1].value).toBe(4);
    expect(store.shake).toBe(1);
  });

  it("完全格挡只飘「格挡！」，不报伤害", () => {
    const store = useBattleStore();
    store.onAnimEvent(
      ev("DamageDealt", {
        sourceId: "e1",
        targetId: "player",
        base: 6,
        layers: [],
        value: 6,
        blocked: 6,
        hpLost: 0,
        segment: 1,
        segments: 1,
      }),
    );
    expect(store.floaters).toHaveLength(1);
    expect(store.floaters[0].kind).toBe("guard");
    expect(store.floaters[0].text).toBe("格挡！");
  });

  it("玩家吃减益 / 污染时状态栏位置浮名", () => {
    const store = useBattleStore();
    store.onAnimEvent(ev("BuffApplied", { targetId: "player", buffId: "weak", stacks: 2, duration: null }));
    store.onAnimEvent(ev("PollutionChanged", { targetId: "player", before: 0, after: 15, delta: 15, critical: false }));
    const texts = store.floaters.map((f) => f.text);
    expect(texts[0]).toContain("虚弱");
    expect(texts[1]).toContain("污染");
    expect(store.floaters.every((f) => f.kind === "debuff")).toBe(true);
  });

  it("敌人受击不产生 debuff 浮名，且飘字类型对齐玩家侧", () => {
    const store = useBattleStore();
    store.onAnimEvent(ev("BuffApplied", { targetId: "e1", buffId: "vulnerable", stacks: 1, duration: 2 }));
    expect(store.floaters).toHaveLength(0);
    store.onAnimEvent(
      ev("DamageDealt", { sourceId: "player", targetId: "e1", base: 9, layers: [], value: 9, blocked: 0, hpLost: 9, segment: 1, segments: 1 }),
    );
    expect(store.floaters.map((f) => f.kind)).toEqual(["damage"]);
  });
});

/** docs/41 §4.2：卖血牌的自伤与回血要合并成一次净值，不能拆成"先扣再回"。 */
describe("docs/41 §4.2 卖血净值飘字", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("同一次出牌的自伤 + 回血合并为「净 +4」", async () => {
    const store = useBattleStore();
    store.onAnimEvent(ev("CardPlayed", { cardId: "transfusion", handIndex: 0, targetId: null, costPaid: 1, bloodPaid: 2 }));
    store.onAnimEvent(ev("HpLost", { targetId: "player", value: 2, reason: "bloodpact" }));
    store.onAnimEvent(ev("HpHealed", { targetId: "player", value: 6, total: 60, reason: "card" }));
    expect(store.floaters).toHaveLength(1);
    expect(store.floaters[0].kind).toBe("net");
    expect(store.floaters[0].text).toBe("净 +4");
    expect(store.floaters.some((f) => f.kind === "heal")).toBe(false);
    // 合并窗口过后不应再补一条"血契"
    await new Promise((r) => setTimeout(r, 320));
    expect(store.floaters.some((f) => f.kind === "pact")).toBe(false);
  });

  it("纯代价牌（无回血）报「血契 −N」", async () => {
    const store = useBattleStore();
    store.onAnimEvent(ev("HpLost", { targetId: "player", value: 2, reason: "bloodpact" }));
    expect(store.floaters).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 320));
    expect(store.floaters).toHaveLength(1);
    expect(store.floaters[0].kind).toBe("pact");
    expect(store.floaters[0].text).toBe("血契 −2");
  });

  it("非卖血掉血不受影响（伤害照常走红色 −N）", () => {
    const store = useBattleStore();
    store.onAnimEvent(
      ev("DamageDealt", { sourceId: "e1", targetId: "player", base: 5, layers: [], value: 5, blocked: 0, hpLost: 5, segment: 1, segments: 1 }),
    );
    store.onAnimEvent(ev("HpHealed", { targetId: "player", value: 3, total: 63, reason: "regen" }));
    expect(store.floaters.map((f) => f.kind)).toEqual(["damage", "heal"]);
  });
});

describe("docs/41 §3.1 敌人动作", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("敌人攻击玩家 → 前扑标记；玩家打敌人 / 反伤不回扑", async () => {
    const store = useBattleStore();
    store.onAnimEvent(
      ev("DamageDealt", { sourceId: "e1", targetId: "player", base: 8, layers: [], value: 8, blocked: 0, hpLost: 8, segment: 1, segments: 1 }),
    );
    await new Promise((r) => setTimeout(r, 1));
    expect(store.lungeUnits).toContain("e1");

    // 反伤（sourceId = player）不应让玩家"前扑"
    store.onAnimEvent(
      ev("DamageDealt", { sourceId: "player", targetId: "e2", base: 3, layers: [], value: 3, blocked: 0, hpLost: 3, segment: 1, segments: 1 }),
    );
    await new Promise((r) => setTimeout(r, 1));
    expect(store.lungeUnits).not.toContain("player");
  });

  it("敌人架盾 → 护盾微光标记", () => {
    const store = useBattleStore();
    store.onAnimEvent(ev("BlockGained", { targetId: "e1", value: 6, total: 6 }));
    expect(store.guardUnits).toContain("e1");
    // 玩家获得格挡不触发敌人光效
    store.onAnimEvent(ev("BlockGained", { targetId: "player", value: 5, total: 5 }));
    expect(store.guardUnits).toEqual(["e1"]);
  });

  it("多段攻击段间隔 0.12s（其余伤害保持 180ms）", () => {
    expect(
      eventDelay(ev("DamageDealt", { sourceId: "e1", targetId: "player", base: 5, layers: [], value: 5, blocked: 0, hpLost: 5, segment: 1, segments: 3 })),
    ).toBe(120);
    expect(
      eventDelay(ev("DamageDealt", { sourceId: "e1", targetId: "player", base: 5, layers: [], value: 5, blocked: 0, hpLost: 5, segment: 1, segments: 1 })),
    ).toBe(180);
  });
});

describe("docs/41 §3.2 飘字渲染", () => {
  const base = { id: 1, targetId: "player", big: false } as const;

  it("各类型文案：−N / +N / 挡N / 格挡！/ 浮名", () => {
    expect(mount(DamageFloat, { props: { floater: { ...base, kind: "damage", value: 7 } } }).text()).toBe("−7");
    expect(mount(DamageFloat, { props: { floater: { ...base, kind: "heal", value: 6 } } }).text()).toBe("+6");
    expect(mount(DamageFloat, { props: { floater: { ...base, kind: "block", value: 4 } } }).text()).toBe("挡4");
    expect(
      mount(DamageFloat, { props: { floater: { ...base, kind: "guard", value: 0, text: "格挡！" } } }).text(),
    ).toBe("格挡！");
    expect(
      mount(DamageFloat, { props: { floater: { ...base, kind: "debuff", value: 15, text: "污 污染 +15" } } }).text(),
    ).toBe("污 污染 +15");
  });
});
