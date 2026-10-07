<script setup lang="ts">
import { computed } from "vue";
import type { IntentPayload } from "@/core/events";
import { buffMeta } from "./buff-meta";

const props = defineProps<{ intent: IntentPayload | null }>();

const label = computed(() => {
  const i = props.intent;
  if (!i) return "?";
  // 颠倒（docs/46 §3.8）：数值被随机化，别把假数字当预告——只给「?」
  if (i.fuzzed) return "?";
  if (i.kind === "attack") return `${i.value ?? 0}${(i.hits ?? 1) > 1 ? "×" + i.hits : ""}`;
  if (i.kind === "defend") return String(i.value ?? 0);
  if (i.kind === "charge") return "蓄";
  // 自身增益（docs/47 §三.1）：显示层数，归「防御系」图标
  if (i.kind === "selfBuff") return `+${i.stacks ?? 1}`;
  return "?";
});

/**
 * 蓄力三段式（docs/41 §3.3）：蓄力中 → 临近 → 即将承受。
 * 关键点是第三段：预警不再「消失」，而是变成结算预告，因果闭合
 * （红屏预警 → 即将承受 24 → 前扑 → 飘字 −24）。
 */
const stage = computed<"none" | "charging" | "imminent" | "incoming">(() => {
  const i = props.intent;
  if (!i) return "none";
  if (i.kind === "attack" && i.released) return "incoming";
  if (i.kind === "charge") return (i.thenIn ?? 9) <= 1 ? "imminent" : "charging";
  return "none";
});

const sub = computed(() => {
  const i = props.intent;
  if (!i) return "未知";
  if (i.fuzzed) return "颠倒 · 数值未知";
  if (i.kind === "charge") {
    const value = i.thenValue ?? 0;
    if (stage.value === "imminent") return `下回合释放 ${value} · 准备防御`;
    const turns = i.thenIn ?? 0;
    return turns > 0 ? `蓄力 · ${turns}回合后释放 ${value}` : `蓄力 · 释放 ${value}`;
  }
  if (stage.value === "incoming") {
    const hits = (i.hits ?? 1) > 1 ? `×${i.hits}` : "";
    return `即将承受 ${i.value ?? 0}${hits} 伤害`;
  }
  if (i.kind === "selfBuff") {
    if (!i.buffId) return "自身增益";
    const meta = buffMeta(i.buffId);
    return `给自己 ${meta.name} ${i.stacks ?? 1}${meta.unit}`;
  }
  if (i.kind === "debuff") {
    // docs/41 §2.2：不再把一切 debuff 硬编码成「诅咒」——读 payload 的实际减益名；
    // 数据侧缺 buffId 时兜底「干扰」（validator 会对缺漏报错，这里只保证不骗玩家）。
    if (!i.buffId) return "干扰";
    const meta = buffMeta(i.buffId);
    return i.stacks && i.stacks > 0 ? `${meta.name} ${i.stacks}${meta.unit}` : meta.name;
  }
  return { attack: "攻击", defend: "防御", summon: "召唤", selfBuff: "自身增益", unknown: "未知" }[i.kind];
});

const color = computed(() => (props.intent?.kind === "attack" ? "#C0392B" : "#B08D4A"));

/** 悬停补全被压缩掉的信息（蓄力期间的格挡量）。 */
const tip = computed(() => {
  const i = props.intent;
  if (i?.kind === "charge" && i.block) return `${sub.value}（蓄力期间架起 ${i.block} 点格挡）`;
  return sub.value;
});
</script>

<template>
  <div class="intent" :class="stage" :title="tip">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" :stroke="color" stroke-width="1.6" stroke-linecap="round">
      <template v-if="intent?.kind === 'attack'">
        <path d="M4 20 L16 8 M14 4 L20 4 L20 10 M7 13 L11 17" />
      </template>
      <template v-else-if="intent?.kind === 'defend'">
        <path d="M12 3 L20 6 V12 C20 17 16.5 20 12 21.5 C7.5 20 4 17 4 12 V6 Z" />
      </template>
      <template v-else-if="intent?.kind === 'selfBuff'">
        <path d="M12 3 L20 6 V12 C20 17 16.5 20 12 21.5 C7.5 20 4 17 4 12 V6 Z" />
        <path d="M12 8 v7 M8.5 11.5 h7" />
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
/* 即将承受（docs/41 §3.3）：红框 + 边框脉冲，把"预警消失的那一回合"补回来 */
.intent.incoming { border-color: rgba(192, 57, 43, 0.9); animation: intent-pulse 1s ease-in-out infinite; }
.intent.incoming .sub { color: var(--blood-hi); }
.intent.incoming .num { color: var(--blood-hi); }
@keyframes intent-pulse {
  0%, 100% { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 0 0 rgba(192, 57, 43, 0); }
  50% { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 14px 2px rgba(192, 57, 43, 0.75); }
}
</style>
