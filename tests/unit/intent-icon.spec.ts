// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import IntentIcon from "@/ui/components/IntentIcon.vue";

/** docs/38 §三 C-2 · 意图区可读性（C2-P-1）。 */
describe("1.0-C 意图图标可读性", () => {
  it("蓄力中（thenIn ≥ 2）：显示剩余回合与释放值；格挡量在悬停提示里", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "charge", value: 2, thenValue: 19, thenIn: 3, block: 4 } },
    });
    const text = wrapper.text();
    expect(text).toContain("蓄");
    expect(text).toContain("3回合后释放 19");
    expect(wrapper.find(".intent").classes()).toContain("charging");
    expect(wrapper.find(".intent").attributes("title")).toContain("4 点格挡");
    wrapper.unmount();
  });

  it("临近（thenIn = 1）：改口「准备防御」并进入 imminent 高亮", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "charge", value: 2, thenValue: 19, thenIn: 1 } },
    });
    expect(wrapper.find(".intent").classes()).toContain("imminent");
    expect(wrapper.text()).toContain("下回合释放 19");
    expect(wrapper.text()).toContain("准备防御");
    wrapper.unmount();
  });

  it("多段攻击显示段数", () => {
    const wrapper = mount(IntentIcon, { props: { intent: { kind: "attack", value: 10, hits: 2 } } });
    expect(wrapper.text()).toContain("10×2");
    wrapper.unmount();
  });
});

/** docs/41 §3.3（反馈 11）：蓄力预警三段式，最关键的是释放段不再让预警凭空消失。
 *  文案用施动者视角「即将造成」——甲方验收：「承受」会把敌人的行动读成玩家的行动。 */
describe("docs/41 §3.3 蓄力三段式", () => {
  it("释放段显示「即将造成 X 点伤害」并加脉冲类", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "attack", value: 24, released: true } },
    });
    expect(wrapper.text()).toContain("即将造成 24 点伤害");
    expect(wrapper.find(".intent").classes()).toContain("incoming");
    // 非释放段的普通攻击不触发
    expect(wrapper.find(".intent").classes()).not.toContain("imminent");
    wrapper.unmount();
  });

  it("多段释放写明段数", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "attack", value: 12, hits: 2, released: true } },
    });
    expect(wrapper.text()).toContain("即将造成 12×2 点伤害");
    wrapper.unmount();
  });

  it("普通攻击不带 released 标记，不误报「即将造成」", () => {
    const wrapper = mount(IntentIcon, { props: { intent: { kind: "attack", value: 10 } } });
    expect(wrapper.text()).not.toContain("即将造成");
    expect(wrapper.find(".intent").classes()).not.toContain("incoming");
    wrapper.unmount();
  });
});

/** docs/41 §2.2（反馈 10）：debuff 意图不再一律显示「诅咒」。 */
describe("docs/41 §2.2 减益意图标签", () => {
  it("显示 payload 的实际减益名（锈喉是污染，不是诅咒）", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "debuff", buffId: "pollution", stacks: 22 } },
    });
    const text = wrapper.text();
    expect(text).toContain("污染");
    expect(text).not.toContain("诅咒");
    wrapper.unmount();
  });

  it("虚弱 / 蚀锈 各显示自己的名字", () => {
    const weak = mount(IntentIcon, { props: { intent: { kind: "debuff", buffId: "weak", stacks: 2 } } });
    expect(weak.text()).toContain("虚弱");
    weak.unmount();
    const corroding = mount(IntentIcon, { props: { intent: { kind: "debuff", buffId: "corroding", stacks: 3 } } });
    expect(corroding.text()).toContain("蚀锈");
    corroding.unmount();
  });

  it("payload 未带减益名时兜底「干扰」而非「诅咒」", () => {
    const wrapper = mount(IntentIcon, { props: { intent: { kind: "debuff" } } });
    expect(wrapper.text()).toContain("干扰");
    expect(wrapper.text()).not.toContain("诅咒");
    wrapper.unmount();
  });
});
