// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useMetaStore } from "@/stores/meta";
import { useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";

/**
 * 甲方反馈：弹窗教学应该能在设置里关掉（并修"奖励页触发的提示跑到下一场战斗才弹"）。
 * 这里只覆盖开关本身；"谁触发在谁页面弹"由 App.vue 挂载保证。
 */
describe("首遇提示弹窗开关", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    useSettingsStore().init();
  });

  it("默认开：触发后进 current", () => {
    const tips = useTipsStore();
    tips.trigger("discard");
    expect(tips.current).toBe("discard");
  });

  it("设置关掉后：不弹，也不写已读（重新打开还能看到）", () => {
    useSettingsStore().update({ tipPopups: false });
    const tips = useTipsStore();
    tips.trigger("discard");
    expect(tips.current).toBeNull();
    expect(useMetaStore().hasSeenTip("discard")).toBe(false);
  });

  it("triggerUnlessTaught 在关掉时同样闭嘴", () => {
    useSettingsStore().update({ tipPopups: false });
    const tips = useTipsStore();
    tips.triggerUnlessTaught("reward_pick", false);
    expect(tips.current).toBeNull();
  });
});
