// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import IntentIcon from "@/ui/components/IntentIcon.vue";

/** docs/38 §三 C-2 · 意图区可读性（C2-P-1）。 */
describe("1.0-C 意图图标可读性", () => {
  it("蓄力意图显示释放值、格挡与剩余回合", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "charge", value: 2, thenValue: 19, thenIn: 3, block: 4 } },
    });
    const text = wrapper.text();
    expect(text).toContain("蓄");
    expect(text).toContain("释放 19");
    expect(text).toContain("+4挡");
    expect(text).toContain("3回合");
    wrapper.unmount();
  });

  it("下回合释放时进入 imminent 高亮", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "charge", value: 2, thenValue: 19, thenIn: 1 } },
    });
    expect(wrapper.find(".intent").classes()).toContain("imminent");
    wrapper.unmount();
  });

  it("多段攻击显示段数", () => {
    const wrapper = mount(IntentIcon, { props: { intent: { kind: "attack", value: 10, hits: 2 } } });
    expect(wrapper.text()).toContain("10×2");
    wrapper.unmount();
  });
});
