<script setup lang="ts">
import RotateMask from "@/ui/components/RotateMask.vue";
import { useSettingsStore } from "@/stores/settings";
import { useActTheme } from "@/ui/composables/useActTheme";

// 启动即从存档恢复设置（ADR-008：设置持久化从第一天生效）
useSettingsStore().init();
// 当前幕主题（docs/40 §四①）：act-1 赭红 / act-2 青蓝
useActTheme();
</script>

<template>
  <router-view />
  <!-- ADR-007 方案 A：锁横屏，竖屏遮罩 -->
  <RotateMask />
</template>
