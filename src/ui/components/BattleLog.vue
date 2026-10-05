<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { LogEntry } from "@/ui/log-format";

const props = defineProps<{ entries: readonly LogEntry[] }>();
const listRef = ref<HTMLElement | null>(null);

watch(
  () => props.entries.length,
  async () => {
    await nextTick();
    const el = listRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <div ref="listRef" class="log">
    <div v-for="entry in entries" :key="entry.seq" class="row" :data-type="entry.type">
      <span class="seq">#{{ entry.seq }}</span>
      <span class="text">{{ entry.text }}</span>
      <span v-if="entry.detail" class="detail">{{ entry.detail }}</span>
    </div>
    <div v-if="entries.length === 0" class="empty">暂无事件</div>
  </div>
</template>

<style scoped>
.log { height: 100%; overflow-y: auto; padding: 10px 12px; font-size: 11px; line-height: 1.7; }
.row { display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid rgba(110, 88, 54, 0.14); padding: 2px 0; color: var(--ink-dim); }
.row[data-type="DamageDealt"] .text { color: var(--ink-bone); }
.row[data-type="BattleEnded"] .text { color: var(--blood-hi); }
.seq { flex: none; width: 40px; color: rgba(154, 144, 129, 0.5); font-family: var(--serif-num); }
.text { flex: 1; }
.detail { flex-basis: 100%; padding-left: 46px; font-size: 10px; color: rgba(176, 141, 74, 0.85); }
.empty { color: var(--ink-dim); text-align: center; margin-top: 20px; }
</style>
