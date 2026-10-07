// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CardView from "@/ui/components/CardView.vue";

/**
 * 卡面 flavor（docs/29 §一 ⑤）：缺 flavor 的卡不得渲染出原始 i18n key。
 * 背景：t(key, "") 在缺 key 时会回退成 key 本身 → 屏幕上出现 "card.sparkjab.flavor"。
 * （炉心 24 条 flavor 已补齐；仍无 flavor 的是 P4 副线卡与 onBlock 卡这批血械新卡。）
 */

function mountCard(cardId: string, enhancementIds: readonly string[] = []) {
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
      enhancementIds,
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

/**
 * docs/52 §二（玩家反馈：祭坛附魔后在卡上看不出附魔了什么）。
 * 数据一直都在 enhancementIds 里，缺的是渲染。
 */
describe("CardView 附魔可视", () => {
  it("无附魔时不渲染附魔行", () => {
    const wrapper = mountCard("strike");
    expect(wrapper.find(".cenh").exists()).toBe(false);
    wrapper.unmount();
  });

  it("有附魔时卡面出「附魔 · 名称」，多个用、相连", () => {
    const wrapper = mountCard("strike", ["empower", "thrifty_pact"]);
    expect(wrapper.find(".cenh").exists()).toBe(true);
    expect(wrapper.find(".cenh").text()).toContain("附魔 ·");
    expect(wrapper.find(".cenh").text()).toContain("、");
    wrapper.unmount();
  });

  it("圆点槽不再挂原生 title（信息改由卡面与注解窗承接）", async () => {
    const wrapper = mountCard("strike", ["empower"]);
    expect(wrapper.find(".enhslots").attributes("title")).toBeUndefined();
    // 悬停后注解窗里出现附魔条目，且标注为 enh 类（金色）
    await wrapper.find(".card").trigger("pointerenter");
    // 注解窗 Teleport 到 body，得从 document 里找
    const rows = document.body.querySelectorAll(".kw-row.enh");
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain("◆");
    wrapper.unmount();
  });
});
