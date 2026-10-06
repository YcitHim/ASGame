// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import { nextTick } from "vue";
import MapView from "@/ui/views/MapView.vue";
import RewardView from "@/ui/views/RewardView.vue";
import RestView from "@/ui/views/RestView.vue";
import { useRunStore } from "@/stores/run";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

function mountView(component: Parameters<typeof mount>[0], setup?: (run: ReturnType<typeof useRunStore>) => void) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const run = useRunStore();
  setup?.(run);
  return { pinia, run, wrapper: mount(component, { global: { plugins: [pinia, router] } }) };
}

describe("S5 UI 流程视图挂载", () => {
  it("MapView：分支地图共 12 个候选节点，当前层可进入", async () => {
    const { wrapper } = mountView(MapView);
    await nextTick();
    const run = useRunStore();
    run.startRun("bloodwright", 1);
    await nextTick();
    expect(wrapper.findAll(".node")).toHaveLength(12);
    // 入口层（l0）只有一个必经节点
    expect(wrapper.findAll(".go")).toHaveLength(1);
    wrapper.unmount();
  });

  it("MapView：一幕打完先弹幕间入口，两幕打完全局胜利", async () => {
    const { wrapper } = mountView(MapView, (run) => {
      run.startRun("bloodwright", 1);
      for (let i = 0; i < 8; i += 1) run.advance();
    });
    await nextTick();
    // docs/40：一幕通关 → 幕间，而非全局胜利
    expect(wrapper.find(".victory-overlay").exists()).toBe(true);
    expect(wrapper.text()).toContain("回 廊 已 尽");
    // 过幕后再走完第二幕 → 全局胜利
    const run = useRunStore();
    run.enterNextAct();
    for (let i = 0; i < 8; i += 1) run.advance();
    await nextTick();
    expect(wrapper.text()).toContain("远 征 胜 利");
    wrapper.unmount();
  });

  it("RewardView：普通节点给出三选一", async () => {
    const { wrapper } = mountView(RewardView, (run) => run.startRun("bloodwright", 1));
    await nextTick();
    expect(wrapper.findAll(".option")).toHaveLength(3);
    expect(wrapper.find(".skip").exists()).toBe(true);
    wrapper.unmount();
  });

  it("RewardView：Boss 节点显示远征胜利而非卡奖", async () => {
    const { wrapper } = mountView(RewardView, (run) => {
      run.startRun("bloodwright", 1);
      for (let i = 0; i < 7; i += 1) run.advance();
    });
    await nextTick();
    expect(wrapper.text()).toContain("远 征 胜 利");
    expect(wrapper.findAll(".option")).toHaveLength(0);
    wrapper.unmount();
  });

  it("RestView：三个选项；选择打磨后列出卡组", async () => {
    const { wrapper, run } = mountView(RestView, (r) => {
      r.startRun("bloodwright", 1);
      // 推进到精英后的汇合点（l4，必为休息）
      for (let i = 0; i < 4; i += 1) r.advance();
    });
    await nextTick();
    // 休息点三选一：憩息 / 打磨 / 剔除（docs/16 P3.5）
    expect(wrapper.findAll(".choice")).toHaveLength(3);
    await wrapper.findAll(".choice")[1].trigger("click");
    await nextTick();
    // 升级模式改为「升级后卡面」预览（docs/program 手感优化）
    expect(wrapper.findAll(".upgrade-card")).toHaveLength(run.deckSize);
    wrapper.unmount();
  });
});
