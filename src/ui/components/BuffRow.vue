<script setup lang="ts">
import type { BuffInstance } from "@/core/buffs";

defineProps<{ buffs: readonly BuffInstance[] }>();

const LABEL: Record<string, string> = {
  strength: "力",
  vulnerable: "伤",
  weak: "弱",
  regeneration: "生",
  pollution: "污",
  block: "盾",
};
const TITLE: Record<string, string> = {
  strength: "力量",
  vulnerable: "易伤",
  weak: "虚弱",
  regeneration: "再生",
  pollution: "污染",
  block: "格挡",
};
</script>

<template>
  <div class="buffrow">
    <div v-for="b in buffs" :key="b.id" class="buff" :title="TITLE[b.id]">
      <span class="glyph">{{ LABEL[b.id] ?? b.id[0] }}</span>
      <i>{{ b.duration != null ? b.duration : b.stacks }}</i>
    </div>
  </div>
</template>

<style scoped>
.buffrow {
  display: flex;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}
.buff {
  width: 26px;
  height: 26px;
  background: var(--bg-raised);
  border: 1px solid rgba(110, 88, 54, 0.5);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.glyph {
  font-family: var(--serif-title);
  font-size: 12px;
  color: var(--ink-bone);
}
.buff i {
  position: absolute;
  right: -5px;
  bottom: -6px;
  font-style: normal;
  font-size: 10px;
  color: var(--gold);
  font-family: var(--serif-num);
}
</style>
