// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import { createRunState, generateActMap, rollEnhancementChoices } from "@/core/map";
import { loadGameContent } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useRunStore } from "@/stores/run";
import { useActTheme } from "@/ui/composables/useActTheme";

/** docs/40 · 第二幕数据与幕专属强化入池。 */

const game = loadGameContent();
const acts = game.acts;
const act1 = acts.find((a) => a.id === "act1")!;
const act2 = acts.find((a) => a.id === "act2")!;

describe("docs/40 act2 数据", () => {
  it("act2 八层：双精英夹一个必经休息、Boss 沉钟唱诗长", () => {
    expect(act2.layers).toHaveLength(8);
    expect(act2.layers[3].elitePool).toEqual(["sanctum_jailer", "tidecaller"]);
    expect(act2.layers[6].elitePool).toEqual(["sanctum_jailer", "tidecaller"]);
    expect(act2.layers[4].kinds).toEqual(["rest"]);
    expect(act2.layers[7].enemies).toEqual(["drowned_choirmaster"]);
  });

  it("同幕双精英不重复（地图生成）", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const map = generateActMap(act2, seed);
      expect(map[3].nodes[0].enemies?.[0]).not.toBe(map[6].nodes[0].enemies?.[0]);
    }
  });

  it("act2 节点文案走圣堂主题（不沿用第一幕的锈蚀回廊）", () => {
    const map = generateActMap(act2, 42);
    const battle = map[0].nodes[0];
    expect(battle.i18n).toBe("node.act2.battle");
    expect(map[7].nodes[0].i18n).toBe("node.act2.boss");
    // 第一幕仍用通用文案
    const map1 = generateActMap(act1, 42);
    expect(map1[0].nodes[0].i18n).toBe("node.battle");
  });

  it("幕专属强化只在对应幕入池", () => {
    const cls = game.content.classes.get("bloodwright")!;
    const run = createRunState(act2, cls, 7);
    const inAct2 = rollEnhancementChoices(game.content, run, 0, 12, "act2").map((id) => id);
    const inAct1 = rollEnhancementChoices(game.content, run, 0, 12, "act1").map((id) => id);
    for (const id of ["sanctum_quench", "abyssal_hush", "sunk_cost", "choir_reverb"]) {
      expect(inAct2).toContain(id);
      expect(inAct1).not.toContain(id);
    }
  });
});

describe("docs/40 幕间馈赠", () => {
  it("applyBoon heal：切幕 + 25% + 50% 回血，污染清零", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    // 模拟一幕末尾：扣血 / 加污染 / 推到末尾
    run.run = { ...run.run!, hp: 20, pollution: 60, layerIndex: act1.layers.length - 1 };
    run.applyBoon("heal");
    expect(run.run?.actIndex).toBe(1);
    expect(run.run?.pollution).toBe(0);
    // 25% (floor 16) + 50% (floor 33) = 69 → clamp 66
    expect(run.run?.hp).toBe(66);
  });

  it("applyBoon upgrade：免费升级一张牌并切幕", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    run.run = { ...run.run!, layerIndex: act1.layers.length - 1 };
    run.applyBoon("upgrade", 0);
    expect(run.deck[0].upgraded).toBe(true);
    expect(run.run?.actIndex).toBe(1);
  });
});

describe("docs/40 幕归属与幕主题", () => {
  it("useActTheme：<html> 的 act-N 跟随当前幕切换", async () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("bloodwright", 5);
    useActTheme();
    await nextTick();
    expect(document.documentElement.classList.contains("act-1")).toBe(true);
    expect(document.documentElement.classList.contains("act-2")).toBe(false);
    run.run = { ...run.run!, actIndex: 1 };
    await nextTick();
    expect(document.documentElement.classList.contains("act-2")).toBe(true);
    expect(document.documentElement.classList.contains("act-1")).toBe(false);
    document.documentElement.className = "";
  });

  it("战斗归属当前幕（act2 不再标成 act1）", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("engineer", 9, "normal", undefined, { actIndex: 1, layerIndex: 0 });
    const battle = useBattleStore();
    battle.start();
    expect(battle.battle?.battleId.startsWith("act2-")).toBe(true);
    battle.skip();
  });
});
