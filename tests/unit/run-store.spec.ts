import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useRunStore } from "@/stores/run";

describe("S4 局外卡组（runStore）", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("startRun 按关卡起始卡组与遗物建局", () => {
    const run = useRunStore();
    run.startRun(123);
    expect(run.active).toBe(true);
    expect(run.deck).toHaveLength(10);
    expect(run.relics).toHaveLength(4);
    expect(run.deck.every((c) => c.upgraded === false && c.enhancements.length === 0)).toBe(true);
    expect(run.encounterIndex).toBe(0);
  });

  it("offers 只列出有可附着目标的强化", () => {
    const run = useRunStore();
    run.startRun(1);
    const offers = run.offers();
    expect(offers.length).toBe(3);
    expect(offers.every((o) => o.targets.length > 0)).toBe(true);
  });

  it("applyEnhancement 受 appliesTo / 重复 / 槽位限制", () => {
    const run = useRunStore();
    run.startRun(1);
    const strikeIndex = run.deck.findIndex((c) => c.cardId === "strike");
    const defendIndex = run.deck.findIndex((c) => c.cardId === "defend");

    expect(run.canApply("empower", strikeIndex)).toBe(true);
    expect(run.canApply("empower", defendIndex)).toBe(false);
    expect(run.applyEnhancement(strikeIndex, "empower")).toBe(true);
    expect(run.deck[strikeIndex].enhancements).toEqual(["empower"]);
    expect(run.canApply("empower", strikeIndex)).toBe(false);
    expect(run.applyEnhancement(strikeIndex, "empower")).toBe(false);

    expect(run.canApply("fortify", defendIndex)).toBe(true);
    expect(run.applyEnhancement(defendIndex, "fortify")).toBe(true);
  });

  it("槽位上限 3：打满后不可再附着", () => {
    const run = useRunStore();
    run.startRun(1);
    const strikeIndex = run.deck.findIndex((c) => c.cardId === "strike");
    for (let i = 0; i < 3; i += 1) {
      run.deck = run.deck.map((c, idx) =>
        idx === strikeIndex ? { ...c, enhancements: [...c.enhancements, `slot${i}`] } : c,
      );
    }
    expect(run.canApply("empower", strikeIndex)).toBe(false);
  });

  it("upgradeCard 只生效一次；advanceEncounter 推进遭遇", () => {
    const run = useRunStore();
    run.startRun(1);
    expect(run.upgradeCard(0)).toBe(true);
    expect(run.deck[0].upgraded).toBe(true);
    expect(run.upgradeCard(0)).toBe(false);
    run.advanceEncounter();
    expect(run.encounterIndex).toBe(1);
  });
});
