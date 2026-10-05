<script setup lang="ts">
/**
 * 余烬粒子层。docs/08 §1：粒子上限极低，为氛围服务。
 * 位置固定（非随机），保证截图与真机表现一致。
 */
const EMBERS: { left: string; bottom: string; duration: string; delay: string }[] = [
  { left: "18%", bottom: "40px", duration: "9s", delay: "0s" },
  { left: "34%", bottom: "20px", duration: "12s", delay: "2s" },
  { left: "47%", bottom: "15px", duration: "11s", delay: "6s" },
  { left: "63%", bottom: "60px", duration: "10s", delay: "4s" },
  { left: "81%", bottom: "30px", duration: "13s", delay: "1s" },
];
</script>

<template>
  <div class="ember-field" aria-hidden="true">
    <span
      v-for="(e, i) in EMBERS"
      :key="i"
      class="ember"
      :style="{ left: e.left, bottom: e.bottom, animationDuration: e.duration, animationDelay: e.delay }"
    />
  </div>
</template>

<style scoped>
.ember-field {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
