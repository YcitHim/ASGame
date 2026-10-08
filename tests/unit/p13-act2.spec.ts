// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import { createRunState, generateActMap, rollEnhancementChoices } from "@/core/map";
import { loadGameContent } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useRunStore } from "@/stores/run";
import { actCopy } from "@/ui/act-copy";
import { useActTheme } from "@/ui/composables/useActTheme";

/** docs/40 · 第二幕数据与幕专属强化入池。 */

const game = loadGameContent();
const acts = game.acts;
const act1 = acts.find((a) => a.id === "act1")!;
const act2 = acts.find((a) => a.id === "act2")!;

describe("docs/40 act2 数据", () => {
  it("act2 十层：精英池挂 l2~l6、l1/l7 无精英、Boss 沉钟唱诗长（docs/48 §3.1）", () => {
    expect(act2.layers).toHaveLength(10);
    for (const i of [2, 3, 4, 5, 6]) {
      expect(act2.layers[i].elitePool).toEqual(["sanctum_jailer", "tidecaller", "mirror_judge"]);
    }
    expect(act2.layers[1].kinds).not.toContain("elite");
    expect(act2.layers[7].kinds).not.toContain("elite");
    expect(act2.layers[9].enemies).toEqual(["drowned_choirmaster"]);
  });

  it("同幕精英不重复（地图生成，前两只必不同）", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const map = generateActMap(act2, seed);
      const eliteIds = map
        .flatMap((l) => l.nodes)
        .filter((n) => n.kind === "elite")
        .map((n) => n.enemies?.[0]);
      expect(eliteIds.length).toBeGreaterThanOrEqual(2);
      expect(eliteIds[0]).not.toBe(eliteIds[1]);
    }
  });

  it("act2 节点文案走圣堂主题（不沿用第一幕的锈蚀回廊）", () => {
    const map = generateActMap(act2, 42);
    const battle = map[0].nodes[0];
    expect(battle.i18n).toBe("node.act2.battle");
    expect(map[9].nodes[0].i18n).toBe("node.act2.boss");
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
    // 25% (floor 17) + 50% (floor 35) = 72 → clamp 70（docs/58 §三：血械血量 66→70）
    expect(run.run?.hp).toBe(70);
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

  it("actCopy：有 actN 用 actN，没有则回落 act1", () => {
    expect(actCopy("result.victory", 0)).toContain("锈喉");
    expect(actCopy("result.victory", 1)).toContain("沉钟");
    // 只写了 act1 的句子 → 第二幕沿用第一幕，不会露出 key
    expect(actCopy("result.bossFall", 1)).toContain("唱诗长");
    expect(actCopy("result.noSuchKey", 1)).toBe("result.noSuchKey");
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
