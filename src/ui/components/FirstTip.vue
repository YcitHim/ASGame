<script setup lang="ts">
import { computed } from "vue";
import { useTipsStore } from "@/stores/tips";
import { firstTip } from "@/ui/first-tips";

/** docs/41 §4.1：首次遇到机制时在屏幕下方浮一条说明，含「不再提示」。 */
const tips = useTipsStore();
const tip = computed(() => (tips.current ? firstTip(tips.current) : undefined));
</script>

<template>
  <div v-if="tip" class="first-tip">
    <div class="ft-main">
      <b class="ft-title">{{ tip.title }}</b>
      <p class="ft-body">{{ tip.body }}</p>
    </div>
    <button class="etch-btn ft-btn" @click="tips.dismiss()">知道了（不再提示）</button>
  </div>
</template>

<style scoped>
.first-tip {
  position: absolute;
  left: 50%;
  bottom: 226px;
  transform: translateX(-50%);
  z-index: 41;
  width: 640px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(12, 10, 8, 0.94);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-md);
  box-shadow: var(--panel-shadow);
  animation: first-tip-in 240ms ease-out;
}
.ft-main { flex: 1; text-align: left; }
.ft-title {
  display: block;
  font-family: var(--serif-title);
  font-size: 14px;
  letter-spacing: 0.24em;
  color: var(--gold);
  margin-bottom: 6px;
}
.ft-body {
  font-size: 12px;
  line-height: 1.7;
  letter-spacing: 0.06em;
  color: var(--ink-bone);
  white-space: pre-line;
}
.ft-btn { flex: none; padding: 8px 14px; font-size: 12px; }
@keyframes first-tip-in {
  0% { opacity: 0; transform: translate(-50%, 12px); }
  100% { opacity: 1; transform: translate(-50%, 0); }
}
</style>
