<script setup lang="ts">
import { ref } from "vue";
import type { BuffInstance } from "@/core/buffs";
import { buffAmount, buffMeta, buffTip, buffValueText, type BuffMeta } from "./buff-meta";
import { BUFF_TIP_WIDTH, computeBuffTipPlacement } from "@/ui/tip-position";

withDefaults(
  defineProps<{ buffs: readonly BuffInstance[]; align?: "start" | "center"; compact?: boolean }>(),
  { align: "center", compact: false },
);

interface TipState {
  left: number;
  top: number;
  above: boolean;
  name: string;
  value: string;
  desc: string;
}

const tip = ref<TipState | null>(null);

function meta(id: string): BuffMeta {
  return buffMeta(id);
}

function open(event: MouseEvent | FocusEvent, buff: BuffInstance): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  // 提示框 Teleport 到 body：getBoundingClientRect 返回的是缩放后的视觉坐标，正是 fixed 所需
  const placement = computeBuffTipPlacement(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    window.innerWidth,
    window.innerHeight,
  );
  tip.value = {
    ...placement,
    name: meta(buff.id).name,
    value: buffValueText(buff),
    desc: buffTip(buff.id),
  };
}

function close(): void {
  tip.value = null;
}
</script>

<template>
  <div class="buffrow" :class="'align-' + align">
    <button
      v-for="b in buffs"
      :key="b.id"
      class="buff"
      :class="{ compact }"
      type="button"
      @mouseenter="open($event, b)"
      @mouseleave="close"
      @focus="open($event, b)"
      @blur="close"
    >
      <span class="tile" :style="{ '--buff-tint': meta(b.id).tint }">{{ meta(b.id).glyph }}</span>
      <span class="name">{{ meta(b.id).name }}</span>
      <span class="val">{{ buffAmount(b) }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="tip"
        class="buff-tip"
        :class="{ below: !tip.above }"
        :style="{ left: tip.left + 'px', top: tip.top + 'px', width: BUFF_TIP_WIDTH + 'px' }"
      >
        <div class="tip-head">
          <b>{{ tip.name }}</b>
          <span>{{ tip.value }}</span>
        </div>
        <p v-if="tip.desc">{{ tip.desc }}</p>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.buffrow {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.buffrow.align-center {
  justify-content: center;
}
.buffrow.align-start {
  justify-content: flex-start;
}
.buff {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 7px 0 4px;
  cursor: help;
  font: inherit;
  background: linear-gradient(180deg, #241c14, #150f0a);
  border: 1px solid rgba(176, 141, 74, 0.45);
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 3px 8px rgba(0, 0, 0, 0.45);
  transition: border-color var(--dur-hit, 120ms) ease-out, transform var(--dur-hit, 120ms) ease-out;
}
.buff:hover,
.buff:focus-visible {
  border-color: var(--gold);
  transform: translateY(-1px);
  outline: none;
}
.tile {
  width: 22px;
  height: 22px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 3px;
  font-family: var(--serif-title);
  font-size: 12px;
  color: #f6ecd8;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  background:
    radial-gradient(circle at 34% 24%, rgba(255, 255, 255, 0.22), transparent 62%),
    var(--buff-tint, #6b5a3a);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: inset 0 0 7px rgba(0, 0, 0, 0.6);
}
.buff.compact {
  padding: 0 5px 0 4px;
}
.buff.compact .name {
  display: none;
}
.name {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink-dim);
  white-space: nowrap;
}
.val {
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  font-family: var(--serif-num);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: #16100a;
  background: linear-gradient(180deg, #f2dca6, #c8a259);
  border: 1px solid rgba(0, 0, 0, 0.6);
  box-shadow: 0 0 5px rgba(200, 162, 89, 0.45);
}
.buff-tip {
  position: fixed;
  z-index: 120;
  transform: translate(-50%, -100%);
  pointer-events: none;
  padding: 8px 10px;
  background: linear-gradient(180deg, #1d1811, #100c07);
  border: 1px solid rgba(176, 141, 74, 0.65);
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 10px 26px rgba(0, 0, 0, 0.7);
}
.buff-tip.below {
  transform: translate(-50%, 0);
}
.tip-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}
.tip-head b {
  font-family: var(--serif-title);
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--ink-bone);
}
.tip-head span {
  font-family: var(--serif-num);
  font-size: 11px;
  color: var(--gold);
  white-space: nowrap;
}
.buff-tip p {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  font-family: var(--serif-body);
}
</style>
