<script setup lang="ts">
import { computed } from "vue";
import type { Floater } from "@/stores/battle";

const props = defineProps<{ floater: Floater }>();

/** docs/41 §3.2：红色 −N / 绿色 +N / 蓝色 挡N / 「格挡！」/ 减益浮名 */
const text = computed(() => {
  const f = props.floater;
  if (f.text) return f.text;
  if (f.kind === "heal") return `+${f.value}`;
  if (f.kind === "block") return `挡${f.value}`;
  return `−${f.value}`;
});
</script>

<template>
  <div class="dmgfloat" :class="[floater.kind, { big: floater.big }]">{{ text }}</div>
</template>

<style scoped>
.dmgfloat {
  position: absolute; top: 46px; left: 50%;
  font-family: var(--serif-num); font-size: 34px; color: var(--blood-hi);
  text-shadow: 0 0 12px rgba(192, 57, 43, 0.9), 0 2px 2px #000;
  pointer-events: none; z-index: 6; white-space: nowrap;
  animation: dmg-pop 0.9s ease-out forwards;
}
.dmgfloat.big { font-size: 48px; color: #f0b4a8; }
.dmgfloat.heal { color: #a8c48e; text-shadow: 0 0 12px rgba(94, 123, 76, 0.9), 0 2px 2px #000; }
/* 被格挡的部分：蓝色，字号小一档，并右移一格——它与真实掉血同帧产生，不能叠在一起 */
.dmgfloat.block {
  left: 64%;
  color: #8fb6d8; text-shadow: 0 0 12px rgba(107, 122, 140, 0.9), 0 2px 2px #000; font-size: 26px;
}
/* 完全格挡：不报伤害，只报"挡住了"，避免玩家以为挨了打 */
.dmgfloat.guard { color: #8fb6d8; font-size: 24px; letter-spacing: 0.12em; }
/* 减益浮名：紫色 + 小字，浮在状态栏位置 */
.dmgfloat.debuff {
  top: 30px; font-size: 20px; color: #c2a4e0; letter-spacing: 0.1em;
  text-shadow: 0 0 12px rgba(91, 58, 122, 0.9), 0 2px 2px #000;
}
@keyframes dmg-pop {
  0% { opacity: 0; transform: translate(-50%, 10px) scale(0.6); }
  18% { opacity: 1; transform: translate(-50%, 0) scale(1.25); }
  34% { transform: translate(-50%, -4px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -40px); }
}
</style>
