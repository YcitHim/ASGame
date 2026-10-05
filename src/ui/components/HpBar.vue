<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    hp: number;
    maxHp: number;
    block?: number;
    height?: number;
    showLimit?: boolean;
    /** 格挡来源提示（如「蓄力架盾」）；缺省为「格挡 N」 */
    blockHint?: string;
  }>(),
  { block: 0, height: 14, showLimit: false },
);

const pct = computed(() => Math.max(0, Math.min(100, (props.hp / Math.max(1, props.maxHp)) * 100)));
/** 失控线已激活（HP 低于 50%）：此时填充退到中线左边，红色刻度反而清晰 */
const limitActive = computed(() => props.showLimit && props.hp * 2 < props.maxHp);
</script>

<template>
  <div class="hpbar" :style="{ height: height + 'px' }">
    <div v-if="block > 0" class="blockbadge" :title="blockHint || '格挡 ' + block">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(107,122,140,.35)" stroke="#8FA1B5" stroke-width="1.3">
        <path d="M12 3 L20 6 V12 C20 17 16.5 20 12 21.5 C7.5 20 4 17 4 12 V6 Z" />
      </svg>
      <span>{{ block }}</span>
    </div>
    <div class="hpfill" :style="{ width: pct + '%' }" />
    <div v-if="showLimit" class="limit-line" :class="{ active: limitActive }" />
    <div class="hptext" :class="{ 'align-left': showLimit }" :style="{ lineHeight: height + 'px' }">
      {{ hp }} / {{ maxHp }}
    </div>
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
/* 有失控线时血量数字靠左，给中线的「失控线」标签腾位（两者不再互相遮挡） */
.hptext.align-left {
  text-align: left;
  padding-left: 8px;
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
/* 刻度线用骨白，避免和红色填充同色（血量高时红线压红条 = 看不见） */
.limit-line {
  position: absolute;
  left: 50%;
  top: -4px;
  bottom: -4px;
  width: 2px;
  transform: translateX(-50%);
  background: rgba(232, 224, 208, 0.9);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.75), 0 0 4px rgba(0, 0, 0, 0.85);
}
/* 顶部小三角，指向阈值 */
.limit-line::before {
  content: "";
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid rgba(232, 224, 208, 0.95);
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.9));
}
/* 标签做暗底金框徽标：红底 / 暗底都能读 */
.limit-line::after {
  content: "失控线";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(6px, -50%);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--ink-bone);
  background: rgba(8, 6, 5, 0.86);
  border: 1px solid rgba(176, 141, 74, 0.6);
  border-radius: 2px;
  padding: 1px 4px;
  white-space: nowrap;
  text-shadow: 0 1px 2px #000;
}
/* 激活态才转血红并发光（此时填充已低于 50%，红线落在暗区） */
.limit-line.active {
  background: var(--blood-hi);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.75), 0 0 8px rgba(192, 57, 43, 0.85);
}
.limit-line.active::before {
  border-top-color: var(--blood-hi);
}
.limit-line.active::after {
  color: #ffd9d2;
  border-color: rgba(192, 57, 43, 0.85);
  background: rgba(40, 8, 6, 0.9);
}
</style>
