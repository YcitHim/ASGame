<script setup lang="ts">
import { computed } from "vue";
import { POLLUTION_CRITICAL } from "@/core/combat";

const props = defineProps<{ value: number }>();
// 临界线与 core 同一份常量（此前这里硬编码 80，两份必然漂移）
const critical = computed(() => props.value >= POLLUTION_CRITICAL);
const color = computed(() => (critical.value ? "#C0392B" : "var(--rot)"));
// 超级大畸变下污染可超 100：数字照实显示，但渐变角度必须 clamp，
// 否则 CSS 百分比 stop 超过 100% 渐变直接画错
const pct = computed(() => Math.min(100, Math.max(0, props.value)));
</script>

<template>
  <div class="gauge-wrap">
    <div
      class="gauge"
      :class="{ critical }"
      :style="{ background: `conic-gradient(${color} 0 ${pct}%, rgba(94,123,76,.14) ${pct}% 100%)` }"
    >
      <div class="gv"><b :style="{ color: critical ? '#F0B4A8' : '#A8C48E' }">{{ value }}</b><span>污 染</span></div>
    </div>
    <div class="gauge-label">{{ critical ? "临界 — 每回合反噬" : `临界 ${POLLUTION_CRITICAL} — 安全` }}</div>
  </div>
</template>

<style scoped>
.gauge-wrap {
  width: 150px;
  text-align: center;
}
.gauge {
  width: 92px;
  height: 92px;
  margin: 0 auto;
  border-radius: 50%;
  position: relative;
  box-shadow: 0 0 18px rgba(94, 123, 76, 0.25);
}
.gauge.critical {
  animation: breath 1.2s ease-in-out infinite;
}
@keyframes breath {
  0%, 100% { box-shadow: 0 0 14px rgba(192, 57, 43, 0.35); }
  50% { box-shadow: 0 0 26px rgba(192, 57, 43, 0.75); }
}
.gauge::before {
  content: "";
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: var(--bg-panel);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.8);
}
.gv {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.gv b {
  font-family: var(--serif-num);
  font-size: 21px;
  font-weight: 600;
}
.gv span {
  font-size: 9px;
  letter-spacing: 0.3em;
  color: var(--ink-dim);
  margin-top: 2px;
}
.gauge-label {
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-dim);
  margin-top: 6px;
}
</style>
