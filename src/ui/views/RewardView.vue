<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import type { CardDefinition } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { useCodexStore } from "@/stores/codex";
import { useRunStore } from "@/stores/run";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";
import { actCopy } from "@/ui/act-copy";
import CardView from "@/ui/components/CardView.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { relicFitNote, relicResourceFit, type RelicFit } from "@/ui/relic-fit";

const router = useRouter();
const run = useRunStore();
const tips = useTipsStore();
const tutorial = useTutorialStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const rewards = ref<string[]>([]);
const relicOffers = ref<string[]>([]);
const node = computed(() => run.current);
const mode = computed<"boss" | "elite" | "card">(() =>
  node.value?.kind === "boss" ? "boss" : node.value?.kind === "elite" ? "elite" : "card",
);

/** 精英战两段式（docs/25 §1）：先遗物三选一，再「残骸锻核」强化三选一，都可放弃。 */
const step = ref<"relic" | "enhance">("relic");
/**
 * 普通战斗胜利的两段式（甲方 2026-10-07）：**第一场**胜利先从 T1 池给一次随身遗物三选一，
 * 再走原来的卡牌三选一。开局不再自选随身遗物。
 */
const cardStep = ref<"companion" | "card">("card");
const companionOffers = ref<string[]>([]);
/** Boss 遗物槽（docs/38 §一 A-1）：T3 稀有池，可取走 1 件 */
const bossTaken = ref<string | null>(null);
const enhanceChoices = ref<string[]>([]);
const selectedOffer = ref<string | null>(null);
const enhanceOffers = computed(() => run.offers(enhanceChoices.value));
const chosenOffer = computed(() => enhanceOffers.value.find((o) => o.id === selectedOffer.value) ?? null);

function enhancementName(id: string): string {
  return t(`enh.${id}.name`, id);
}
function enhancementDesc(id: string): string {
  return t(`enh.${id}.desc`, "");
}
function isTarget(deckIndex: number): boolean {
  return chosenOffer.value?.targets.includes(deckIndex) ?? false;
}

const RARITY_LABEL: Record<string, string> = {
  starter: "起始",
  common: "普通",
  uncommon: "稀有",
  rare: "史诗",
  special: "特殊",
};

interface RewardCard {
  id: string;
  def: CardDefinition | undefined;
}

const rewardCards = computed<RewardCard[]>(() =>
  rewards.value.map((id) => ({ id, def: run.cardDef(id) })),
);

onMounted(() => {
  if (!run.active) {
    void router.replace("/");
    return;
  }
  const codex = useCodexStore();
  if (mode.value === "card") {
    rewards.value = run.cardRewards();
    codex.markCards(rewards.value);
    // 首胜随身遗物：先从 T1 池三选一，再选卡
    if (run.companionDue) {
      companionOffers.value = run.companionRelicChoices();
      codex.markRelics(companionOffers.value);
      if (companionOffers.value.length > 0) cardStep.value = "companion";
    }
    // 首遇提示（docs/42 §五）：只有真的进到「卡牌三选一」才弹——
    // 首胜那一步先选的是随身遗物，在那一步弹「挑一张牌」是错位的
    if (cardStep.value === "card") showPickTip();
  } else if (mode.value === "elite") {
    // 精英 / 残骸锻核 = T2 常规池（docs/38 §一 A-1）
    relicOffers.value = run.relicChoices([2]);
    codex.markRelics(relicOffers.value);
  } else if (mode.value === "boss") {
    // Boss 掉落 = T3 稀有池
    relicOffers.value = run.relicChoices([3]);
    codex.markRelics(relicOffers.value);
  }
});

/** 遗物 → 强化（池空则直接回地图）。 */
function afterRelic(): void {
  enhanceChoices.value = run.enhancementChoices();
  if (enhanceOffers.value.length > 0) {
    step.value = "enhance";
    return;
  }
  finishRun();
}

function takeRelic(id: string): void {
  run.addRelic(id);
  tips.trigger("relic_pick");
  afterRelic();
}

function takeBossRelic(id: string): void {
  run.addRelic(id);
  tips.trigger("relic_pick");
  bossTaken.value = id;
}

/**
 * 首胜三选一里的「机制不合」件（docs/43 §2.4 配套 / docs/50 §三）：
 * 压力表对非炉心、血泵对非血械 = 纯白板。照常出现，但置灰 + 一行标注 + 不可选。
 */
function companionFit(id: string): RelicFit {
  return relicResourceFit(id, run.classId, loadGameContent().content);
}
function companionNote(id: string): string {
  return relicFitNote(companionFit(id));
}
function isCompanionFit(id: string): boolean {
  return companionFit(id).ok;
}

/** 卡牌三选一的首遇提示（docs/42 §五）：教学里讲过三选一，正式局首次再遇不再弹。 */
function showPickTip(): void {
  tips.triggerUnlessTaught("reward_pick", tutorial.finished);
}

/** 取走首胜随身遗物 → 回到卡牌三选一。 */
function takeCompanion(id: string): void {
  if (!isCompanionFit(id)) return;
  run.takeCompanionRelic(id);
  tips.trigger("relic_pick");
  cardStep.value = "card";
  showPickTip();
}

/** 放弃首胜随身遗物 → 直接走卡牌三选一。 */
function skipCompanion(): void {
  cardStep.value = "card";
  showPickTip();
}

function pickEnhanceOffer(id: string): void {
  selectedOffer.value = selectedOffer.value === id ? null : id;
}

function attachElite(deckIndex: number): void {
  if (!chosenOffer.value || !isTarget(deckIndex)) return;
  if (run.applyEnhancement(deckIndex, chosenOffer.value.id)) finishRun();
}

function pick(cardId: string): void {
  run.addCard(cardId);
  run.advance();
  void router.push("/map");
}

function finishRun(): void {
  run.advance();
  // 一幕通关但还有下一幕：进幕间（docs/40 §2.2）
  if (run.needsIntermission) {
    void router.push("/intermission");
    return;
  }
  void router.push("/map");
}

function skip(): void {
  run.advance();
  void router.push("/map");
}

function rarityLabel(rarity: string | undefined): string {
  return RARITY_LABEL[rarity ?? "common"] ?? "普通";
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage reward-stage">
      <template v-if="mode === 'boss'">
        <div class="triumph">
          <h1 class="head">远 征 胜 利</h1>
          <p class="sub">{{ actCopy("result.bossFall", run.run?.actIndex ?? 0) }}</p>
          <div v-if="relicOffers.length" class="relics boss-relics">
            <button
              v-for="id in relicOffers"
              :key="id"
              class="relic"
              :class="{ taken: bossTaken === id }"
              @click="takeBossRelic(id)"
            >
              <b>{{ t(`relic.${id}.name`, id) }}</b>
              <p>{{ t(`relic.${id}.desc`, "") }}</p>
              <span class="pick">{{ bossTaken === id ? "已取走" : "取 走" }}</span>
            </button>
          </div>
          <button class="etch-btn" @click="finishRun">完成远征</button>
        </div>
      </template>

      <template v-else-if="mode === 'elite'">
        <template v-if="step === 'relic'">
          <header class="hd">
            <h1 class="head">遗 物</h1>
            <p class="sub">精英战利品 · 选取一件遗物</p>
          </header>
          <div class="relics">
            <button v-for="id in relicOffers" :key="id" class="relic" @click="takeRelic(id)">
              <b>{{ t(`relic.${id}.name`, id) }}</b>
              <p>{{ t(`relic.${id}.desc`, "") }}</p>
              <span class="pick">取 走</span>
            </button>
            <p v-if="relicOffers.length === 0" class="none">没有可取走的遗物</p>
          </div>
          <button class="skip" @click="afterRelic">放 弃</button>
        </template>

        <template v-else>
          <header class="hd">
            <h1 class="head">残 骸 锻 核</h1>
            <p class="sub">从精英的残骸中，拆出仍能搏动的核心。</p>
          </header>
          <div class="options">
            <button
              v-for="offer in enhanceOffers"
              :key="offer.id"
              class="option enh"
              :class="{ active: selectedOffer === offer.id }"
              @click="pickEnhanceOffer(offer.id)"
            >
              <b>{{ enhancementName(offer.id) }}</b>
              <p>{{ enhancementDesc(offer.id) }}</p>
              <span class="pick">{{ selectedOffer === offer.id ? "选 中" : "选 取" }}</span>
            </button>
          </div>
          <div v-if="selectedOffer" class="deck">
            <button
              v-for="(card, index) in run.deck"
              :key="index"
              class="deck-card"
              :class="{ targetable: isTarget(index) }"
              :disabled="!isTarget(index)"
              @click="attachElite(index)"
            >
              {{ t(`card.${card.cardId}.name`, card.cardId)
              }}<sup v-if="card.enhancements.length">{{ card.enhancements.length }}</sup>
            </button>
          </div>
          <button class="skip" @click="finishRun">放 弃</button>
        </template>
      </template>

      <template v-else-if="cardStep === 'companion'">
        <header class="hd">
          <h1 class="head">随 身 遗 物</h1>
          <p class="sub">第一场胜利 · 从三件里挑一件带走</p>
        </header>
        <div class="relics">
          <button
            v-for="id in companionOffers"
            :key="id"
            class="relic"
            :class="{ unfit: !isCompanionFit(id) }"
            :disabled="!isCompanionFit(id)"
            @click="takeCompanion(id)"
          >
            <b>{{ t(`relic.${id}.name`, id) }}</b>
            <p>{{ t(`relic.${id}.desc`, "") }}</p>
            <span v-if="!isCompanionFit(id)" class="unfit-note">{{ companionNote(id) }}</span>
            <span class="pick">{{ isCompanionFit(id) ? "取 走" : "不 可 选" }}</span>
          </button>
        </div>
        <button class="skip" @click="skipCompanion">放 弃</button>
      </template>

      <template v-else>
        <header class="hd">
          <h1 class="head">战 利 品</h1>
          <p class="sub">从三张卡中选取一张加入卡组</p>
        </header>

        <div class="options">
          <button v-for="card in rewardCards" :key="card.id" class="option" @click="pick(card.id)">
            <span class="rarity" :class="card.def?.rarity">{{ rarityLabel(card.def?.rarity) }}</span>
            <CardView
              :card-id="card.id"
              :cost="card.def?.cost ?? 0"
              :keywords="card.def?.keywords ?? []"
              :type="card.def?.type ?? 'skill'"
              :rarity="card.def?.rarity ?? 'common'"
              :playable="true"
              :selected="false"
              :index="0"
              :hand-count="1"
              display
            />
            <span class="pick">选 取</span>
          </button>
        </div>

        <button class="skip" @click="skip">放 弃 奖 励</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.reward-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding-top: 24px;
}
.hd {
  text-align: center;
}
.head {
  font-family: var(--serif-title);
  font-size: 30px;
  letter-spacing: 0.5em;
  color: var(--ink-bone);
}
.sub {
  margin-top: 8px;
  font-size: 11px;
  letter-spacing: 0.24em;
  color: var(--ink-dim);
}
.options {
  display: flex;
  gap: 30px;
  margin-top: 12px;
}
/* 精英「残骸锻核」强化三选一（docs/25 §1.5） */
.option.enh {
  width: 210px;
  min-height: 128px;
  align-items: flex-start;
  text-align: left;
  padding: 14px 14px 30px;
}
.option.enh b {
  font-family: var(--serif-title);
  font-size: 16px;
  letter-spacing: 0.16em;
  color: var(--ink-bone);
  font-weight: 400;
}
.option.enh p {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-dim);
}
.option.enh.active {
  border-color: var(--gold);
  box-shadow: 0 0 0 1px rgba(176, 141, 74, 0.45);
}
.deck {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 760px;
  justify-content: center;
}
.deck-card {
  padding: 8px 14px;
  font-size: 12px;
  border: 1px solid rgba(176, 141, 74, 0.35);
  border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1c1915, #12100e);
  color: var(--ink-dim);
}
.deck-card.targetable {
  border-color: var(--gold);
  color: var(--ink-bone);
}
.deck-card:disabled {
  opacity: 0.35;
}
.option {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 34px;
  border: 1px solid rgba(110, 88, 54, 0.35);
  border-radius: var(--radius-md);
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(176, 141, 74, 0.1), transparent 70%),
    rgba(14, 12, 10, 0.72);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 12px 30px rgba(0, 0, 0, 0.55);
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover), transform var(--dur-hover);
}
.option:hover {
  border-color: var(--gold);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 22px rgba(176, 141, 74, 0.28), 0 16px 34px rgba(0, 0, 0, 0.65);
}
.rarity {
  align-self: flex-end;
  margin-right: 2px;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-dim);
}
.rarity.uncommon {
  color: #8fa1b5;
}
.rarity.rare {
  color: var(--gold);
}
.pick {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--serif-title);
  font-size: 11px;
  letter-spacing: 0.34em;
  color: var(--gold-dim);
  transition: color var(--dur-hover);
}
.option:hover .pick {
  color: var(--gold);
}
.relics {
  display: flex;
  gap: 20px;
  margin-top: 12px;
}
.relic {
  width: 240px;
  padding: 18px 16px 34px;
  position: relative;
  text-align: left;
  border: 1px solid rgba(176, 141, 74, 0.45);
  border-radius: var(--radius-sm);
  background: linear-gradient(160deg, #1c1915, #12100e);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 12px 30px rgba(0, 0, 0, 0.55);
  transition: transform var(--dur-hover), border-color var(--dur-hover);
}
.relic:hover {
  transform: translateY(-8px);
  border-color: var(--gold);
}
.relic b {
  font-family: var(--serif-title);
  font-size: 16px;
  letter-spacing: 0.16em;
  color: var(--ink-bone);
  font-weight: 400;
}
.relic p {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--ink-dim);
}
/* 机制不合件（docs/43 §2.4 / docs/50 §三）：照常出现，置灰 + 标注 + 不可选 */
.relic.unfit {
  opacity: 0.42;
  filter: grayscale(0.7);
  cursor: not-allowed;
}
.relic.unfit:hover {
  transform: none;
  border-color: rgba(110, 88, 54, 0.35);
}
.unfit-note {
  display: block;
  margin-top: 10px;
  font-size: 10px;
  line-height: 1.6;
  letter-spacing: 0.08em;
  color: var(--blood-hi);
  opacity: 0.85;
}
.none {
  color: var(--ink-dim);
  font-size: 12px;
}
.skip {
  padding: 8px 20px;
  font-size: 10px;
  letter-spacing: 0.3em;
  color: var(--ink-dim);
  opacity: 0.72;
}
.skip:hover {
  color: var(--blood-hi);
}
.triumph {
  text-align: center;
}
.triumph .head {
  color: var(--gold);
  text-shadow: 0 0 28px rgba(176, 141, 74, 0.55);
}
.triumph .sub {
  margin: 14px 0 22px;
}
.triumph .etch-btn {
  padding: 11px 26px;
  font-size: 13px;
}
.boss-relics {
  justify-content: center;
  margin: 0 0 22px;
}
.boss-relics .relic {
  width: 200px;
  padding: 14px 14px 30px;
}
.boss-relics .relic.taken {
  border-color: var(--gold);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 0 18px rgba(176, 141, 74, 0.35);
}
</style>
