<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import RotateMask from "@/ui/components/RotateMask.vue";
import FirstTip from "@/ui/components/FirstTip.vue";
import { useSettingsStore } from "@/stores/settings";
import { useActTheme } from "@/ui/composables/useActTheme";

// 启动即从存档恢复设置（ADR-008：设置持久化从第一天生效）
useSettingsStore().init();
// 当前幕主题（docs/40 §四①）：act-1 赭红 / act-2 青蓝
useActTheme();

/**
 * 首遇提示（docs/41 §4.1）挂在根上：**谁触发就在谁的页面上弹**。
 * 以前只在 BattleView 渲染，导致"奖励页触发的挑牌提示跑到下一场战斗才弹"（玩家反馈）。
 * 战斗页要避让手牌，其余页面贴底。
 */
const route = useRoute();
const tipOffset = computed(() => (route.path === "/battle" ? 226 : 28));
</script>

<template>
  <router-view />
  <FirstTip :offset="tipOffset" />
  <!-- ADR-007 方案 A：锁横屏，竖屏遮罩 -->
  <RotateMask />
</template>
