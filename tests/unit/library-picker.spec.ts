// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import LibraryPicker from "@/ui/components/LibraryPicker.vue";
import type { CardInstance } from "@/core/combat";

/**
 * docs/58 §七.2 神眼选牌浮层。
 * 纯投影组件：给一批「牌库实例 id + 实例表」，渲染卡面网格并把点选结果抛出去。
 * 规则判定在 core（`pickFromDraw` / `traitEyeAvailable`），这里只验证展示与事件。
 */

function inst(instanceId: string, cardId: string): CardInstance {
  return { instanceId, cardId, upgraded: false, enhancements: [] };
}

const instances: Record<string, CardInstance> = {
  "strike#1": inst("strike#1", "strike"),
  "defend#1": inst("defend#1", "defend"),
};

describe("docs/58 §七.2 神眼·牌库选牌浮层", () => {
  it("按牌库实例渲染卡面，点选抛出 instanceId", async () => {
    const wrapper = mount(LibraryPicker, {
      props: { instanceIds: ["strike#1", "defend#1"], instances },
    });
    const slots = wrapper.findAll(".eye-slot");
    expect(slots).toHaveLength(2);
    expect(slots[0].text()).toContain("打击");

    await slots[1].trigger("click");
    expect(wrapper.emitted("pick")?.[0]).toEqual(["defend#1"]);
    wrapper.unmount();
  });

  it("牌库为空 → 显示空态，且没有可点的卡", () => {
    const wrapper = mount(LibraryPicker, { props: { instanceIds: [], instances } });
    expect(wrapper.findAll(".eye-slot")).toHaveLength(0);
    expect(wrapper.text()).toContain("牌库已空");
    wrapper.unmount();
  });

  it("点浮层背景 / 取消按钮 → 关闭事件", async () => {
    const wrapper = mount(LibraryPicker, {
      props: { instanceIds: ["strike#1"], instances },
    });
    await wrapper.find(".eye-actions button").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.find(".eye-overlay").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
    wrapper.unmount();
  });

  it("dismissable=false（祭血狂热「销毁」强制选择）：无取消按钮，点背景不关闭", async () => {
    const wrapper = mount(LibraryPicker, {
      props: { instanceIds: ["strike#1"], instances, dismissable: false, title: "销 毁 · 选 牌" },
    });
    expect(wrapper.text()).toContain("销 毁 · 选 牌");
    expect(wrapper.findAll(".eye-actions button")).toHaveLength(0);
    await wrapper.find(".eye-overlay").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
    wrapper.unmount();
  });
});
