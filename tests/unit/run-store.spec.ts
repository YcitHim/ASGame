import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
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
    expect(run.view?.nodes).toHaveLength(7);
    expect(run.current?.kind).toBe("battle");
    run.advance();
    expect(run.current?.kind).toBe("battle");
    run.advance();
    expect(run.current?.kind).toBe("event");
    run.advance();
    expect(run.current?.kind).toBe("elite");
    run.advance();
    expect(run.current?.kind).toBe("rest");
    expect(run.run?.cleared).toEqual(["n1", "n2", "n2e", "n3"]);
  });

  it("锻造三选一：offers 有可附着目标，applyEnhancement 受 appliesTo/重复限制", () => {
    const run = useRunStore();
    run.startRun(1);
    const offers = run.offers(run.enhancementChoices());
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.targets.length > 0)).toBe(true);

    // 强化只作用于特殊卡：普通打击/防御不参与
    const bloodboltIndex = run.deck.findIndex((c) => c.cardId === "bloodbolt");
    const braceIndex = run.deck.findIndex((c) => c.cardId === "brace");
    const strikeIndex = run.deck.findIndex((c) => c.cardId === "strike");

    expect(run.canApply("empower", strikeIndex)).toBe(false);
    expect(run.canApply("thrifty_pact", strikeIndex)).toBe(false);
    expect(run.canApply("empower", bloodboltIndex)).toBe(true);
    expect(run.applyEnhancement(bloodboltIndex, "empower")).toBe(true);
    expect(run.deck[bloodboltIndex].enhancements).toEqual(["empower"]);
    expect(run.applyEnhancement(bloodboltIndex, "empower")).toBe(false);
    // 起始卡组已无「支撑」：加固暂时没有可附着目标
    expect(run.canApply("fortify", braceIndex)).toBe(false);
    // 节油血契作用于血契卡
    expect(run.canApply("thrifty_pact", bloodboltIndex)).toBe(true);

    // 同一强化全局唯一：给了血之螺栓后，不能再给另一张特殊卡
    const run2 = useRunStore();
    run2.startRun(1);
    run2.addCard("redtear");
    const bb = run2.deck.findIndex((c) => c.cardId === "bloodbolt");
    const rt = run2.deck.findIndex((c) => c.cardId === "redtear");
    expect(run2.canApply("empower", rt)).toBe(true);
    expect(run2.applyEnhancement(bb, "empower")).toBe(true);
    expect(run2.canApply("empower", rt)).toBe(false);
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

  it("同卡双挂：精英残骸强化可附着到已强化过的牌（docs/25 §1.3）", () => {
    const run = useRunStore();
    run.startRun(1);
    const index = run.deck.findIndex((c) => c.cardId === "bloodbolt");
    expect(run.applyEnhancement(index, "empower")).toBe(true);
    // 已挂 1 枚的牌仍可作为附着目标；但**同一节点只能附着一次** → 推进节点后再挂第二枚
    expect(run.canApply("rustbite", index)).toBe(true);
    expect(run.applyEnhancement(index, "rustbite")).toBe(false);
    run.advance();
    expect(run.applyEnhancement(index, "rustbite")).toBe(true);
    expect(run.deck[index].enhancements).toEqual(["empower", "rustbite"]);
  });

  it("每节点只允许附着 1 枚（修复「从地图重进祭坛可反复强化」的 bug）", () => {
    const run = useRunStore();
    run.startRun(1);
    const index = run.deck.findIndex((c) => c.cardId === "bloodbolt");
    expect(run.canEnhanceHere).toBe(true);
    expect(run.applyEnhancement(index, "empower")).toBe(true);
    expect(run.canEnhanceHere).toBe(false);
    // 再次附着（等价于"返回地图后再点祭坛"）必须被拒
    expect(run.applyEnhancement(index, "rustbite")).toBe(false);
    expect(run.deck[index].enhancements).toEqual(["empower"]);
    run.advance();
    expect(run.canEnhanceHere).toBe(true);
  });

  it("重铸：随机换同阶强化，耗 5 HP，每座祭坛限 1 次（docs/16 P3.4）", () => {
    const run = useRunStore();
    run.startRun(1);
    const bloodboltIndex = run.deck.findIndex((c) => c.cardId === "bloodbolt");
    expect(run.canRecast).toBe(false); // 尚无强化
    expect(run.applyEnhancement(bloodboltIndex, "empower")).toBe(true);

    const hpBefore = run.hp;
    expect(run.canRecast).toBe(true);
    expect(run.recastableCards).toContain(bloodboltIndex);

    const result = run.recast(bloodboltIndex);
    expect(result?.removed).toBe("empower");
    expect(run.deck[bloodboltIndex].enhancements).not.toContain("empower");
    expect(run.deck[bloodboltIndex].enhancements).toHaveLength(1);
    // 替换品必须是同 tier
    const content = loadGameContent().content;
    const added = result?.added ?? "";
    expect(content.enhancements.get(added)?.tier).toBe(1);
    expect(run.hp).toBe(hpBefore - 5);

    // 同一祭坛第二次被拒
    expect(run.canRecast).toBe(false);
    expect(run.recast(bloodboltIndex)).toBeNull();
  });

  it("重铸：同阶池已空时禁止（docs/23 §6）", () => {
    const run = useRunStore();
    run.startRun(1);
    run.addCard("brace");
    const braceIndex = run.deck.findIndex((c) => c.cardId === "brace");
    expect(run.applyEnhancement(braceIndex, "fortify")).toBe(true);
    // brace 的 T1 池 = 只有 fortify，移除后无同阶可换 → 禁止重铸
    expect(run.recastableCards).not.toContain(braceIndex);
    expect(run.canRecast).toBe(false);
    expect(run.recast(braceIndex)).toBeNull();
  });

  it("重铸：HP 不足时不可用", () => {
    const run = useRunStore();
    run.startRun(1);
    const bloodboltIndex = run.deck.findIndex((c) => c.cardId === "bloodbolt");
    run.applyEnhancement(bloodboltIndex, "empower");
    run.setHp(5);
    expect(run.canRecast).toBe(false);
    expect(run.recast(bloodboltIndex)).toBeNull();
  });

  it("休息点「移除一张卡」：卡组至少保留 1 张（docs/16 P3.5）", () => {
    const run = useRunStore();
    run.startRun(1);
    const before = run.deck.length;
    const strikeIndex = run.deck.findIndex((c) => c.cardId === "strike");
    expect(run.removeCard(strikeIndex)).toBe(true);
    expect(run.deck).toHaveLength(before - 1);

    while (run.deck.length > 1) run.removeCard(0);
    expect(run.deck).toHaveLength(1);
    expect(run.removeCard(0)).toBe(false);
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

  it("精英遗物掉落：只给未持有，可拾取并落盘（Q10）", () => {
    const run = useRunStore();
    run.startRun(5);
    const offers = run.relicChoices();
    expect(offers.length).toBe(2);
    expect(offers).not.toContain("broken_oil");
    run.addRelic(offers[0]);
    expect(run.relics).toContain(offers[0]);
    expect(run.relicChoices()).toHaveLength(1);
  });

  it("祭坛保底：三选一至少 1 个有可附着目标（Q8）", () => {
    const run = useRunStore();
    run.startRun(11);
    for (let seed = 0; seed < 20; seed += 1) {
      const choices = run.enhancementChoices();
      expect(choices.length).toBe(3);
      const usable = run.usableEnhancements();
      expect(choices.some((id) => usable.includes(id)), `seed=${seed}`).toBe(true);
    }
  });

  it("G2 存档：persist → load 恢复节点/卡组/遗物/HP", () => {
    const run = useRunStore();
    run.startRun(7);
    run.advance();
    run.setHp(41);
    const bloodboltIndex = run.deck.findIndex((c) => c.cardId === "bloodbolt");
    run.applyEnhancement(bloodboltIndex, "empower");
    expect(run.persist).toBeTypeOf("function");
    run.persist();

    const fresh = createPinia();
    setActivePinia(fresh);
    const reloaded = useRunStore();
    expect(reloaded.active).toBe(false);
    expect(reloaded.load()).toBe(true);
    expect(reloaded.run?.nodeIndex).toBe(1);
    expect(reloaded.hp).toBe(41);
    const reloadedBloodbolt = reloaded.deck.findIndex((c) => c.cardId === "bloodbolt");
    expect(reloaded.deck[reloadedBloodbolt].enhancements).toEqual(["empower"]);
    expect(reloaded.relics).toEqual(run.relics);
  });
});
