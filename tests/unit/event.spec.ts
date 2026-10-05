import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveEventOption } from "@/core/map";
import { loadGameContent } from "@/data/load";
import { useRunStore } from "@/stores/run";

/**
 * docs/27 §三 事件 ×5：结果只挂钩现有管线，随机走 event 流（同种子同结果）。
 */

const game = loadGameContent();
const content = game.content;
const event = (id: string) => {
  const def = content.events.get(id);
  if (!def) throw new Error(`missing event ${id}`);
  return def;
};

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

describe("docs/27 §三 事件结算（core/map/event）", () => {
  it("E1 命运齿轮：押注固定 -8 HP，随机结果同种子一致", () => {
    const a = resolveEventOption(content, event("gear_gamble"), "a", { seed: 99, ownedRelics: [] });
    const b = resolveEventOption(content, event("gear_gamble"), "a", { seed: 99, ownedRelics: [] });
    expect(a).toEqual(b);
    expect(a?.hpDelta).toBeLessThanOrEqual(-8);
    expect(a?.outcomeIndex === 0 || a?.outcomeIndex === 1).toBe(true);
    if (a?.outcomeIndex === 0) expect(a.relicIds).toHaveLength(1);
    else expect(a?.hpDelta).toBe(-16);
  });

  it("E2 换血人：成交 -12 HP 且开启强化三选一；以物易物给 1 张罕见", () => {
    const trade = resolveEventOption(content, event("blood_trader"), "a", { seed: 1, ownedRelics: [] });
    expect(trade?.hpDelta).toBe(-12);
    expect(trade?.gainEnhancement).toBe(true);

    const barter = resolveEventOption(content, event("blood_trader"), "b", { seed: 1, ownedRelics: [] });
    expect(barter?.hpDelta).toBe(-5);
    expect(barter?.cardIds).toHaveLength(1);
    expect(content.cards.get(barter!.cardIds[0])?.rarity).toBe("uncommon");
  });

  it("E3 净化圣泉：饮泉 -40 污染；浸入 -70 污染 / -6 HP", () => {
    expect(resolveEventOption(content, event("pure_spring"), "a", { seed: 2, ownedRelics: [] })?.pollutionDelta).toBe(-40);
    const deep = resolveEventOption(content, event("pure_spring"), "b", { seed: 2, ownedRelics: [] });
    expect(deep?.pollutionDelta).toBe(-70);
    expect(deep?.hpDelta).toBe(-6);
  });

  it("E4 废弃发电站：拆线圈只从充能池出牌；主变压器 -4 HP 给稀有", () => {
    const coil = resolveEventOption(content, event("power_station"), "a", { seed: 3, ownedRelics: [] });
    expect(coil?.cardIds).toHaveLength(1);
    expect(["chargeup", "sparkjab", "redline", "discharge"]).toContain(coil!.cardIds[0]);

    const main = resolveEventOption(content, event("power_station"), "b", { seed: 3, ownedRelics: [] });
    expect(main?.hpDelta).toBe(-4);
    expect(content.cards.get(main!.cardIds[0])?.rarity).toBe("rare");
  });

  it("E5 垂死的朝圣者：搜身给 2 张普通 + 10 污染；痛快 -15 污染", () => {
    const loot = resolveEventOption(content, event("dying_pilgrim"), "b", { seed: 4, ownedRelics: [] });
    expect(loot?.cardIds).toHaveLength(2);
    for (const id of loot!.cardIds) expect(content.cards.get(id)?.rarity).toBe("common");
    expect(loot?.pollutionDelta).toBe(10);
    expect(resolveEventOption(content, event("dying_pilgrim"), "c", { seed: 4, ownedRelics: [] })?.pollutionDelta).toBe(-15);
  });

  it("未持有的遗物池为空时不给遗物", () => {
    const owned = [...content.relics.keys()];
    const res = resolveEventOption(content, event("dying_pilgrim"), "a", { seed: 5, ownedRelics: owned });
    expect(res?.relicIds).toHaveLength(0);
  });
});

describe("docs/27 §三 事件在 runStore 的落库", () => {
  beforeEach(() => {
    installLocalStorage();
    setActivePinia(createPinia());
  });

  it("推进到事件节点：抽到事件、结算写回 HP/污染、推进后清除", () => {
    const run = useRunStore();
    run.startRun(1);
    run.advance();
    run.advance();
    expect(run.current?.kind).toBe("event");
    const def = run.eventDef;
    expect(def).toBeTruthy();

    // 选一个固定 -污染 的选项（E3-A），保证可断言
    const option = def!.id === "pure_spring" ? "a" : def!.options[0].id;
    const before = run.hp;
    run.resolveEvent(option);
    expect(run.eventResult).toBeTruthy();
    if (def!.id === "pure_spring") expect(run.pollution).toBe(0); // 0 - 40 截断为 0

    const keepResult = run.eventResult;
    run.eventContinue();
    expect(run.eventResult).toBeNull();
    expect(keepResult?.hpDelta ?? 0).toBeLessThanOrEqual(0);
    expect(run.current?.kind).toBe("elite");
    void before;
  });
});
