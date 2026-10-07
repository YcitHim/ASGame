// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import IntentIcon from "@/ui/components/IntentIcon.vue";

/** docs/41 §3.3 · 意图区可读性（C2-P-1）；甲方 2026-10-07 手感修订后为「蓄力两段式」。 */
describe("1.0-C 意图图标可读性", () => {
  it("蓄力期只标「蓄力」：不预告剩余回合、也不报释放值；格挡量留给悬停提示", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "charge", value: 2, thenValue: 19, thenIn: 3, block: 4 } },
    });
    const text = wrapper.text();
    expect(text).toContain("蓄");
    expect(text).toContain("蓄力");
    expect(text).not.toContain("19"); // 释放值不剧透
    expect(text).not.toContain("回合后释放");
    expect(wrapper.find(".intent").classes()).toContain("charging");
    expect(wrapper.find(".intent").classes()).not.toContain("imminent"); // 蓄力期不提前泛红
    expect(wrapper.find(".intent").attributes("title")).toContain("4 点格挡");
    wrapper.unmount();
  });

  it("临近回合（thenIn = 1）也不破例：文案与高亮和平时完全一样", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "charge", value: 2, thenValue: 19, thenIn: 1 } },
    });
    expect(wrapper.find(".intent").classes()).not.toContain("imminent");
    expect(wrapper.text()).not.toContain("19");
    expect(wrapper.text()).not.toContain("下回合释放");
    expect(wrapper.text()).toContain("蓄力");
    wrapper.unmount();
  });

  it("多段攻击显示段数", () => {
    const wrapper = mount(IntentIcon, { props: { intent: { kind: "attack", value: 10, hits: 2 } } });
    expect(wrapper.text()).toContain("10×2");
    wrapper.unmount();
  });
});

/** docs/41 §3.3（反馈 11）：预警不消失，只是压到「出手那一帧」。
 *  文案用施动者视角「即将造成」——甲方验收：「承受」会把敌人的行动读成玩家的行动。
 *  甲方 2026-10-07 追加：这一帧要显式标明「蓄力重击」，让玩家认出这是大威力。 */
describe("docs/41 §3.3 蓄力重击预警", () => {
  it("释放段标明「蓄力重击」并写清伤害，带脉冲类", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "attack", value: 24, released: true } },
    });
    expect(wrapper.text()).toContain("蓄力重击");
    expect(wrapper.text()).toContain("即将造成 24 点伤害");
    expect(wrapper.find(".intent").classes()).toContain("incoming");
    // 非释放段的普通攻击不触发
    expect(wrapper.find(".intent").classes()).not.toContain("charging");
    wrapper.unmount();
  });

  it("多段释放写明段数", () => {
    const wrapper = mount(IntentIcon, {
      props: { intent: { kind: "attack", value: 12, hits: 2, released: true } },
    });
    expect(wrapper.text()).toContain("蓄力重击");
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
