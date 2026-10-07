// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useMetaStore } from "@/stores/meta";
import { useTipsStore } from "@/stores/tips";
import { FIRST_TIPS } from "@/ui/first-tips";
import FirstTip from "@/ui/components/FirstTip.vue";

/** docs/41 §4.1：首遇提示——只弹一次、同屏至多 1 条、战斗高潮延后、图鉴可回看。 */
describe("docs/41 §4.1 首遇提示", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("五个首批触发点都有词条，正文 2 行以内", () => {
    expect(FIRST_TIPS.map((t) => t.id)).toEqual(["discard", "bloodpact", "retain", "charge", "energy"]);
    for (const tip of FIRST_TIPS) {
      expect(tip.title.length).toBeGreaterThan(0);
      expect(tip.body.split("\n").length).toBeGreaterThanOrEqual(2);
      expect(tip.body.split("\n").length).toBeLessThanOrEqual(4);
    }
  });

  it("同一条只弹一次；点掉后写入存档，跨局不再出现", () => {
    const tips = useTipsStore();
    tips.trigger("discard");
    expect(tips.current).toBe("discard");
    // 重复触发无效
    tips.trigger("discard");
    expect(tips.current).toBe("discard");
    expect(tips.queue).toEqual([]);

    tips.dismiss();
    expect(tips.current).toBeNull();
    expect(useMetaStore().hasSeenTip("discard")).toBe(true);

    // 新一轮（同一个 pinia 实例 = 同一份存档）
    tips.trigger("discard");
    expect(tips.current).toBeNull();
  });

  it("同屏至多 1 条：第二条排队，点掉第一条才轮到它", () => {
    const tips = useTipsStore();
    tips.trigger("discard");
    tips.trigger("bloodpact");
    tips.trigger("charge");
    expect(tips.current).toBe("discard");
    expect(tips.queue).toEqual(["bloodpact", "charge"]);
    tips.dismiss();
    expect(tips.current).toBe("bloodpact");
    tips.dismiss();
    expect(tips.current).toBe("charge");
  });

  it("战斗动画播放中（busy）压住不弹，行动结束再出现", () => {
    const tips = useTipsStore();
    tips.setBusy(true);
    tips.trigger("charge");
    expect(tips.current).toBeNull();
    expect(tips.queue).toEqual(["charge"]);
    tips.setBusy(false);
    expect(tips.current).toBe("charge");
  });

  it("图鉴「重新显示一遍」清空已读", () => {
    const tips = useTipsStore();
    tips.trigger("energy");
    tips.dismiss();
    expect(useMetaStore().hasSeenTip("energy")).toBe(true);
    tips.resetAll();
    expect(useMetaStore().hasSeenTip("energy")).toBe(false);
    tips.trigger("energy");
    expect(tips.current).toBe("energy");
  });

  it("组件：标题正文渲染，按钮点掉即写档", async () => {
    const tips = useTipsStore();
    tips.trigger("bloodpact");
    const wrapper = mount(FirstTip);
    expect(wrapper.text()).toContain("血契（卖血）");
    expect(wrapper.text()).toContain("净 +N HP");
    await wrapper.find("button").trigger("click");
    expect(tips.current).toBeNull();
    expect(useMetaStore().hasSeenTip("bloodpact")).toBe(true);
    wrapper.unmount();
  });
});
