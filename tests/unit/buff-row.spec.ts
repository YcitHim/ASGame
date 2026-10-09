// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { BuffInstance } from "@/core/buffs";
import BuffRow from "@/ui/components/BuffRow.vue";
import { BUFF_TIP_WIDTH, computeBuffTipPlacement } from "@/ui/tip-position";

const strength: BuffInstance = { id: "strength", stacks: 2, duration: null };

describe("BuffRow 状态角标", () => {
  it("显示状态名与数值角标", () => {
    const w = mount(BuffRow, { props: { buffs: [strength] } });
    expect(w.text()).toContain("力量");
    expect(w.find(".val").text()).toBe("2");
  });

  it("悬停弹出提示框（Teleport 到 body）：含数值与 glossary 同源说明", async () => {
    const w = mount(BuffRow, { props: { buffs: [strength] }, attachTo: document.body });
    await w.find(".buff").trigger("mouseenter");
    const tip = document.body.querySelector(".buff-tip");
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toContain("力量");
    expect(tip?.textContent).toContain("2 层");
    expect(tip?.textContent).toContain("+1");

    await w.find(".buff").trigger("mouseleave");
    expect(document.body.querySelector(".buff-tip")).toBeNull();
    w.unmount();
  });

  // 甲方 2026-10-09 状态双轴：灼烧/荆棘/坚韧一个图标同时说明「多少层」与「还剩几回合」
  it("双轴状态：主角标给层数，图标右下角另挂剩余回合小角标", () => {
    const burn: BuffInstance = { id: "burn", stacks: 3, duration: 2 };
    const w = mount(BuffRow, { props: { buffs: [burn] } });
    expect(w.find(".val").text()).toBe("3");
    expect(w.find(".tile .turns").text()).toBe("2");
  });

  it("纯计时型不重复挂回合角标（主角标本身就是剩余回合）", () => {
    const chill: BuffInstance = { id: "chill", stacks: 1, duration: 2 };
    const w = mount(BuffRow, { props: { buffs: [chill] } });
    expect(w.find(".val").text()).toBe("2");
    expect(w.find(".turns").exists()).toBe(false);
  });
});

describe("computeBuffTipPlacement", () => {
  it("默认显示在角标上方并水平居中（left 是中心，样式里 translate(-50%)）", () => {
    const p = computeBuffTipPlacement({ left: 500, top: 400, width: 80, height: 30 }, 1280, 720);
    expect(p.above).toBe(true);
    expect(p.left).toBe(500 + 40);
  });

  it("顶部放不下时翻到角标下方", () => {
    const p = computeBuffTipPlacement({ left: 500, top: 20, width: 80, height: 30 }, 1280, 720);
    expect(p.above).toBe(false);
    expect(p.top).toBeGreaterThan(20);
  });

  it("贴近右边缘时按半宽夹进视口", () => {
    const p = computeBuffTipPlacement({ left: 1270, top: 400, width: 20, height: 30 }, 1280, 720);
    expect(p.left + BUFF_TIP_WIDTH / 2).toBeLessThanOrEqual(1272);
  });

  it("贴近左边缘时不会把提示框推出屏幕（实机：文字被切掉一半）", () => {
    const p = computeBuffTipPlacement({ left: 60, top: 400, width: 90, height: 34 }, 1280, 720);
    expect(p.left - BUFF_TIP_WIDTH / 2).toBeGreaterThanOrEqual(8);
  });
});
