// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RelicCard from "@/ui/components/RelicCard.vue";
import { loadGameContent } from "@/data/load";

/**
 * 遗物卡面（甲方 2026-10-08「完善遗物系统」）：
 * 卡面必须把遗物的**结构信息**摆全——名称 / 分级 / 触发时机 / 次数；
 * 且不得泄露原始 i18n key（t(key, "") 缺 key 时会回退成 key 本身）。
 */
describe("RelicCard · 遗物卡面", () => {
  it("渲染名称、触发时机与次数 chip", () => {
    const wrapper = mount(RelicCard, { props: { relicId: "bloodrust" } });
    expect(wrapper.find(".rc-name").text()).not.toContain("relic.");
    expect(wrapper.find(".rc-meta").text()).toContain("触发");
    // 次数标签三选一必中
    const meta = wrapper.find(".rc-meta").text();
    expect(/整场一次|每回合一次|次次触发/.test(meta)).toBe(true);
    wrapper.unmount();
  });

  it("每件遗物都能渲染出非空名称，且不泄露 i18n key", () => {
    for (const id of loadGameContent().content.relics.keys()) {
      const wrapper = mount(RelicCard, { props: { relicId: id } });
      const name = wrapper.find(".rc-name").text();
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toContain("relic.");
      wrapper.unmount();
    }
  });

  it("tier 分级落到 class（身份件 = tier-0）", () => {
    const wrapper = mount(RelicCard, { props: { relicId: "bloodrust" } });
    const def = loadGameContent().content.relics.get("bloodrust");
    expect(wrapper.classes()).toContain(`tier-${def?.tier ?? 0}`);
    wrapper.unmount();
  });
});
