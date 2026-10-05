<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * ADR-007 方案 A：锁定横屏。
 * 竖屏（且屏幕较小，排除桌面窄窗口）时遮罩提示横置设备。
 */
const portrait = ref(false);

function update(): void {
  const isPortrait = window.innerHeight > window.innerWidth;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) <= 900;
  portrait.value = isPortrait && smallScreen;
}

onMounted(() => {
  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", update);
  window.removeEventListener("orientationchange", update);
});
</script>

<template>
  <div v-if="portrait" class="rotate-mask">
    <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#B08D4A" stroke-width="1.3" stroke-linecap="round">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M4 8 A6 6 0 0 1 8 4 M4 8 H7 M4 8 V5" />
    </svg>
    <p>请 横 置 设 备</p>
    <small>本作为横屏体验设计</small>
  </div>
</template>

<style scoped>
.rotate-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: var(--bg-abyss);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--ink-bone);
  font-family: var(--serif-title);
}
.rotate-mask p {
  font-size: 20px;
  letter-spacing: 0.5em;
  color: var(--gold);
}
.rotate-mask small {
  font-family: var(--serif-body);
  font-size: 11px;
  letter-spacing: 0.3em;
  color: var(--ink-dim);
}
</style>
