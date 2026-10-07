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
  it("MapView：全图可见，入口层唯一节点可进入", async () => {
    const { wrapper } = mountView(MapView);
    await nextTick();
    const run = useRunStore();
    run.startRun("bloodwright", 1);
    await nextTick();
    // docs/48 §3.1 修订 1：一幕 17~31 个节点（起点/祭坛/Boss 各 1，中间 7 层 2~4）
    const nodes = wrapper.findAll(".node");
    expect(nodes.length).toBeGreaterThanOrEqual(17);
    expect(nodes.length).toBeLessThanOrEqual(31);
    // 全图可见（docs/48 §4）：节点全部渲染，不做雾隐
    expect(nodes.length).toBe(run.view!.layers.flatMap((l) => l.nodes).length);
    // 入口层（l0）只有一个必经节点，也是唯一可进入的
    expect(wrapper.findAll(".node.reachable")).toHaveLength(1);
    wrapper.unmount();
  });

  it("MapView：一幕打完先弹幕间入口，两幕打完全局胜利", async () => {
    const { wrapper } = mountView(MapView, (run) => {
      run.startRun("bloodwright", 1);
      for (let i = 0; i < 10; i += 1) run.advance();
    });
    await nextTick();
    // docs/40：一幕通关 → 幕间，而非全局胜利
    expect(wrapper.find(".victory-overlay").exists()).toBe(true);
    expect(wrapper.text()).toContain("回 廊 已 尽");
    // 过幕后再走完第二幕 → 全局胜利
    const run = useRunStore();
    run.enterNextAct();
    for (let i = 0; i < 10; i += 1) run.advance();
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
      for (let i = 0; i < 9; i += 1) run.advance();
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
