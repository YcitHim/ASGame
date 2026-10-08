// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import ClassSelectView from "@/ui/views/ClassSelectView.vue";
import MapView from "@/ui/views/MapView.vue";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useSettingsStore } from "@/stores/settings";

/** 开发者模式：解锁全部 + 选人/地图跳关入口。 */

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/map", component: { template: "<div />" } },
    { path: "/trait-select", name: "trait-select", component: { template: "<div />" } },
  ],
});

function setup() {
  window.localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  const settings = useSettingsStore();
  settings.init();
  return { pinia, settings };
}

describe("开发者模式", () => {
  it("开启后解锁全部职业 / 内容 / 锈蚀难度", () => {
    const { settings } = setup();
    const meta = useMetaStore();
    expect(meta.isUnlocked("both_classes_clear")).toBe(false);
    expect(meta.isContentUnlocked("ember_core")).toBe(false);
    settings.update({ developerMode: true });
    expect(meta.isUnlocked("both_classes_clear")).toBe(true);
    expect(meta.isContentUnlocked("double_pendulum")).toBe(true);
    expect(meta.rustUnlocked).toBe(true);
  });

  it("选人页露出 DEV 面板；可指定起始幕 / 层", async () => {
    const { pinia, settings } = setup();
    settings.update({ developerMode: true });
    const wrapper = mount(ClassSelectView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".dev-panel").exists()).toBe(true);
    // 切到第二幕并设起始层
    const actButtons = wrapper.findAll(".dev-btn");
    const acts = wrapper.findAll(".dev-panel .dev-btn");
    expect(acts.length).toBeGreaterThanOrEqual(1);
    if (acts.length > 1) await acts[1].trigger("click");
    await wrapper.find(".dev-num").setValue(3);
    await wrapper.findAll(".cls")[0].find(".go").trigger("click");
    const run = useRunStore();
    expect(run.run?.layerIndex).toBe(3);
    expect(run.run?.actIndex).toBe(acts.length > 1 ? 1 : 0);
    wrapper.unmount();
    void actButtons;
  });

  it("地图页 DEV 面板：跳过本层推进 layerIndex", async () => {
    const { pinia, settings } = setup();
    settings.update({ developerMode: true });
    const run = useRunStore();
    run.startRun("bloodwright", 7, "normal", "blood_pump", { actIndex: 0, layerIndex: 0 });
    const wrapper = mount(MapView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".dev-panel").exists()).toBe(true);
    const before = run.run?.layerIndex ?? 0;
    await wrapper.findAll(".dev-btn")[0].trigger("click");
    expect(run.run?.layerIndex).toBe(before + 1);
    wrapper.unmount();
  });
});
