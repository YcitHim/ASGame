// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import ClassSelectView from "@/ui/views/ClassSelectView.vue";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";

/** docs/16 5.1/5.3：职业抽取 + 选择页 + 解锁式入口 + 职业池隔离。 */

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/map", component: { template: "<div />" } },
  ],
});

function setup() {
  // jsdom 自带 localStorage：每例前清空，避免 meta/codex 相互污染
  window.localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  return pinia;
}

describe("docs/16 5.3 职业选择", () => {
  it("未通关时炉心机士锁定、血械侍僧可选", async () => {
    const pinia = setup();
    const wrapper = mount(ClassSelectView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("血械侍僧");
    expect(wrapper.text()).toContain("炉心未燃");
    expect(wrapper.text()).toContain("锈还未对你开口");
    const cards = wrapper.findAll(".cls");
    expect(cards).toHaveLength(3);
    expect(cards[0].find(".go").attributes("disabled")).toBeUndefined();
    expect(cards[1].find(".go").attributes("disabled")).toBeDefined();
    expect(cards[2].find(".go").attributes("disabled")).toBeDefined();
    // 属性块 + 起始卡组折叠（打击×N）+ 起始遗物带说明
    expect(cards[0].findAll(".stat")).toHaveLength(2);
    const deckText = cards[0].find(".deck-chips").text();
    expect(deckText).toContain("×4");
    expect(deckText).toContain("×3");
    const relic = cards[0].find(".relic-chip");
    expect(relic.text()).toContain("破碎圣油瓶");
    expect(relic.text().length).toBeGreaterThan("破碎圣油瓶".length);
    // 起始卡组 chip 悬停出信息卡（新手看不懂「血之螺栓」时能看到属性）
    const bolts = cards[0].findAll(".deck-chip").filter((c) => c.text().includes("血之螺栓"));
    await bolts[0].trigger("mouseenter");
    const tip = cards[0].find(".deck-tip");
    expect(tip.exists()).toBe(true);
    expect(tip.text()).toContain("血之螺栓");
    expect(tip.text()).toContain("攻击");
    expect(tip.text()).toContain("卖 2 血");
    wrapper.unmount();
  });

  it("血械侍僧通关一次后炉心机士解锁，可选并写入 run.classId", async () => {
    const pinia = setup();
    const meta = useMetaStore();
    meta.markCleared("bloodwright");
    // 已完成/拒绝过教学引导，选择职业直接开局（docs/41 §4.3 首次才问）
    meta.markTutorialOffered("engineer");
    const wrapper = mount(ClassSelectView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();
    const engineer = wrapper.findAll(".cls")[1];
    expect(engineer.find(".go").attributes("disabled")).toBeUndefined();
    await engineer.find(".go").trigger("click");
    const run = useRunStore();
    expect(run.active).toBe(true);
    expect(run.classId).toBe("engineer");
    expect(run.maxHp).toBe(66);
    expect(
      run.deck.every(
        (c) =>
          c.cardId.startsWith("piston") ||
          c.cardId.startsWith("brass") ||
          c.cardId === "gearspin" ||
          c.cardId === "weld",
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it("职业池隔离：炉心机士的卡奖只出 engineer 卡", () => {
    const pinia = setup();
    void pinia;
    const run = useRunStore();
    run.startRun("engineer", 7);
    const rewards = run.cardRewards();
    expect(rewards.length).toBe(3);
    for (const id of rewards) {
      expect(run.cardDef(id)?.class).toBe("engineer");
    }
  });
});
