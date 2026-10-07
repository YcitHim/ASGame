import { createRouter, createWebHashHistory } from "vue-router";

/**
 * 界面导航流（docs/08 §3）：
 * 标题 → 职业选择 → 地图 →（战斗 / 奖励 / 休息 / 祭坛 / 事件）→ 地图；标题 → 设置 / 图鉴。
 * 0.5 共 10 个界面，分支地图由 MapView 承担。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "title", component: () => import("./views/TitleView.vue") },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/class-select", name: "class-select", component: () => import("./views/ClassSelectView.vue") },
    { path: "/trait-select", name: "trait-select", component: () => import("./views/TraitSelectView.vue") },
    { path: "/map", name: "map", component: () => import("./views/MapView.vue") },
    { path: "/battle", name: "battle", component: () => import("./views/BattleView.vue") },
    { path: "/reward", name: "reward", component: () => import("./views/RewardView.vue") },
    { path: "/rest", name: "rest", component: () => import("./views/RestView.vue") },
    { path: "/forge", name: "forge", component: () => import("./views/ForgeView.vue") },
    { path: "/event", name: "event", component: () => import("./views/EventView.vue") },
    { path: "/intermission", name: "intermission", component: () => import("./views/IntermissionView.vue") },
    { path: "/tutorial", name: "tutorial", component: () => import("./views/TutorialView.vue") },
    { path: "/codex", name: "codex", component: () => import("./views/CodexView.vue") },
  { path: "/deck", name: "deck", component: () => import("./views/DeckView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
