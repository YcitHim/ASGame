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
import { useTipsStore } from "@/stores/tips";

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

  it("MapView：一幕打完先弹幕间入口，三幕打完全局胜利", async () => {
    const { wrapper } = mountView(MapView, (run) => {
      run.startRun("bloodwright", 1);
      for (let i = 0; i < 10; i += 1) run.advance();
    });
    await nextTick();
    // docs/40：一幕通关 → 幕间，而非全局胜利
    expect(wrapper.find(".victory-overlay").exists()).toBe(true);
    expect(wrapper.text()).toContain("回 廊 已 尽");
    // docs/66 §4.4：过幕后再走完第二幕 → 第二次幕间（锻炉馈赠），仍非全局胜利
    const run = useRunStore();
    run.enterNextAct();
    for (let i = 0; i < 10; i += 1) run.advance();
    await nextTick();
    expect(wrapper.text()).toContain("炉 火 在 前");
    // 走完第三幕 → 全局胜利
    run.enterNextAct();
    for (let i = 0; i < 10; i += 1) run.advance();
    await nextTick();
    expect(wrapper.text()).toContain("远 征 胜 利");
    wrapper.unmount();
  });

  it("RewardView：第一场胜利先给随身遗物三选一，再给卡牌三选一", async () => {
    const { wrapper } = mountView(RewardView, (run) => run.startRun("bloodwright", 1));
    await nextTick();
    // 甲方 2026-10-07：随身遗物改成首胜后发放；甲方 2026-10-08：全部可选，不再过滤
    expect(wrapper.findAll(".relic")).toHaveLength(3);
    await wrapper.findAll(".relic")[0]!.trigger("click");
    await nextTick();
    expect(wrapper.findAll(".option")).toHaveLength(3);
    expect(wrapper.find(".skip").exists()).toBe(true);
    wrapper.unmount();
  });

  it("RewardView：机制不合的随身遗物只标注、不置灰——全部可选（甲方 2026-10-08）", async () => {
    let noted = 0;
    // 三选一来自随机池，多跑几个种子保证至少撞见一次「炉心件 / 卖血件」
    for (let seed = 1; seed <= 12; seed += 1) {
      const { wrapper } = mountView(RewardView, (run) => run.startRun("rustspeaker", seed));
      await nextTick();
      const relics = wrapper.findAll(".relic");
      for (const button of relics) {
        // 一件都不能被禁用、不能置灰
        expect(button.attributes("disabled")).toBeUndefined();
        expect(button.classes()).not.toContain("unfit");
        if (button.find(".unfit-note").exists()) {
          noted += 1;
          expect(button.find(".unfit-note").text()).toContain("本职业无");
          expect(button.find(".pick").text()).toContain("取 走");
        }
      }
      // 点第一件必须走通（不再被拦在「不可选」）
      await relics[0]!.trigger("click");
      await nextTick();
      expect(wrapper.findAll(".option")).toHaveLength(3);
      wrapper.unmount();
    }
    expect(noted).toBeGreaterThan(0);
  });

  it("RewardView：首胜选随身遗物时不弹「挑一张牌」（提示与当前动作对齐）", async () => {
    const { wrapper } = mountView(RewardView, (run) => run.startRun("bloodwright", 1));
    await nextTick();
    const tips = useTipsStore();
    // 这一步选的是随身遗物，卡牌三选一的提示不该在这时候出现
    expect(wrapper.findAll(".relic").length).toBe(3);
    expect(tips.current).toBeNull();
    const pickable = wrapper.findAll(".relic:not([disabled])");
    await pickable[0]!.trigger("click");
    await nextTick();
    // 进了卡牌三选一才弹（relic_pick 占着同屏唯一一条，reward_pick 排队等它）
    expect(tips.current).toBe("relic_pick");
    expect(tips.queue).toContain("reward_pick");
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
