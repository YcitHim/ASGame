<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { t } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { useTipsStore } from "@/stores/tips";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const tips = useTipsStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const event = computed(() => run.eventDef);
const result = computed(() => run.eventResult);
const selectedOffer = ref<string | null>(null);

const nodeTitle = computed(() => {
  const node = run.current;
  return node?.i18n ? t(node.i18n, node.id) : "异 响 拐 角";
});

const offers = computed(() => run.eventChoices ? run.offers(run.eventChoices) : []);
const chosenOffer = computed(() => offers.value.find((o) => o.id === selectedOffer.value) ?? null);

onMounted(() => {
  if (!run.active) void router.replace("/");
});

function optionLabel(id: string): string {
  return event.value ? t(`${event.value.i18n}.opt.${id}.label`, id) : id;
}

function resolve(optionId: string): void {
  run.resolveEvent(optionId);
  // 事件给遗物也算"第一次拿到遗物"（docs/43 §五：别只认战斗奖励那一处）
  if (run.eventResult?.relicIds.length) tips.trigger("relic_pick");
}

function pickOffer(id: string): void {
  selectedOffer.value = selectedOffer.value === id ? null : id;
}

function isTarget(index: number): boolean {
  return chosenOffer.value?.targets.includes(index) ?? false;
}

function attach(index: number): void {
  if (chosenOffer.value) run.applyEnhancement(index, chosenOffer.value.id);
}

function toMap(): void {
  run.eventContinue();
  void router.push("/map");
}

function relicName(id: string): string {
  return t(`relic.${id}.name`, id);
}
function relicDesc(id: string): string {
  return t(`relic.${id}.desc`, "");
}
function cardName(id: string): string {
  return t(`card.${id}.name`, id);
}
function cardDesc(id: string): string {
  return t(`card.${id}.desc`, "");
}
function enhancementName(id: string): string {
  return t(`enh.${id}.name`, id);
}
function enhancementDesc(id: string): string {
  return t(`enh.${id}.desc`, "");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage event-stage">
      <div class="topbar">
        <span>{{ nodeTitle }}</span>
        <div class="r"><span class="hp">HP {{ run.hp }} / {{ run.maxHp }}</span></div>
      </div>

      <template v-if="event">
        <header class="hd">
          <h1 class="head">{{ t(event.i18n + '.title', event.id) }}</h1>
        </header>
        <p class="body">{{ t(event.i18n + '.body', '') }}</p>

        <template v-if="!result">
          <div class="options">
            <button v-for="opt in event.options" :key="opt.id" class="option" @click="resolve(opt.id)">
              <b>{{ optionLabel(opt.id) }}</b>
            </button>
          </div>
        </template>

        <template v-else>
          <p class="result-text">{{ t(result.i18n, "……") }}</p>
          <p v-if="result.hpDelta || result.pollutionDelta" class="deltas">
            <span v-if="result.hpDelta" :class="result.hpDelta < 0 ? 'bad' : 'good'">
              HP {{ result.hpDelta > 0 ? "+" : "" }}{{ result.hpDelta }}
            </span>
            <span v-if="result.pollutionDelta" class="rot">
              污染 {{ result.pollutionDelta > 0 ? "+" : "" }}{{ result.pollutionDelta }}
            </span>
          </p>
          <div v-if="result.relicIds.length" class="gains">
            <b class="gains-label">获得遗物</b>
            <div class="gain-list">
              <div v-for="id in result.relicIds" :key="id" class="gain-item relic-item">
                <span class="gain-name">
                  <i class="gain-dot" />{{ relicName(id) }}
                </span>
                <span class="gain-desc">{{ relicDesc(id) }}</span>
              </div>
            </div>
          </div>
          <div v-if="result.cardIds.length" class="gains">
            <b class="gains-label">获得卡牌</b>
            <div class="gain-list">
              <div v-for="id in result.cardIds" :key="id" class="gain-item card-item">
                <span class="gain-name">
                  <i class="gain-dot card" />{{ cardName(id) }}
                </span>
                <span class="gain-desc">{{ cardDesc(id) }}</span>
              </div>
            </div>
          </div>

          <template v-if="result.gainEnhancement && offers.length > 0">
            <h2 class="sub">从旅商的针管里挑一条新规矩</h2>
            <div class="options">
              <button
                v-for="offer in offers"
                :key="offer.id"
                class="option enh"
                :class="{ active: selectedOffer === offer.id }"
                @click="pickOffer(offer.id)"
              >
                <b>{{ enhancementName(offer.id) }}</b>
                <p>{{ enhancementDesc(offer.id) }}</p>
              </button>
            </div>
            <div v-if="selectedOffer" class="deck">
              <button
                v-for="(card, index) in run.deck"
                :key="index"
                class="deck-card"
                :class="{ targetable: isTarget(index) }"
                :disabled="!isTarget(index)"
                @click="attach(index)"
              >
                {{ cardName(card.cardId) }}<sup v-if="card.enhancements.length">{{ card.enhancements.length }}</sup>
              </button>
            </div>
          </template>

          <button class="etch-btn cont" @click="toMap">继 续</button>
        </template>
      </template>

      <template v-else>
        <p class="body none">这里什么也没有发生。</p>
        <button class="etch-btn cont" @click="toMap">继 续</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.event-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 44px 80px 30px;
}
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .hp { color: var(--blood-hi); font-family: var(--serif-num); }
.hd { text-align: center; }
.head { font-family: var(--serif-title); font-size: 28px; letter-spacing: 0.4em; color: var(--ink-bone); }
.body {
  max-width: 720px;
  text-align: center;
  font-family: var(--serif-body);
  font-size: 13px;
  line-height: 2;
  letter-spacing: 0.08em;
  color: var(--ink-dim);
}
.sub { margin-top: 6px; font-family: var(--serif-title); font-size: 14px; letter-spacing: 0.2em; color: var(--gold-dim); font-weight: 400; }
.options { display: flex; gap: 18px; margin-top: 12px; flex-wrap: wrap; justify-content: center; }
.option {
  min-width: 180px;
  padding: 14px 22px;
  border: 1px solid rgba(110, 88, 54, 0.55);
  border-radius: var(--radius-sm);
  background: linear-gradient(160deg, #1c1915, #12100e);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
  transition: border-color var(--dur-hover), transform var(--dur-hover);
}
.option:hover { border-color: var(--gold); transform: translateY(-3px); }
.option b { font-family: var(--serif-title); font-size: 14px; letter-spacing: 0.16em; color: var(--ink-bone); font-weight: 400; }
.option.enh { width: 220px; min-width: 0; text-align: left; }
.option.enh p { margin-top: 8px; font-size: 11px; line-height: 1.6; color: var(--ink-dim); }
.option.enh.active { border-color: var(--gold); box-shadow: 0 0 0 1px rgba(176, 141, 74, 0.45); }
.result-text {
  max-width: 720px;
  text-align: center;
  font-family: var(--serif-body);
  font-style: italic;
  font-size: 15px;
  letter-spacing: 0.14em;
  color: #d8c6a8;
}
.deltas { display: flex; gap: 18px; font-size: 13px; letter-spacing: 0.14em; }
.deltas .bad { color: var(--blood-hi); }
.deltas .good { color: var(--gold); }
.deltas .rot { color: var(--rot); }
.gains { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.gains-label { font-size: 10px; font-weight: 400; letter-spacing: 0.3em; color: var(--gold-dim); }
.gain-list { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; max-width: 860px; }
.gain-item {
  display: flex; flex-direction: column; gap: 4px;
  min-width: 200px; max-width: 280px;
  padding: 8px 14px;
  text-align: left;
  border: 1px solid rgba(176, 141, 74, 0.45);
  border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1c1915, #12100e);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}
.gain-item.card-item { border-color: rgba(107, 122, 140, 0.5); }
.gain-name {
  display: flex; align-items: center; gap: 7px;
  font-family: var(--serif-title); font-size: 13px; letter-spacing: 0.14em; color: var(--gold);
}
.card-item .gain-name { color: var(--ink-bone); }
.gain-dot {
  width: 7px; height: 7px; flex: none; transform: rotate(45deg);
  background: var(--gold); box-shadow: 0 0 6px rgba(176, 141, 74, 0.7);
}
.gain-dot.card { background: var(--steel); box-shadow: 0 0 6px rgba(107, 122, 140, 0.7); }
.gain-desc { font-size: 11px; line-height: 1.6; color: var(--ink-dim); }
.deck { display: flex; flex-wrap: wrap; gap: 8px; width: 760px; justify-content: center; }
.deck-card {
  padding: 8px 14px; font-size: 12px;
  border: 1px solid rgba(176, 141, 74, 0.35); border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1c1915, #12100e); color: var(--ink-dim);
}
.deck-card.targetable { border-color: var(--gold); color: var(--ink-bone); }
.deck-card:disabled { opacity: 0.35; }
.cont { margin-top: 10px; padding: 11px 34px; font-size: 13px; }
.none { color: var(--ink-dim); }
</style>
