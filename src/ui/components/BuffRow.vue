<script setup lang="ts">
import { ref } from "vue";
import type { BuffInstance } from "@/core/buffs";
import { buffAmount, buffMeta, buffTip, buffValueText, type BuffMeta } from "./buff-meta";
import { BUFF_TIP_WIDTH, computeBuffTipPlacement, type TipRect } from "@/ui/tip-position";
import { keywordTip } from "@/ui/glossary";

interface ChargeBadge {
  readonly stacks: number;
  readonly thenIn: number;
  readonly block: number;
}

const props = withDefaults(
  defineProps<{
    buffs: readonly BuffInstance[];
    align?: "start" | "center";
    compact?: boolean;
    /** 蓄力中时额外显示的「蓄力 ×N（M 回合后释放）」徽标（docs/19 §4） */
    charge?: ChargeBadge | null;
    /**
     * 需要避让的选择器（docs/52 §3.2）：提示框朝上会盖住这些元素时改朝下。
     * 只在**同一个单位容器**（.player-panel / .enemy）内查找，避免拿别的敌人的计量条当障碍。
     */
    avoid?: readonly string[];
  }>(),
  { align: "center", compact: false, charge: null, avoid: () => [] },
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

/** 收集同单位容器内的障碍物矩形（实测，不写死像素）。 */
function obstacleRects(anchor: HTMLElement): TipRect[] {
  if (props.avoid.length === 0) return [];
  const scope: ParentNode = anchor.closest(".player-panel, .enemy") ?? document;
  const out: TipRect[] = [];
  for (const selector of props.avoid) {
    for (const node of scope.querySelectorAll(selector)) {
      const r = node.getBoundingClientRect();
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }
  return out;
}

function place(event: MouseEvent | FocusEvent, name: string, value: string, desc: string): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  // 提示框 Teleport 到 body：getBoundingClientRect 返回的是缩放后的视觉坐标，正是 fixed 所需
  const placement = computeBuffTipPlacement(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    window.innerWidth,
    window.innerHeight,
    obstacleRects(el),
  );
  tip.value = { ...placement, name, value, desc };
}

function open(event: MouseEvent | FocusEvent, buff: BuffInstance): void {
  place(event, meta(buff.id).name, buffValueText(buff), buffTip(buff.id));
}

function openCharge(event: MouseEvent | FocusEvent): void {
  const badge = props.charge;
  if (!badge) return;
  place(
    event,
    "蓄力",
    `×${badge.stacks} · ${badge.thenIn} 回合后释放`,
    keywordTip("蓄力"),
  );
}

function close(): void {
  tip.value = null;
}
</script>

<template>
  <div class="buffrow" :class="'align-' + align">
    <button
      v-if="charge"
      class="buff charge"
      :class="{ compact }"
      type="button"
      @mouseenter="openCharge"
      @mouseleave="close"
      @focus="openCharge"
      @blur="close"
    >
      <span class="tile" style="--buff-tint: #7a3a1f">蓄</span>
      <span class="name">蓄力<template v-if="charge.thenIn > 0"> · {{ charge.thenIn }}回合</template></span>
      <span class="val">{{ charge.stacks }}</span>
    </button>

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
  /* docs/52 §3.1：条目高度 30 → 34（字形块同步 22 → 24），状态名与层数放大后可读 */
  height: 34px;
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
.buff.charge {
  border-color: rgba(192, 106, 43, 0.65);
}
.buff.charge:hover {
  border-color: #d9822b;
}
.tile {
  width: 24px;
  height: 24px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 3px;
  font-family: var(--serif-title);
  font-size: 13px;
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
  /* docs/52 §3.1：状态名 10px/ink-dim → 12px/ink-bone，深底上不再糊成一团 */
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--ink-bone);
  white-space: nowrap;
}
.val {
  min-width: 19px;
  height: 19px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  font-family: var(--serif-num);
  font-size: 13px;
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
