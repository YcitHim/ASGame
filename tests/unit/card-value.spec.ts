// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { netHpChange, netHpText } from "@/ui/card-value";
import CardView from "@/ui/components/CardView.vue";

/**
 * docs/41 §4.2：净值行只给「同一次出牌里先扣血、又立刻回血」的牌
 * ——那种牌会冒出「-2 然后 +6」两跳飘字，玩家以为出了 bug。
 * 延迟到账的回血（调血 → 回血印记）不在其列：代价与回血本来就隔一个回合，
 * 再标一行小字只是给卡面添噪音（甲方反馈：难看）。
 */
describe("docs/41 §4.2 牌面净值行", () => {
  it("调血（先付 5 血 / 下回合回 7）不标净值行", () => {
    expect(netHpChange("transfusion")).toBeNull();
    expect(netHpText("transfusion")).toBe("");
    expect(netHpChange("transfusion", true)).toBeNull();
    expect(netHpText("transfusion", true)).toBe("");
  });

  it("纯代价牌（bloodbolt：卖 2 打 9）没有净值行", () => {
    expect(netHpChange("bloodbolt")).toBeNull();
    expect(netHpText("bloodbolt")).toBe("");
  });

  it("不卖血的牌没有净值行", () => {
    expect(netHpChange("strike")).toBeNull();
    expect(netHpChange("defend")).toBeNull();
  });

  it("调血卡面不再渲染净值行（甲方反馈：难看）", () => {
    const wrapper = mount(CardView, {
      props: {
        cardId: "transfusion",
        cost: 1,
        keywords: ["bloodpact"],
        type: "skill",
        playable: true,
        selected: false,
        index: 0,
        handCount: 1,
      },
    });
    expect(wrapper.find(".cnet").exists()).toBe(false);
    expect(wrapper.text()).toContain("卖 5 血。下回合开始时回复 7 点 HP。");
    expect(wrapper.text()).not.toContain("净");
    wrapper.unmount();
  });
});
