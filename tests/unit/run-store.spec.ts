import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useRunStore } from "@/stores/run";

/** Node 环境无 localStorage，注入最小内存实现（G2 存档用）。 */
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

describe("S5 局外进度（runStore）", () => {
  beforeEach(() => {
    installLocalStorage();
    setActivePinia(createPinia());
  });

  it("startRun 按关卡起始卡组 / 遗物 / HP 建局", () => {
    const run = useRunStore();
    run.startRun(123);
    expect(run.active).toBe(true);
    expect(run.deck).toHaveLength(10);
    expect(run.relics.length).toBeGreaterThan(0);
    expect(run.hp).toBe(run.maxHp);
    expect(run.run?.nodeIndex).toBe(0);
  });

  it("线性地图：advance 推进节点并记录已清", () => {
    const run = useRunStore();
    run.startRun(1);
    expect(run.view?.nodes).toHaveLength(5);
    expect(run.current?.kind).toBe("battle");
    run.advance();
    expect(run.current?.kind).toBe("elite");
    run.advance();
    expect(run.current?.kind).toBe("rest");
    expect(run.run?.cleared).toEqual(["n1", "n2"]);
  });

  it("锻造三选一：offers 有可附着目标，applyEnhancement 受 appliesTo/重复限制", () => {
    const run = useRunStore();
    run.startRun(1);
    const offers = run.offers(run.enhancementChoices());
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.targets.length > 0)).toBe(true);

    const strikeIndex = run.deck.findIndex((c) => c.cardId === "strike");
    const defendIndex = run.deck.findIndex((c) => c.cardId === "defend");
    expect(run.canApply("empower", strikeIndex)).toBe(true);
    expect(run.canApply("empower", defendIndex)).toBe(false);
    expect(run.applyEnhancement(strikeIndex, "empower")).toBe(true);
    expect(run.deck[strikeIndex].enhancements).toEqual(["empower"]);
    expect(run.applyEnhancement(strikeIndex, "empower")).toBe(false);
  });

  it("休息点：回复 / 升级", () => {
    const run = useRunStore();
    run.startRun(1);
    run.setHp(20);
    run.rest("heal");
    expect(run.hp).toBe(20 + Math.round(run.maxHp * 0.3));
    run.rest("upgrade", 0);
    expect(run.deck[0].upgraded).toBe(true);
    expect(run.rest("upgrade", 0)).toBeUndefined();
  });

  it("卡奖三选一：从非起始卡池抽取，同种子同结果", () => {
    const run = useRunStore();
    run.startRun(42);
    const a = run.cardRewards();
    const b = run.cardRewards();
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a.every((id) => run.cardDef(id)?.rarity !== "starter")).toBe(true);
  });

  it("G2 存档：persist → load 恢复节点/卡组/遗物/HP", () => {
    const run = useRunStore();
    run.startRun(7);
    run.advance();
    run.setHp(41);
    run.applyEnhancement(0, "empower");
    expect(run.persist).toBeTypeOf("function");
    run.persist();

    const fresh = createPinia();
    setActivePinia(fresh);
    const reloaded = useRunStore();
    expect(reloaded.active).toBe(false);
    expect(reloaded.load()).toBe(true);
    expect(reloaded.run?.nodeIndex).toBe(1);
    expect(reloaded.hp).toBe(41);
    expect(reloaded.deck[0].enhancements).toEqual(["empower"]);
    expect(reloaded.relics).toEqual(run.relics);
  });
});
