// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import { createBattleState, reduce } from "@/core/combat";
import type { EventDefinition } from "@/core/registry";
import {
  createRunState,
  isContentAvailable,
  resolveEventOption,
  rollCardRewards,
  rollRelicChoices,
} from "@/core/map";
import { loadGameContent } from "@/data/load";
import ClassSelectView from "@/ui/views/ClassSelectView.vue";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";

/** docs/36 T1 meta 解锁 + T2 锈蚀难度。 */

const game = loadGameContent();
const act = game.acts[0];
const cls = game.content.classes.get("bloodwright")!;

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/map", component: { template: "<div />" } },
  ],
});

function setup() {
  window.localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  return pinia;
}

describe("docs/36 T1 · 解锁式内容入池", () => {
  it("isContentAvailable：缺省 / none 放行，具名条件按已解锁 id 判定", () => {
    expect(isContentAvailable(undefined, "x", [])).toBe(true);
    expect(isContentAvailable("none", "x", [])).toBe(true);
    expect(isContentAvailable("first_boss_clear", "bloodrust", [])).toBe(false);
    expect(isContentAvailable("first_boss_clear", "bloodrust", ["bloodrust"])).toBe(true);
  });

  it("未解锁时血锈光环不进卡奖池，解锁后进池", () => {
    const locked = createRunState(act, cls, 2026, { unlocked: [] });
    const open = createRunState(act, cls, 2026, { unlocked: ["bloodrust", "immortality", "redlineprotocol"] });
    // 用足够多的节点抽样，锁定档不应出现血锈光环
    const lockedIds = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      for (const id of rollCardRewards(game.content, act, locked, i)) lockedIds.add(id);
    }
    expect(lockedIds.has("bloodrust")).toBe(false);
    expect(lockedIds.has("immortality")).toBe(false);
    // 解锁档的奖池里能滚出血锈光环（同条件内容已放行）
    const openIds = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      for (const id of rollCardRewards(game.content, act, open, i)) openIds.add(id);
    }
    expect(openIds.has("bloodrust")).toBe(true);
  });

  it("炉心余烬锁定时不进遗物池，解锁后进池（T3 Boss 池）", () => {
    expect(rollRelicChoices(game.content, [], 5, [], [3]).includes("ember_core")).toBe(false);
    expect(rollRelicChoices(game.content, [], 5, ["ember_core"], [3]).includes("ember_core")).toBe(true);
  });

  it("事件掉落只取 T1+T2 池：T3 稀有件（炉心余烬）即便解锁也不出事件", () => {
    const event = {
      id: "test_event",
      i18n: "event.test",
      options: [{ id: "a", i18n: "event.test.a", effects: [{ kind: "gainRelic", count: 30 }] }],
    } as unknown as EventDefinition;
    const locked = resolveEventOption(game.content, event, "a", { seed: 7, ownedRelics: [], unlocked: [] });
    expect(locked?.relicIds.includes("ember_core")).toBe(false);
    const open = resolveEventOption(game.content, event, "a", {
      seed: 7,
      ownedRelics: [],
      unlocked: ["ember_core"],
    });
    // 解锁也不进事件池——tier 3 只走 Boss 遗物槽（docs/38 §一 A-1）
    expect(open?.relicIds.includes("ember_core")).toBe(false);
    expect(open?.relicIds.length).toBeGreaterThan(0);
  });

  it("evaluateRun：首通解锁血锈光环；炉心首通解锁余烬；无血契通关解锁不朽", () => {
    setup();
    const meta = useMetaStore();
    meta.markCleared("bloodwright");
    const gained = meta.evaluateRun({ classId: "bloodwright", usedBloodpact: true, overloadCount: 0 });
    expect(gained).toContain("bloodrust");
    expect(gained).not.toContain("immortality");
    meta.markCleared("engineer");
    const second = meta.evaluateRun({ classId: "engineer", usedBloodpact: false, overloadCount: 3 });
    expect(second).toContain("ember_core");
    expect(second).toContain("immortality");
    expect(second).toContain("redlineprotocol");
  });
});

describe("docs/36 T2 · 锈蚀难度", () => {
  it("锈蚀难度敌人 HP ×1.2", () => {
    const normal = createBattleState({
      battleId: "n", seed: 1, player: { maxHp: 66, energy: 3 }, enemies: [{ id: "rust_hound" }],
      deck: ["strike"], content: game.content, difficulty: "normal",
    });
    const rust = createBattleState({
      battleId: "r", seed: 1, player: { maxHp: 66, energy: 3 }, enemies: [{ id: "rust_hound" }],
      deck: ["strike"], content: game.content, difficulty: "rust",
    });
    expect(rust.enemies[0].maxHp).toBe(Math.max(1, Math.round(normal.enemies[0].maxHp * 1.2)));
    expect(rust.enemies[0].maxHp).toBeGreaterThan(normal.enemies[0].maxHp);
  });

  it("锈蚀难度敌人伤害 ×1.1（同一意图打玩家）", () => {
    const damage = (difficulty: "normal" | "rust"): number => {
      let state = createBattleState({
        battleId: "d", seed: 4242, player: { maxHp: 200, energy: 3 }, enemies: [{ id: "rust_hound" }],
        deck: ["strike", "strike", "strike", "strike", "strike"], content: game.content, difficulty,
      });
      state = reduce(state, { type: "Noop", actionId: "s" }).state;
      const before = state.player.hp;
      for (let i = 0; i < 3 && state.phase !== "battleEnd"; i += 1) {
        state = reduce(state, { type: "EndTurn", actionId: "e" + i }).state;
        if (state.player.hp < before) return before - state.player.hp;
      }
      return 0;
    };
    const normal = damage("normal");
    const rust = damage("rust");
    expect(normal).toBeGreaterThan(0);
    expect(rust).toBeGreaterThan(normal);
  });

  it("锈蚀难度精英遗物二选一（run store 依难度裁剪）", () => {
    setup();
    const run = useRunStore();
    run.startRun("bloodwright", 5, "normal");
    expect(run.relicChoices()).toHaveLength(3);
    run.startRun("bloodwright", 5, "rust");
    expect(run.relicChoices()).toHaveLength(2);
    expect(run.run?.difficulty).toBe("rust");
  });

  it("职业选择页：难度二选一同屏，锈蚀未通关时锁定", async () => {
    const pinia = setup();
    const wrapper = mount(ClassSelectView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();
    const buttons = wrapper.findAll(".depth-btn");
    expect(buttons).toHaveLength(2);
    expect(buttons[1].attributes("disabled")).toBeDefined();
    wrapper.unmount();

    const pinia2 = setup();
    useMetaStore().markCleared("bloodwright");
    // 跳过首次教学询问，直接验证难度档写进 run（docs/41 §4.3）
    useMetaStore().markTutorialOffered("bloodwright");
    const wrapper2 = mount(ClassSelectView, { global: { plugins: [pinia2, router] } });
    await wrapper2.vm.$nextTick();
    const rustBtn = wrapper2.findAll(".depth-btn")[1];
    expect(rustBtn.attributes("disabled")).toBeUndefined();
    await rustBtn.trigger("click");
    await wrapper2.findAll(".cls")[0].find(".go").trigger("click");
    expect(useRunStore().run?.difficulty).toBe("rust");
    wrapper2.unmount();
  });
});
