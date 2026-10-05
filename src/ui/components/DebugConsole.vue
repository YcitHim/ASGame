<script setup lang="ts">
import { ref } from "vue";
import { DEBUG_QUICK } from "@/systems/debug";

defineProps<{ feedback: string }>();
const emit = defineEmits<{ (e: "command", command: string): void }>();

const input = ref("");
const history = ref<string[]>([]);
const QUICK = DEBUG_QUICK;

function submit(): void {
  const command = input.value.trim();
  if (!command) return;
  history.value = [...history.value, command];
  emit("command", command);
  input.value = "";
}
</script>

<template>
  <div class="console">
    <div v-if="history.length" class="history">
      <div v-for="(h, i) in history" :key="i">&gt; {{ h }}</div>
    </div>
    <div class="quick">
      <button v-for="q in QUICK" :key="q" class="chip" @click="emit('command', q)">{{ q }}</button>
    </div>
    <div class="inputline">
      <input v-model="input" placeholder="调试指令…" @keydown.enter="submit" />
      <button class="go" @click="submit">执行</button>
    </div>
    <div class="feedback">{{ feedback }}</div>
  </div>
</template>

<style scoped>
.console { border-top: 1px solid rgba(110, 88, 54, 0.4); padding: 8px 10px; font-size: 11px; }
.history div { color: var(--ink-dim); font-family: var(--serif-num); }
.quick { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.chip { font-size: 10px; color: var(--ink-dim); border: 1px solid rgba(110, 88, 54, 0.5); border-radius: 2px; padding: 1px 5px; }
.chip:hover { color: var(--gold); border-color: var(--gold); }
.inputline { display: flex; gap: 6px; }
input {
  flex: 1; background: #0a0806; border: 1px solid rgba(176, 141, 74, 0.4);
  color: var(--ink-bone); font: inherit; padding: 4px 6px;
}
input:focus { outline: none; border-color: var(--gold); }
.go { border: 1px solid var(--gold); color: var(--gold); padding: 2px 10px; font-size: 11px; }
.feedback { margin-top: 4px; min-height: 14px; color: var(--gold-dim); }
</style>
