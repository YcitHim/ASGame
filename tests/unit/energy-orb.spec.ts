// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EnergyOrb from "@/ui/components/EnergyOrb.vue";

/** 玩家反馈：充能悬浮里没有超载说明。悬停面板必须把「充能」与「过载」都讲清楚。 */

describe("EnergyOrb 充能悬浮说明", () => {
  it("充电面板含充能口径 + 过载反噬说明", () => {
    const wrapper = mount(EnergyOrb, {
      props: { energy: 3, maxEnergy: 3, charge: 4, bloodHp: 66, maxHp: 66 },
    });
    const pop = wrapper.find(".charge-pop");
    expect(pop.exists()).toBe(true);
    expect(pop.text()).toContain("充能");
    expect(pop.text()).toContain("+1");
    expect(pop.text()).toContain("过载");
    expect(pop.text()).toContain("5 点伤害");
    expect(pop.text()).toContain("清零");
    wrapper.unmount();
  });

  it("充能为 0 时仍显示入口（可学习机制）", () => {
    const wrapper = mount(EnergyOrb, {
      props: { energy: 3, maxEnergy: 3, charge: 0, bloodHp: 66, maxHp: 66 },
    });
    expect(wrapper.find(".charge").exists()).toBe(true);
    expect(wrapper.find(".charge").classes()).toContain("zero");
    wrapper.unmount();
  });
});
