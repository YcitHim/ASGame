// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CardView from "@/ui/components/CardView.vue";

/**
 * 卡面 flavor（docs/29 §一 ⑤）：缺 flavor 的卡不得渲染出原始 i18n key。
 * 背景：t(key, "") 在缺 key 时会回退成 key 本身 → 屏幕上出现 "card.sparkjab.flavor"。
 * （炉心 24 条 flavor 已补齐；仍无 flavor 的是 P4 副线卡与 onBlock 卡这批血械新卡。）
 */

function mountCard(cardId: string) {
  return mount(CardView, {
    props: {
      cardId,
      cost: 1,
      keywords: [],
      type: "attack",
      playable: true,
      selected: false,
      index: 0,
      handCount: 1,
      display: true,
    },
  });
}

describe("CardView flavor 位", () => {
  it("有 flavor 的卡正常显示", () => {
    const wrapper = mountCard("strike");
    expect(wrapper.find(".cflavor").exists()).toBe(true);
    expect(wrapper.find(".cflavor").text()).toBe("铁会记住每一次落下。");
    wrapper.unmount();
  });

  it("缺 flavor 的卡不显示、也不泄露 i18n key", () => {
    const wrapper = mountCard("sparkjab");
    expect(wrapper.find(".cflavor").exists()).toBe(false);
    expect(wrapper.text()).not.toContain(".flavor");
    wrapper.unmount();
  });

  it("炉心机士卡 flavor 已补齐并正常显示", () => {
    const wrapper = mountCard("pistonjab");
    expect(wrapper.find(".cflavor").text()).toBe("一推一收，像心跳，只是更响。");
    wrapper.unmount();
  });
});
