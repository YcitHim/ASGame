<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "@/data/load";
import { hasTip, highlightText, keywordTip, termsIn } from "@/ui/glossary";

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

/** 右侧注解窗：显示该卡真正需要解释的词（描述 + 关键词行去重）。 */
const showTip = ref(false);
const tipPos = ref({ left: 0, top: 0 });
const cardRef = ref<HTMLElement | null>(null);

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

/** 需要解释的词：描述里出现的 + 关键词行里有的，去重后给出解释。 */
const annotations = computed(() => {
  const fromDesc = termsIn(desc.value);
  const fromKeywords = keywordLabels.value.filter((label) => hasTip(label));
  const merged: string[] = [];
  for (const term of [...fromKeywords, ...fromDesc]) {
    if (!merged.includes(term)) merged.push(term);
  }
  return merged.map((term) => ({ term, tip: keywordTip(term) }));
});

function placeTip(): void {
  const el = cardRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = 236;
  const gap = 14;
  const left = rect.right + gap + width <= window.innerWidth ? rect.right + gap : Math.max(8, rect.left - gap - width);
  const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - 200));
  tipPos.value = { left, top };
}

function onEnter(): void {
  if (props.dragging) return;
  placeTip();
  showTip.value = true;
}

function onLeave(): void {
  showTip.value = false;
}
</script>

<template>
  <div
    ref="cardRef"
    class="card"
    :class="[
      `rarity-${rarity ?? 'common'}`,
      { 'not-playable': !playable, selected, dragging, display },
    ]"
    :style="{ transform: `rotate(${rotation}deg) translateY(${lift}px)` }"
    @pointerdown="emit('grab', index, $event)"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
  >
    <div class="cost">{{ cost }}</div>
    <div v-if="keywordLabels.includes('血契')" class="bloodcost">血契</div>
    <div class="art"><span>{{ typeLabel }}</span></div>
    <div class="cname">{{ name }}<sup v-if="upgraded" class="upmark">+</sup></div>
    <div class="ctype">
      {{ typeLabel }}
      <template v-if="keywordLabels.length">
        ·
        <span v-for="(k, i) in keywordLabels" :key="k" :class="{ kw: hasTip(k) }">
          {{ k }}<template v-if="i < keywordLabels.length - 1"> / </template>
        </span>
      </template>
    </div>
    <div class="ctext" v-html="descHtml" />
    <div class="enhslots" :title="enhancementTip">
      <i v-for="n in 3" :key="n" :class="{ on: n <= (enhancements ?? 0) }" />
    </div>
  </div>

  <!-- 卡牌右侧的独立注解窗（Teleport 到 body：不被舞台缩放/裁切影响） -->
  <Teleport to="body">
    <div
      v-if="showTip && annotations.length > 0"
      class="kw-panel"
      :style="{ left: tipPos.left + 'px', top: tipPos.top + 'px' }"
    >
      <div v-for="item in annotations" :key="item.term" class="kw-row">
        <b>{{ item.term }}</b>
        <span>{{ item.tip }}</span>
      </div>
    </div>
  </Teleport>
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
/* 需要解释的机制词：蓝字（注解内容由右侧 kw-panel 给出，不再内嵌 tooltip） */
.card .kw {
  color: #7fa6c8;
  border-bottom: 1px dotted rgba(127, 166, 200, 0.5);
}

/* 卡牌右侧注解窗（Teleport 到 body） */
.kw-panel {
  position: fixed;
  z-index: 90;
  width: 236px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-raised, #1c1915);
  border: 1px solid rgba(176, 141, 74, 0.6);
  border-radius: 3px;
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.85), inset 0 0 0 1px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.kw-panel::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 22px;
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
  background: var(--bg-raised, #1c1915);
  border-left: 1px solid rgba(176, 141, 74, 0.6);
  border-bottom: 1px solid rgba(176, 141, 74, 0.6);
}
.kw-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kw-row b {
  font-family: var(--serif-title, serif);
  font-size: 12px;
  letter-spacing: 0.16em;
  color: #7fa6c8;
  font-weight: 400;
}
.kw-row span {
  font-size: 10px;
  line-height: 1.7;
  color: var(--ink-dim, #9a9081);
}
</style>
