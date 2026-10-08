// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CardUpgradeDialog from "@/ui/components/CardUpgradeDialog.vue";

/** 升级对照浮层（甲方 2026-10-08）：幕间默记祷文不再只列卡名，点开看升级面。 */
describe("CardUpgradeDialog · 原版 vs 升级后", () => {
  it("并排显示两面，点「升级这张」抛 confirm", async () => {
    const wrapper = mount(CardUpgradeDialog, { props: { cardId: "strike" } });
    expect(wrapper.text()).toContain("原版");
    expect(wrapper.text()).toContain("升级后");
    const buttons = wrapper.findAll(".up-actions .etch-btn");
    expect(buttons).toHaveLength(2);
    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
    wrapper.unmount();
  });

  it("取消 / 点背景 → cancel", async () => {
    const wrapper = mount(CardUpgradeDialog, { props: { cardId: "strike" } });
    await wrapper.find(".up-actions .etch-btn").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    await wrapper.find(".up-dialog").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(2);
    wrapper.unmount();
  });
});
