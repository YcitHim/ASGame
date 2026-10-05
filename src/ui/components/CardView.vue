<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/data/load";
import { highlightText, keywordTip } from "@/ui/glossary";

const props = defineProps<{
  cardId: string;
  cost: number;
  keywords: readonly string[];
  type: string;
  playable: boolean;
  selected: boolean;
  dragging?: boolean;
  index: number;
  handCount: number;
  enhancements?: number;
  upgraded?: boolean;
  enhancementIds?: readonly string[];
  rarity?: string;
  /** 展示模式（奖励/锻造用）：不扇形、不夸张抬升 */
  display?: boolean;
}>();

const emit = defineEmits<{ (e: "grab", index: number, event: PointerEvent): void }>();

const TYPE_LABEL: Record<string, string> = { attack: "攻击", skill: "技能", power: "能力", curse: "诅咒", status: "状态" };
const KEYWORD_LABEL: Record<string, string> = {
  bloodpact: "血契",
  exhaust: "消耗",
  retain: "保留",
  ethereal: "虚无",
  innate: "固有",
  charge: "充能",
  pollution: "污染",
  overload: "过载",
  regenerate: "再生",
};

const name = computed(() => t(`card.${props.cardId}.name`, props.cardId));
const desc = computed(() =>
  props.upgraded
    ? t(`card.${props.cardId}.descUp`, t(`card.${props.cardId}.desc`, ""))
    : t(`card.${props.cardId}.desc`, ""),
);
const descHtml = computed(() => highlightText(desc.value));
const typeLabel = computed(() => TYPE_LABEL[props.type] ?? props.type);
const keywordLabels = computed(() => props.keywords.map((k) => KEYWORD_LABEL[k] ?? k));
const enhancementTip = computed(() =>
  (props.enhancementIds ?? [])
    .map((id) => `${t(`enh.${id}.name`, id)}：${t(`enh.${id}.desc`, "")}`)
    .join("\n"),
);

/** 扇形展开：以中心为 0 度摊开；展示模式不旋转。 */
const rotation = computed(() => {
  if (props.display || props.handCount <= 1) return 0;
  const center = (props.handCount - 1) / 2;
  return ((props.index - center) / Math.max(1, center)) * 9;
});
const lift = computed(() => (props.display ? 0 : Math.abs(rotation.value) * 1.8));
</script>

<template>
  <div
    class="card"
    :class="[
      `rarity-${rarity ?? 'common'}`,
      { 'not-playable': !playable, selected, dragging, display },
    ]"
    :style="{ transform: `rotate(${rotation}deg) translateY(${lift}px)` }"
    @pointerdown="emit('grab', index, $event)"
  >
    <div class="cost">{{ cost }}</div>
    <div v-if="keywordLabels.includes('血契')" class="bloodcost">血契</div>
    <div class="art"><span>{{ typeLabel }}</span></div>
    <div class="cname">{{ name }}<sup v-if="upgraded" class="upmark">+</sup></div>
    <div class="ctype">
      {{ typeLabel }}
      <template v-if="keywordLabels.length">
        ·
        <span v-for="(k, i) in keywordLabels" :key="k" class="kw" :data-tip="keywordTip(k)">
          {{ k }}<template v-if="i < keywordLabels.length - 1"> / </template>
        </span>
      </template>
    </div>
    <div class="ctext" v-html="descHtml" />
    <div class="enhslots" :title="enhancementTip">
      <i v-for="n in 3" :key="n" :class="{ on: n <= (enhancements ?? 0) }" />
    </div>
  </div>
</template>

<style scoped>
.card {
  width: 170px;
  height: 240px;
  flex: none;
  margin: 0 -22px;
  position: relative;
  border-radius: var(--radius-md);
  background: linear-gradient(165deg, #1c1915 0%, #12100e 60%, #171310 100%);
  border: 1px solid var(--edge-gold);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), inset 0 0 26px rgba(0, 0, 0, 0.55), 0 10px 26px rgba(0, 0, 0, 0.65);
  transform-origin: bottom center;
  transition: transform var(--dur-hover) ease-out, box-shadow var(--dur-hover) ease-out, filter var(--dur-hover) ease-out;
  cursor: grab;
  touch-action: none;
}
.card:active {
  cursor: grabbing;
}
.card:hover {
  transform: translateY(-52px) scale(1.12) rotate(0deg) !important;
  z-index: 30;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(176, 141, 74, 0.8), 0 22px 44px rgba(0, 0, 0, 0.8);
}
.card.display {
  margin: 0;
  cursor: pointer;
  transform-origin: center center;
}
.card.display:hover {
  transform: translateY(-10px) scale(1.05) rotate(0deg) !important;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(176, 141, 74, 0.9), 0 26px 46px rgba(0, 0, 0, 0.85);
}
/* 稀有度描边：普通暗金 / 稀有（uncommon）钢蓝 / 史诗（rare）亮金 */
.card.rarity-uncommon {
  border-color: rgba(107, 122, 140, 0.85);
}
.card.rarity-rare {
  border-color: rgba(176, 141, 74, 0.95);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), inset 0 0 26px rgba(176, 141, 74, 0.12), 0 10px 26px rgba(0, 0, 0, 0.65);
}
.card.not-playable {
  filter: saturate(0.4) brightness(0.8);
}
.card.selected {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 0 0 2px var(--gold), 0 0 22px rgba(176, 141, 74, 0.5);
}
.card.dragging {
  opacity: 0.35;
}
.cost {
  position: absolute;
  top: -11px;
  left: -11px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  z-index: 3;
  background: radial-gradient(circle at 34% 30%, #3a2f1c, #171208);
  border: 1px solid var(--gold);
  box-shadow: 0 0 10px rgba(176, 141, 74, 0.35), inset 0 0 6px #000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--serif-num);
  font-size: 17px;
  color: var(--gold);
}
.bloodcost {
  position: absolute;
  top: 24px;
  left: -8px;
  z-index: 3;
  font-size: 10px;
  color: #e0705a;
  letter-spacing: 0.1em;
}
.art {
  height: 96px;
  margin: 10px 10px 0;
  border: 1px solid rgba(110, 88, 54, 0.4);
  background:
    radial-gradient(circle at 50% 42%, rgba(176, 141, 74, 0.16), transparent 62%),
    linear-gradient(160deg, #241d15, #0f0d0a);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 14px rgba(0, 0, 0, 0.7);
}
.art span {
  font-family: var(--serif-title);
  font-size: 26px;
  letter-spacing: 0.3em;
  color: rgba(176, 141, 74, 0.55);
}
.cname {
  text-align: center;
  font-family: var(--serif-title);
  font-size: 15px;
  letter-spacing: 0.14em;
  margin-top: 9px;
  color: var(--ink-bone);
}
.upmark {
  color: var(--gold);
  font-size: 11px;
  margin-left: 3px;
}
.ctype {
  text-align: center;
  font-size: 9px;
  letter-spacing: 0.2em;
  margin-top: 3px;
  color: var(--gold-dim);
}
.ctext {
  margin: 9px 12px 0;
  font-size: 11px;
  line-height: 1.65;
  color: var(--ink-dim);
  text-align: center;
}
.enhslots {
  position: absolute;
  bottom: 6px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 5px;
}
.enhslots i {
  width: 10px;
  height: 10px;
  border: 1px solid var(--gold-dim);
  transform: rotate(45deg);
  background: rgba(176, 141, 74, 0.12);
}
.enhslots i.on {
  background: var(--blood-hi);
  border-color: var(--blood-hi);
  box-shadow: 0 0 6px rgba(192, 57, 43, 0.7);
}
</style>

<style>
/* 关键词：蓝字 + 悬浮解释（全局，因为 v-html 内容不参与 scoped） */
.card .kw {
  color: #7fa6c8;
  border-bottom: 1px dotted rgba(127, 166, 200, 0.6);
  position: relative;
  cursor: help;
}
.card .kw:hover {
  color: #a8c8e4;
}
.card .kw[data-tip]:hover::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: 135%;
  transform: translateX(-50%);
  width: 220px;
  padding: 8px 10px;
  background: var(--bg-raised, #1c1915);
  border: 1px solid rgba(176, 141, 74, 0.6);
  border-radius: 3px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.85);
  color: var(--ink-dim, #9a9081);
  font-size: 10px;
  line-height: 1.7;
  letter-spacing: 0.04em;
  text-align: left;
  white-space: normal;
  z-index: 80;
  pointer-events: none;
}
</style>
