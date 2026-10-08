// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import LeaderboardModal from "@/ui/components/LeaderboardModal.vue";
import { useMetaStore } from "@/stores/meta";
import { loadGameContent } from "@/data/load";

/**
 * 远征榜弹窗（甲方 2026-10-08「排行榜做成按钮点开显示」）：
 *  - 每职业 × 特性分档各一行（无特性单独一档）；
 *  - 列头是「最少回合 / 最高余血 / 完成日期」——**日期取代了旧用时列**；
 *  - 未通关职业显示为暗牌，不泄露职业名。
 */

function setup() {
  window.localStorage.clear();
  setActivePinia(createPinia());
  const meta = useMetaStore();
  meta.ensureLoaded();
  return meta;
}

beforeEach(() => {
  setup();
});

describe("LeaderboardModal · 远征榜", () => {
  it("赛季列头是回合 / 余血 / 日期，没有「完成用时」", () => {
    const meta = setup();
    meta.markCleared("engineer");
    meta.updateRecord("engineer", 20, 30, "normal", "2026-10-01", "");
    const wrapper = mount(LeaderboardModal);
    const head = wrapper.find(".lb-row-head");
    expect(head.exists()).toBe(true);
    const text = head.text();
    expect(text).toContain("最少回合");
    expect(text).toContain("最高余血");
    expect(text).toContain("完成日期");
    expect(wrapper.text()).not.toContain("完成用时");
    wrapper.unmount();
  });

  it("同一职业的不同特性各占一行（含无特性档），日期逐行显示", () => {
    const meta = setup();
    meta.markCleared("engineer");
    meta.updateRecord("engineer", 20, 30, "normal", "2026-10-01", "ironhide_turtle");
    meta.updateRecord("engineer", 35, 10, "normal", "2026-10-02", "glass_cannon");
    meta.updateRecord("engineer", 28, 22, "normal", "2026-10-03", "");
    const wrapper = mount(LeaderboardModal);
    const rows = wrapper.findAll(".lb-row:not(.lb-row-head)");
    // 三档各一行
    expect(rows.length).toBe(3);
    const text = wrapper.text();
    expect(text).toContain("无特性");
    expect(text).toContain("2026-10-01");
    expect(text).toContain("2026-10-02");
    expect(text).toContain("2026-10-03");
    wrapper.unmount();
  });

  it("未通关职业显示为暗牌、不泄露职业名", () => {
    setup();
    const wrapper = mount(LeaderboardModal);
    // 至少有一个未通关职业 → 暗牌存在
    expect(wrapper.findAll(".lb-board.locked").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("？？？");
    wrapper.unmount();
  });

  it("切换到锈蚀档：只显示锈蚀榜的成绩", () => {
    const meta = setup();
    meta.markCleared("bloodwright");
    meta.updateRecord("bloodwright", 20, 30, "normal", "2026-10-01", "");
    meta.updateRecord("bloodwright", 33, 12, "rust", "2026-10-05", "");
    const wrapper = mount(LeaderboardModal, { props: { diff: "rust" } });
    const text = wrapper.text();
    expect(text).toContain("2026-10-05");
    expect(text).not.toContain("2026-10-01");
    wrapper.unmount();
  });

  it("每个职业都有一张榜牌（三职业）", () => {
    setup();
    const wrapper = mount(LeaderboardModal);
    const classCount = [...loadGameContent().content.classes.keys()].length;
    expect(wrapper.findAll(".lb-board").length).toBe(classCount);
    wrapper.unmount();
  });
});
