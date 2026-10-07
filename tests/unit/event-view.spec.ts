// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import EventView from "@/ui/views/EventView.vue";
import { generateActMap } from "@/core/map";
import { loadGameContent } from "@/data/load";
import { useRunStore } from "@/stores/run";

/**
 * 玩家反馈：异响拐角结算给的遗物只显示名字，不知道作用。
 * 回归：事件结算面板必须带遗物 / 卡牌的效果描述。
 */

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

function setup() {
  window.localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  return pinia;
}

describe("EventView 结算信息", () => {
  it("获得遗物时显示遗物名与效果描述", async () => {
    const pinia = setup();
    const run = useRunStore();
    const act = loadGameContent().acts[0];
    // 找到第一个能生成事件节点的种子，并把 run 定位到该事件节点
    let seed = 1;
    for (; seed < 50; seed += 1) {
      if (generateActMap(act, seed).some((l) => l.nodes.some((n) => n.kind === "event"))) break;
    }
    run.startRun("bloodwright", seed);
    const map = generateActMap(act, run.run!.seed);
    const li = map.findIndex((l) => l.nodes.some((n) => n.kind === "event"));
    const ni = map[li].nodes.findIndex((n) => n.kind === "event");
    run.run = { ...run.run!, layerIndex: li, picked: [...Array(li).fill(0), ni] };
    run.eventResult = {
      optionId: "a",
      outcomeIndex: -1,
      i18n: "event.gear_gamble.opt.a.win",
      hpDelta: -8,
      maxHpDelta: 0,
      pollutionDelta: 0,
      relicIds: ["redtear_ring"],
      loseRelicIds: [],
      cardIds: ["strike"],
      removeCard: false,
      upgradeIndex: -1,
      gainEnhancement: false,
    };
    const wrapper = mount(EventView, { global: { plugins: [pinia, router] } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".relic-item .gain-name").text()).toContain("红泪戒指");
    expect(wrapper.find(".relic-item .gain-desc").text().length).toBeGreaterThan(0);
    expect(wrapper.find(".card-item .gain-name").text()).toContain("打击");
    wrapper.unmount();
  });
});
