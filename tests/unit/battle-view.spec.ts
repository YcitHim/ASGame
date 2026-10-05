// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import { nextTick } from "vue";
import BattleView from "@/ui/views/BattleView.vue";
import { useBattleStore } from "@/stores/battle";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

describe("BattleView 挂载冒烟（S3.7）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    void router.push("/");
  });

  it("挂载后渲染玩家/敌人/手牌/结束回合，不抛运行时错误", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();

    const text = wrapper.text();
    expect(text).toContain("血械侍僧");
    expect(text).toContain("结束回合");

    const store = useBattleStore();
    expect(store.battle).not.toBeNull();
    expect(wrapper.findAll(".card").length).toBe(store.battle!.piles.hand.length);
    expect(wrapper.findAll(".enemy").length).toBe(store.battle!.enemies.length);
    store.skip();
    wrapper.unmount();
  });

  it("拖拽卡牌到敌人身上 = 直接出牌", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();

    const store = useBattleStore();
    store.skip();

    const cards = wrapper.findAll(".card");
    expect(cards.length).toBeGreaterThan(0);
    const cardEl = cards[0].element as HTMLElement;
    const enemyEl = wrapper.findAll(".enemy")[0].element as HTMLElement;
    const enemyId = enemyEl.dataset.enemyId;

    const original = document.elementFromPoint;
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => enemyEl;
    try {
      cardEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 220, clientY: 60, bubbles: true }));
      await nextTick();

      // 幽灵卡必须 Teleport 到 body（脱离 .stage 的 transform 坐标空间），且坐标跟随指针
      const ghost = document.body.querySelector(".drag-ghost") as HTMLElement | null;
      expect(ghost).not.toBeNull();
      expect(ghost?.style.left).toBe("220px");
      expect(ghost?.style.top).toBe("60px");

      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 220, clientY: 60, bubbles: true }));
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint = original;
    }

    expect(enemyId).toBeTruthy();
    store.skip();
    expect(store.log.some((e) => e.type === "CardPlayed")).toBe(true);
    wrapper.unmount();
  });
});