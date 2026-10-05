import { createRouter, createWebHashHistory } from "vue-router";

/**
 * 界面导航流（docs/08 §3）：
 * 标题 → 地图 → 战斗 → 奖励 → 地图；标题 → 设置 / 图鉴占位。
 * 0.1 共 7 个界面，S1 先落标题与设置。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "title", component: () => import("./views/TitleView.vue") },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/map", name: "map", component: () => import("./views/MapView.vue") },
    { path: "/battle", name: "battle", component: () => import("./views/BattleView.vue") },
    { path: "/reward", name: "reward", component: () => import("./views/RewardView.vue") },
    { path: "/rest", name: "rest", component: () => import("./views/RestView.vue") },
    { path: "/forge", name: "forge", component: () => import("./views/ForgeView.vue") },
    { path: "/event", name: "event", component: () => import("./views/EventView.vue") },
    { path: "/codex", name: "codex", component: () => import("./views/CodexView.vue") },
    {
      path: "/expedition",
      name: "expedition",
      component: () => import("./views/ExpeditionPlaceholderView.vue"),
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
