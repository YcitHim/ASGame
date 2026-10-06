// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import { nextTick } from "vue";
import BattleView from "@/ui/views/BattleView.vue";
import { useBattleStore } from "@/stores/battle";
import { useRunStore } from "@/stores/run";

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

  it("Boss 台词 ×3：蓄力预警 / 二阶段横幅（docs/27 §五）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const run = useRunStore();
    run.startRun("bloodwright", 1);
    for (let i = 0; i < 6; i += 1) run.advance();
    expect(run.current?.kind).toBe("boss");

    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    const store = useBattleStore();
    expect(store.battle?.enemies[0].defId).toBe("rust_throat");

    // 蓄力预警台词
    const boss = store.battle!.enemies[0] as unknown as { intent: unknown; hp: number };
    boss.intent = { kind: "charge", value: 4, thenIn: 1, block: 0 };
    await nextTick();
    expect(wrapper.text()).toContain("听，锈在喉咙里唱。");

    // 二阶段横幅台词（HP < 50%）
    boss.hp = 1;
    await nextTick();
    await nextTick();
    expect(wrapper.text()).toContain("第二段圣歌，献给你。");

    store.skip();
    wrapper.unmount();
  });

  it("玩家面板按职业显示名字；失控线只在血械侍僧出现（玩家报的 UI bug）", async () => {
    // 血械侍僧：显示名字 + 失控线刻度
    {
      const pinia = createPinia();
      setActivePinia(pinia);
      useRunStore().startRun("bloodwright", 1);
      const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
      await nextTick();
      await nextTick();
      expect(wrapper.find(".pp-name").text()).toContain("血械侍僧");
      expect(wrapper.find(".limit-line").exists()).toBe(true);
      useBattleStore().skip();
      wrapper.unmount();
    }
    // 炉心机士：显示炉心机士，且没有失控线
    {
      const pinia = createPinia();
      setActivePinia(pinia);
      useRunStore().startRun("engineer", 1);
      const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
      await nextTick();
      await nextTick();
      expect(wrapper.find(".pp-name").text()).toContain("炉心机士");
      expect(wrapper.find(".limit-line").exists()).toBe(false);
      useBattleStore().skip();
      wrapper.unmount();
    }
  });

  it("换职业开新局后不再复用陈旧战斗（玩家报：炉心机士却显示血械战斗）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const run = useRunStore();
    const battle = useBattleStore();
    // 先打一场血械战斗（停留在战斗中，未结算）
    run.startRun("bloodwright", 1);
    battle.start();
    expect(battle.battle).not.toBeNull();
    const before = Object.values(battle.battle!.cardInstances).map((i) => i.cardId);
    expect(before).toContain("strike");

    // 直接换职业开新局，再进战斗：必须重建为炉心机士的卡组
    run.startRun("engineer", 2);
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    expect(wrapper.find(".pp-name").text()).toContain("炉心机士");
    const after = Object.values(battle.battle!.cardInstances).map((i) => i.cardId);
    expect(after).toContain("pistonjab");
    expect(after).not.toContain("strike");
    battle.skip();
    wrapper.unmount();
  });
});
