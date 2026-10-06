<script setup lang="ts">
defineProps<{ energy: number; maxEnergy: number; charge: number; bloodHp: number; maxHp: number }>();
</script>

<template>
  <div class="energy">
    <div class="orb" :title="`能量 ${energy}/${maxEnergy}`">{{ energy }}<small>/{{ maxEnergy }}</small></div>
    <div class="pact">血契 {{ bloodHp }}/{{ maxHp }}</div>
    <!-- 充能悬浮说明（docs/29 炉心）：悬停/聚焦显示「充能」与「过载」口径 -->
    <div class="charge-chip" :class="{ zero: charge <= 0 }" tabindex="0">
      <span class="charge-value">充能 +{{ charge }}</span>
      <span class="charge-pop" role="tooltip">
        <b>充能 · {{ charge }} / 10</b>
        <em>每点使你所有攻击的各段伤害 +1。</em>
        <em class="warn">超过 10 触发过载：立即受 5 点伤害并清零。</em>
      </span>
    </div>
  </div>
</template>

<style scoped>
.energy { text-align: center; }
.orb {
  width: 64px; height: 64px; border-radius: 50%; position: relative;
  background: radial-gradient(circle at 36% 30%, #4a3a1e, #171208 68%);
  border: 1px solid var(--gold);
  box-shadow: 0 0 16px rgba(176, 141, 74, 0.35), inset 0 0 12px #000;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--serif-num); font-size: 22px; color: var(--gold);
}
.orb small { font-size: 11px; color: var(--ink-dim); }
.pact { margin-top: 8px; font-size: 10px; color: #e0705a; letter-spacing: 0.1em; }
.charge-chip {
  position: relative;
  margin-top: 5px;
  display: inline-block;
  font-size: 10px;
  color: #8fa1b5;
  letter-spacing: 0.1em;
  cursor: help;
  outline: none;
}
.charge-chip.zero { color: rgba(143, 161, 181, 0.45); }
.charge-chip:hover .charge-value,
.charge-chip:focus-visible .charge-value { color: #cfe0f0; }
.charge-pop {
  display: none;
  position: absolute;
  /* 贴着充能入口左缘向右展开：入口在屏幕左下角，居中会溢出视口左边界 */
  left: 0;
  bottom: calc(100% + 8px);
  width: 250px;
  padding: 9px 11px;
  text-align: left;
  font-size: 10.5px;
  line-height: 1.6;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  background: linear-gradient(180deg, #1d1811, #100c07);
  border: 1px solid rgba(176, 141, 74, 0.65);
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 10px 26px rgba(0, 0, 0, 0.75);
  z-index: 120;
  pointer-events: none;
}
.charge-pop::after {
  content: "";
  position: absolute;
  left: 24px;
  bottom: -6px;
  width: 10px; height: 10px;
  transform: rotate(45deg);
  background: #100c07;
  border-right: 1px solid rgba(176, 141, 74, 0.65);
  border-bottom: 1px solid rgba(176, 141, 74, 0.65);
}
.charge-chip:hover .charge-pop,
.charge-chip:focus-visible .charge-pop { display: block; }
.charge-pop b {
  display: block;
  margin-bottom: 5px;
  font-family: var(--serif-title);
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--ink-bone);
}
.charge-pop em { display: block; font-style: normal; }
.charge-pop .warn { margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(110, 88, 54, 0.4); color: #e0a08c; }
</style>
