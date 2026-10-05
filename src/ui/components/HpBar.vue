<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ hp: number; maxHp: number; block?: number; height?: number; showLimit?: boolean }>(),
  { block: 0, height: 14, showLimit: false },
);

const pct = computed(() => Math.max(0, Math.min(100, (props.hp / Math.max(1, props.maxHp)) * 100)));
</script>

<template>
  <div class="hpbar" :style="{ height: height + 'px' }">
    <div v-if="block > 0" class="blockbadge" :title="'格挡 ' + block">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(107,122,140,.35)" stroke="#8FA1B5" stroke-width="1.3">
        <path d="M12 3 L20 6 V12 C20 17 16.5 20 12 21.5 C7.5 20 4 17 4 12 V6 Z" />
      </svg>
      <span>{{ block }}</span>
    </div>
    <div class="hpfill" :style="{ width: pct + '%' }" />
    <div v-if="showLimit" class="limit-line" />
    <div class="hptext" :style="{ lineHeight: height + 'px' }">{{ hp }} / {{ maxHp }}</div>
  </div>
</template>

<style scoped>
.hpbar {
  position: relative;
  background: #0a0806;
  border: 1px solid rgba(176, 141, 74, 0.45);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7);
}
.hpfill {
  height: 100%;
  background: linear-gradient(180deg, #a33724, #6e1f12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition: width var(--dur-hit) ease-out;
}
.hptext {
  position: absolute;
  inset: 0;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ink-bone);
  text-shadow: 0 1px 2px #000;
}
.blockbadge {
  position: absolute;
  left: -30px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.blockbadge span {
  position: absolute;
  font-size: 11px;
  color: #e8e0d0;
}
.limit-line {
  position: absolute;
  left: 50%;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--blood-hi);
  opacity: 0.9;
}
.limit-line::after {
  content: "失控线";
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--blood-hi);
  white-space: nowrap;
}
</style>
