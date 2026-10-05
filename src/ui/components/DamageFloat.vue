<script setup lang="ts">
import type { Floater } from "@/stores/battle";

defineProps<{ floater: Floater }>();
</script>

<template>
  <div class="dmgfloat" :class="[floater.kind, { big: floater.big }]">
    {{ floater.kind === "heal" ? "+" : "" }}{{ floater.value }}
  </div>
</template>

<style scoped>
.dmgfloat {
  position: absolute; top: 46px; left: 50%;
  font-family: var(--serif-num); font-size: 34px; color: var(--ink-bone);
  text-shadow: 0 0 12px rgba(192, 57, 43, 0.9), 0 2px 2px #000;
  pointer-events: none; z-index: 6;
  animation: dmg-pop 0.9s ease-out forwards;
}
.dmgfloat.big { font-size: 48px; color: #f0b4a8; }
.dmgfloat.heal { color: #a8c48e; text-shadow: 0 0 12px rgba(94, 123, 76, 0.9), 0 2px 2px #000; }
@keyframes dmg-pop {
  0% { opacity: 0; transform: translate(-50%, 10px) scale(0.6); }
  18% { opacity: 1; transform: translate(-50%, 0) scale(1.25); }
  34% { transform: translate(-50%, -4px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -40px); }
}
</style>
