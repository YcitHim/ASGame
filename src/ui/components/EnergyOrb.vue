<script setup lang="ts">
defineProps<{ energy: number; maxEnergy: number; charge: number; bloodHp: number; maxHp: number }>();
</script>

<template>
  <div class="energy">
    <div class="orb" :title="`能量 ${energy}/${maxEnergy}`">{{ energy }}<small>/{{ maxEnergy }}</small></div>
    <div class="pact">血契 {{ bloodHp }}/{{ maxHp }}</div>
    <div v-if="charge > 0" class="charge">充能 +{{ charge }}</div>
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
.charge { margin-top: 4px; font-size: 10px; color: #8fa1b5; letter-spacing: 0.1em; }
</style>
