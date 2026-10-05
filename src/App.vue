<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

// 启动即从存档恢复设置（ADR-008：设置持久化从第一天生效）
useSettingsStore().init();
</script>

<template>
  <router-view />
</template>
