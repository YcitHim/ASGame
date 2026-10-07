// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { netHpChange, netHpText } from "@/ui/card-value";
import CardView from "@/ui/components/CardView.vue";

/** docs/41 §4.2：卖血牌牌面要给出净值行，玩家才不会以为"先扣再回"是 bug。 */
describe("docs/41 §4.2 牌面净值行", () => {
  it("transfusion（血契 2 / 回 6）= 净 +4，升级后自动重算", () => {
    expect(netHpChange("transfusion")).toBe(4);
    expect(netHpText("transfusion")).toBe("净 +4 HP");
    expect(netHpChange("transfusion", true)).toBe(7);
    expect(netHpText("transfusion", true)).toBe("净 +7 HP");
  });

  it("纯代价牌（bloodbolt：卖 2 打 9）没有净值行", () => {
    expect(netHpChange("bloodbolt")).toBeNull();
    expect(netHpText("bloodbolt")).toBe("");
  });

  it("不卖血的牌没有净值行", () => {
    expect(netHpChange("strike")).toBeNull();
    expect(netHpChange("defend")).toBeNull();
  });

  it("CardView 渲染净值行，未持有净值的牌不渲染", () => {
    const withNet = mount(CardView, {
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
    expect(withNet.text()).toContain("净 +4 HP");
    withNet.unmount();

    const withoutNet = mount(CardView, {
      props: {
        cardId: "bloodbolt",
        cost: 1,
        keywords: ["bloodpact"],
        type: "attack",
        playable: true,
        selected: false,
        index: 0,
        handCount: 1,
      },
    });
    expect(withoutNet.find(".cnet").exists()).toBe(false);
    withoutNet.unmount();
  });
});
