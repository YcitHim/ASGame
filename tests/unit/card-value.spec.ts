// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { netHpChange, netHpDelayed, netHpText } from "@/ui/card-value";
import CardView from "@/ui/components/CardView.vue";

/** docs/41 §4.2：卖血牌牌面要给出净值行，玩家才不会以为"先扣再回"是 bug。 */
describe("docs/41 §4.2 牌面净值行", () => {
  it("transfusion（调血：先付 5 血 / 下回合回 7）= 净 +2，且标注下回合到账", () => {
    expect(netHpChange("transfusion")).toBe(2);
    expect(netHpText("transfusion")).toBe("净 +2 HP（下回合）");
    expect(netHpDelayed("transfusion")).toBe(true);
    // 升级后自动重算（回 10 → 净 +5）
    expect(netHpChange("transfusion", true)).toBe(5);
    expect(netHpText("transfusion", true)).toBe("净 +5 HP（下回合）");
  });

  it("即时回血的牌不带「下回合」标注", () => {
    expect(netHpDelayed("transfusion")).toBe(true);
    // 造一个即时回血 + 血契的假卡来对照（数据里目前没有这种牌）
    expect(netHpDelayed("bloodbolt")).toBe(false);
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
    expect(withNet.text()).toContain("净 +2 HP（下回合）");
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
