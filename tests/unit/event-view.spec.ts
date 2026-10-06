// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import EventView from "@/ui/views/EventView.vue";
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
    run.startRun("bloodwright", 1);
    run.advance();
    run.advance();
    run.eventResult = {
      optionId: "a",
      outcomeIndex: -1,
      i18n: "event.gear_gamble.opt.a.win",
      hpDelta: -8,
      pollutionDelta: 0,
      relicIds: ["redtear_ring"],
      cardIds: ["strike"],
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
