// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import { nextTick } from "vue";
import type { DomainEvent } from "@/core/events";
import BattleView from "@/ui/views/BattleView.vue";
import { useBattleStore } from "@/stores/battle";
import { useRunStore } from "@/stores/run";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/battle", component: { template: "<div />" } },
  ],
});

/** jsdom 没有布局：给舞台一个真实矩形，落点判定（docs/51 §三）才有意义。 */
function stageRect(wrapper: ReturnType<typeof mount>, width = 1280, height = 720): void {
  const el = wrapper.find(".stage").element as HTMLElement;
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

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
    // 落点判定要靠舞台矩形（docs/51 §三）：jsdom 里给它一个真实矩形
    stageRect(wrapper);

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

  it("拖到非合法落点松手 = 取消，绝不替玩家出牌（docs/51 §三）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    const store = useBattleStore();
    store.skip();

    stageRect(wrapper);
    const cardEl = wrapper.findAll(".card")[0]!.element as HTMLElement;
    const original = document.elementFromPoint;
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
    try {
      cardEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
      // 舞台外（x > 1280）= 非合法落点
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 1500, clientY: 300, bubbles: true }));
      await nextTick();
      // 幽灵卡在非法落点上降为半透明
      const ghost = document.body.querySelector(".drag-ghost");
      expect(ghost?.classList.contains("illegal")).toBe(true);
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 1500, clientY: 300, bubbles: true }));
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint = original;
    }
    await nextTick();
    expect(store.log.some((e) => e.type === "CardPlayed")).toBe(false);
    store.skip();
    wrapper.unmount();
  });

  it("拖回手牌区松手 = 取消（手牌区高亮「松手取消」）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    const store = useBattleStore();
    store.skip();

    stageRect(wrapper);
    const zone = wrapper.find(".hand-zone").element as HTMLElement;
    zone.getBoundingClientRect = () =>
      ({ left: 0, top: 400, right: 800, bottom: 720, width: 800, height: 320, x: 0, y: 400, toJSON: () => ({}) }) as DOMRect;

    const cardEl = wrapper.findAll(".card")[0]!.element as HTMLElement;
    const original = document.elementFromPoint;
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
    try {
      cardEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 400, clientY: 500, bubbles: true }));
      await nextTick();
      expect(wrapper.find(".hand-zone").classes()).toContain("drop-cancel");
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 400, clientY: 500, bubbles: true }));
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint = original;
    }
    await nextTick();
    expect(store.log.some((e) => e.type === "CardPlayed")).toBe(false);
    store.skip();
    wrapper.unmount();
  });

  it("拖动中按 ESC = 取消出牌（不是打开设置）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    await router.push("/battle");
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    const store = useBattleStore();
    store.skip();

    const cardEl = wrapper.findAll(".card")[0]!.element as HTMLElement;
    cardEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 300, bubbles: true }));
    await nextTick();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 500, clientY: 300, bubbles: true }));
    await nextTick();
    expect(store.log.some((e) => e.type === "CardPlayed")).toBe(false);
    expect(router.currentRoute.value.path).toBe("/battle");
    store.skip();
    wrapper.unmount();
  });

  it("蓄力全程不泛红；红屏只压在释放那一帧（甲方 2026-10-07）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    const store = useBattleStore();
    store.skip();

    // 遭遇是随机掷的：先把其他敌人的意图清干净，红屏只可能来自被测的那一个
    for (const other of store.battle!.enemies.slice(1)) {
      (other as unknown as { intent: unknown }).intent = null;
    }
    const enemy = store.battle!.enemies[0]!;
    const patch = enemy as unknown as { intent: unknown };
    // 蓄力中——还剩 2 回合和「下回合就砸」都不亮：
    // 旧版这里会常亮全屏红，结果是蓄力时一直紧张、真打下来反而不亮（本末倒置）
    patch.intent = { kind: "charge", value: 4, block: 6, thenValue: 16, thenIn: 2 };
    await nextTick();
    expect(wrapper.find(".release-flash").exists()).toBe(false);
    patch.intent = { kind: "charge", value: 4, block: 6, thenValue: 16, thenIn: 1 };
    await nextTick();
    expect(wrapper.find(".release-flash").exists()).toBe(false);

    // 蓄力回合本身的 ChargeResolved（released:false）也不点亮
    store.onAnimEvent({
      type: "ChargeResolved",
      seq: 1,
      actionId: "t",
      enemyId: enemy.id,
      block: 6,
      released: false,
    } as DomainEvent);
    await nextTick();
    expect(wrapper.find(".release-flash").exists()).toBe(false);

    // 真正释放：ChargeResolved(released) → 红屏 + 报伤害
    store.onAnimEvent({
      type: "ChargeResolved",
      seq: 2,
      actionId: "t",
      enemyId: enemy.id,
      block: 0,
      released: true,
      value: 16,
    } as DomainEvent);
    await nextTick();
    expect(wrapper.find(".release-flash").exists()).toBe(true);
    expect(wrapper.find(".release-flash").text()).toContain("16");

    // 跳过动画要把红屏一并清掉，不留残影
    store.skip();
    await nextTick();
    expect(wrapper.find(".release-flash").exists()).toBe(false);

    wrapper.unmount();
  });

  it("Boss 台词 ×3：蓄力预警 / 二阶段横幅（docs/27 §五）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const run = useRunStore();
    run.startRun("bloodwright", 1);
    // 树状地图共 10 层，Boss 在 l9
    for (let i = 0; i < 9; i += 1) run.advance();
    expect(run.current?.kind).toBe("boss");

    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    const store = useBattleStore();
    expect(store.battle?.enemies[0].defId).toBe("rust_throat");

    // 蓄力预警台词跟着「释放」那一帧出（甲方：蓄力时不泛红也不抢戏，砸下来再喊）
    const boss = store.battle!.enemies[0] as unknown as { intent: unknown; hp: number };
    boss.intent = { kind: "charge", value: 4, thenIn: 1, block: 0 };
    await nextTick();
    expect(wrapper.text()).not.toContain("听，锈在喉咙里唱。");
    store.onAnimEvent({
      type: "ChargeResolved",
      seq: 1,
      actionId: "t",
      enemyId: store.battle!.enemies[0]!.id,
      block: 0,
      released: true,
      value: 16,
    } as DomainEvent);
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

  it("战斗中途能回主菜单：顶栏入口 → 确认 → 回标题，且保留远征进度（甲方验收）", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const run = useRunStore();
    run.startRun("bloodwright", 1);
    await router.push("/battle");
    const wrapper = mount(BattleView, { global: { plugins: [pinia, router] } });
    await nextTick();
    await nextTick();
    const battle = useBattleStore();
    battle.skip();

    // 顶栏必须有出口（原来战斗中没有任何回主菜单的路）
    const entry = wrapper.findAll(".topbar .r span").find((s) => s.text() === "主菜单");
    expect(entry, "顶栏缺少「主菜单」入口").toBeDefined();
    expect(wrapper.find(".menu-confirm").exists()).toBe(false);

    await entry!.trigger("click");
    await nextTick();
    expect(wrapper.find(".menu-confirm").exists()).toBe(true);

    // 取消：只关浮层，不动路由
    await wrapper.find(".menu-actions .ghost").trigger("click");
    await nextTick();
    expect(wrapper.find(".menu-confirm").exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe("/battle");

    // 确认：回标题，且这一局的进度还在（标题页能「继续远征」）
    await entry!.trigger("click");
    await nextTick();
    await wrapper.find(".menu-actions .etch-btn").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/");
    expect(run.active).toBe(true);
    wrapper.unmount();
  });
});
