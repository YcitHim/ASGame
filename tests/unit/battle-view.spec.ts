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
});
