// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import { nextTick } from "vue";
import ForgeView from "@/ui/views/ForgeView.vue";
import { useRunStore } from "@/stores/run";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

describe("ForgeView 挂载冒烟（S4.4）", () => {
  it("渲染三选一与卡组；选中强化后目标卡可附着", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const run = useRunStore();
    run.startRun(1);

    const wrapper = mount(ForgeView, { global: { plugins: [pinia, router] } });
    await nextTick();

    expect(wrapper.findAll(".offer")).toHaveLength(3);
    expect(wrapper.findAll(".deck-card")).toHaveLength(run.deckSize);

    await wrapper.findAll(".offer")[0].trigger("click");
    await nextTick();
    expect(wrapper.findAll(".deck-card.targetable").length).toBeGreaterThan(0);
    wrapper.unmount();
  });
});
