// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import TraitSelectView from "@/ui/views/TraitSelectView.vue";
import { useRunStore } from "@/stores/run";

/**
 * docs/58 §二.1：选定职业后、进入地图前出现特性选择页。
 * 选项 = 该职业全部特性 + 「无特性」；未选不让进图；确认后写入 RunState.traitId。
 */

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/class-select", name: "class-select", component: { template: "<div />" } },
    { path: "/map", name: "map", component: { template: "<div />" } },
    { path: "/trait-select", name: "trait-select", component: TraitSelectView },
  ],
});

function setup(classId: string, extraQuery: Record<string, string> = {}): ReturnType<typeof createPinia> {
  window.localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  const run = useRunStore();
  run.startRun(classId, 12345, "normal");
  void router.push({ name: "trait-select", query: { class: classId, difficulty: "normal", ...extraQuery } });
  return pinia;
}

describe("docs/58 §二 特性选择页", () => {
  it("血械只有一档特性 + 「无特性」；未选中时进图按钮禁用", async () => {
    const pinia = setup("bloodwright");
    const wrapper = mount(TraitSelectView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll(".trait");
    expect(cards).toHaveLength(2); // 无特性 + 嗜血
    expect(wrapper.text()).toContain("无特性");
    expect(wrapper.text()).toContain("嗜血");

    // 不预选：进图按钮禁用，逼玩家有意做这一选
    expect(wrapper.find(".go").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("工程师二选一；选中后确认写入 run.traitId", async () => {
    const pinia = setup("engineer");
    const wrapper = mount(TraitSelectView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll(".trait");
    expect(cards).toHaveLength(3); // 无特性 + 铁皮王八 + 玻璃大炮
    const texts = cards.map((c) => c.text());
    expect(texts.some((t) => t.includes("铁皮王八"))).toBe(true);
    expect(texts.some((t) => t.includes("玻璃大炮"))).toBe(true);

    const glass = cards.find((c) => c.text().includes("玻璃大炮"))!;
    await glass.trigger("click");
    expect(wrapper.find(".go").attributes("disabled")).toBeUndefined();
    await wrapper.find(".go").trigger("click");

    const run = useRunStore();
    expect(run.run?.traitId).toBe("glass_cannon");
    wrapper.unmount();
  });

  it("选「无特性」写入空串（现版玩法对照组）", async () => {
    const pinia = setup("rustspeaker");
    const wrapper = mount(TraitSelectView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();

    const none = wrapper.findAll(".trait").find((c) => c.text().includes("无特性"))!;
    await none.trigger("click");
    await wrapper.find(".go").trigger("click");

    const run = useRunStore();
    expect(run.run?.traitId).toBe("");
    wrapper.unmount();
  });

  it("不属于本职业的特性写不进去（归属校验兜底）", async () => {
    const pinia = setup("bloodwright");
    void pinia;
    const run = useRunStore();
    // 直接调 action 模拟前端越权传入他职业特性 id
    run.setTrait("glass_cannon");
    expect(run.run?.traitId).toBe("");
    run.setTrait("bloodthirst");
    expect(run.run?.traitId).toBe("bloodthirst");
  });
});
