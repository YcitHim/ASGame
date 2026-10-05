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
  it("MapView：6 个节点，当前节点可进入", async () => {
    const { wrapper } = mountView(MapView);
    await nextTick();
    const run = useRunStore();
    run.startRun(1);
    await nextTick();
    expect(wrapper.findAll(".node")).toHaveLength(6);
    expect(wrapper.findAll(".go")).toHaveLength(1);
    wrapper.unmount();
  });

  it("RewardView：普通节点给出三选一", async () => {
    const { wrapper } = mountView(RewardView, (run) => run.startRun(1));
    await nextTick();
    expect(wrapper.findAll(".option")).toHaveLength(3);
    expect(wrapper.find(".skip").exists()).toBe(true);
    wrapper.unmount();
  });

  it("RewardView：Boss 节点显示远征胜利而非卡奖", async () => {
    const { wrapper } = mountView(RewardView, (run) => {
      run.startRun(1);
      for (let i = 0; i < 5; i += 1) run.advance();
    });
    await nextTick();
    expect(wrapper.text()).toContain("远 征 胜 利");
    expect(wrapper.findAll(".option")).toHaveLength(0);
    wrapper.unmount();
  });

  it("RestView：两个选项；选择打磨后列出卡组", async () => {
    const { wrapper, run } = mountView(RestView, (r) => {
      r.startRun(1);
      r.advance();
      r.advance();
      r.advance();
    });
    await nextTick();
    expect(wrapper.findAll(".choice")).toHaveLength(2);
    await wrapper.findAll(".choice")[1].trigger("click");
    await nextTick();
    expect(wrapper.findAll(".deck-card")).toHaveLength(run.deckSize);
    wrapper.unmount();
  });
});
