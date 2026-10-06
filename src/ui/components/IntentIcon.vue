<script setup lang="ts">
import { computed } from "vue";
import type { IntentPayload } from "@/core/events";

const props = defineProps<{ intent: IntentPayload | null }>();

const label = computed(() => {
  const i = props.intent;
  if (!i) return "?";
  if (i.kind === "attack") return `${i.value ?? 0}${(i.hits ?? 1) > 1 ? "×" + i.hits : ""}`;
  if (i.kind === "defend") return String(i.value ?? 0);
  if (i.kind === "charge") return "蓄";
  return "?";
});

const sub = computed(() => {
  const i = props.intent;
  if (!i) return "未知";
  if (i.kind === "charge") {
    // 先给「这一下有多疼」，再给回合/格挡——多敌人时一眼能看到威胁量级（C2-P-1）
    const parts: string[] = [];
    if (i.thenValue !== undefined) parts.push("释放 " + i.thenValue);
    if (i.block) parts.push("+" + i.block + "挡");
    if (i.thenIn) parts.push(i.thenIn === 1 ? "下回合" : i.thenIn + "回合");
    if (parts.length === 0) parts.push("蓄力");
    return parts.join(" · ");
  }
  return { attack: "攻击", defend: "防御", debuff: "诅咒", summon: "召唤", unknown: "未知" }[i.kind];
});

const color = computed(() => (props.intent?.kind === "attack" ? "#C0392B" : "#B08D4A"));
</script>

<template>
  <div
    class="intent"
    :class="{ imminent: intent?.kind === 'charge' && (intent?.thenIn ?? 9) <= 1 }"
    :title="sub"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" :stroke="color" stroke-width="1.6" stroke-linecap="round">
      <template v-if="intent?.kind === 'attack'">
        <path d="M4 20 L16 8 M14 4 L20 4 L20 10 M7 13 L11 17" />
      </template>
      <template v-else-if="intent?.kind === 'defend'">
        <path d="M12 3 L20 6 V12 C20 17 16.5 20 12 21.5 C7.5 20 4 17 4 12 V6 Z" />
      </template>
      <template v-else-if="intent?.kind === 'charge'">
        <path d="M12 3 A9 9 0 1 1 3 12 M12 7 A5 5 0 1 0 17 12" />
      </template>
      <template v-else>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8 v6 M12 16 v0.5" />
      </template>
    </svg>
    <span class="num">{{ label }}</span>
    <span class="sub">{{ sub }}</span>
  </div>
</template>

<style scoped>
.intent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(18, 16, 14, 0.92);
  border: 1px solid rgba(176, 141, 74, 0.5);
  padding: 3px 10px 3px 7px;
  border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}
.num {
  font-family: var(--serif-num);
  font-size: 17px;
  color: var(--ink-bone);
  text-shadow: 0 0 6px rgba(192, 57, 43, 0.6);
}
.sub {
  font-size: 10px;
  color: var(--ink-dim);
  letter-spacing: 0.1em;
  white-space: nowrap;
}
/* 蓄力即将释放：整颗意图转红提示（C2-P-1） */
.intent.imminent { border-color: rgba(192, 57, 43, 0.75); }
.intent.imminent .sub { color: var(--blood-hi); }
.intent.imminent .num { color: var(--blood-hi); }
</style>
