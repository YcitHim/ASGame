<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { RECAST_HP_COST } from "@/core/map";
import { t } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const selected = ref<string | null>(null);
const notice = ref("");
/** 本次祭坛只允许附着一次（一次只给一个强化） */
const appliedThisVisit = ref(false);

onMounted(() => {
  if (!run.active) run.startRun();
});

/** 三选一：由 core/map 的 reward 流按节点抽取，再按可附着目标过滤。 */
const offers = computed(() => run.offers(run.enhancementChoices()));
const chosenOffer = computed(() => offers.value.find((o) => o.id === selected.value) ?? null);

function cardName(cardId: string): string {
  return t(`card.${cardId}.name`, cardId);
}
function enhancementName(id: string): string {
  return t(`enh.${id}.name`, id);
}
function enhancementDesc(id: string): string {
  return t(`enh.${id}.desc`, "");
}
function isTarget(deckIndex: number): boolean {
  return chosenOffer.value?.targets.includes(deckIndex) ?? false;
}

function pickOffer(id: string): void {
  if (appliedThisVisit.value) {
    notice.value = "本次祭坛的强化已用掉，继续远征吧";
    return;
  }
  selected.value = selected.value === id ? null : id;
  notice.value = selected.value ? "选择要附着的卡牌（高亮）" : "";
}

function attach(deckIndex: number): void {
  const offer = chosenOffer.value;
  if (!offer) return;
  if (appliedThisVisit.value) {
    notice.value = "本次祭坛的强化已用掉，继续远征吧";
    return;
  }
  if (!isTarget(deckIndex)) {
    notice.value = "该强化只适用于特殊卡（带机制关键词的牌）";
    return;
  }
  if (run.applyEnhancement(deckIndex, offer.id)) {
    notice.value = `${cardName(run.deck[deckIndex].cardId)} 已附着「${enhancementName(offer.id)}」，本次祭坛结束`;
    selected.value = null;
    appliedThisVisit.value = true;
  }
}

/** 重铸（docs/16 P3.4）：随机换一枚同阶强化，耗 5 HP，每座祭坛限 1 次。 */
function doRecast(deckIndex: number): void {
  const result = run.recast(deckIndex);
  if (!result) {
    notice.value = "重铸不可用：HP 需大于 5，且每座祭坛只允许重铸一次";
    return;
  }
  notice.value = result.added
    ? `重铸：${enhancementName(result.removed)} → ${enhancementName(result.added)}`
    : `重铸：移除了「${enhancementName(result.removed)}」，同阶池已无可替换`;
}

function continueExpedition(): void {
  run.advance();
  void router.push("/map");
}

function backToMap(): void {
  void router.push("/map");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage forge-stage">
      <div class="topbar">
        <span>锻造祭坛 · 第一幕</span>
        <div class="r">
          <span @click="backToMap">返回地图</span>
          <span @click="router.push('/')">放弃远征</span>
        </div>
      </div>

      <header class="hd">
        <h1 class="head">锻 造 祭 坛</h1>
        <p class="sub">从三枚强化中选择一枚，附着到一张<em>特殊卡</em>上（每张上限 3 枚）</p>
      </header>

      <div class="columns">
        <section class="col offers">
          <h2>强化 · 三选一</h2>
          <button
            v-for="offer in offers"
            :key="offer.id"
            class="offer"
            :class="[`tier-${offer.tier}`, { active: selected === offer.id, used: appliedThisVisit }]"
            :disabled="appliedThisVisit"
            @click="pickOffer(offer.id)"
          >
            <div class="offer-top">
              <b>{{ enhancementName(offer.id) }}</b>
              <span class="tier">T{{ offer.tier }}</span>
            </div>
            <p>{{ enhancementDesc(offer.id) }}</p>
            <div class="offer-foot">
              <span class="count">可附着 {{ offer.targets.length }} 张</span>
              <span class="mark">{{ selected === offer.id ? "已选中" : "点击选择" }}</span>
            </div>
          </button>
          <p v-if="offers.length === 0" class="empty">当前卡组没有可附着的特殊卡</p>
        </section>

        <section class="col deck">
          <h2>卡组 · {{ run.deckSize }} 张</h2>
          <div class="deck-list">
            <button
              v-for="(card, index) in run.deck"
              :key="index"
              class="deck-card"
              :class="{ targetable: isTarget(index), upgraded: card.upgraded }"
              @click="attach(index)"
            >
              <span class="name">{{ cardName(card.cardId) }}<sup v-if="card.upgraded">+</sup></span>
              <span class="slots">
                <i v-for="n in 3" :key="n" :class="{ on: n <= card.enhancements.length }" />
              </span>
              <span v-if="card.enhancements.length" class="enhs">
                {{ card.enhancements.map(enhancementName).join(" · ") }}
              </span>
            </button>
          </div>
        </section>

        <section class="col recast">
          <h2>重铸 · {{ RECAST_HP_COST }} HP</h2>
          <p class="note">随机移除该卡 1 枚强化，再从同阶池随机换 1 枚（每座祭坛限 1 次，随机洗）</p>
          <button
            v-for="index in run.recastableCards"
            :key="index"
            class="deck-card"
            :disabled="!run.canRecast"
            @click="doRecast(index)"
          >
            <span class="name">{{ cardName(run.deck[index].cardId) }}</span>
            <span class="enhs">{{ run.deck[index].enhancements.map(enhancementName).join(" · ") }}</span>

          </button>
          <p v-if="run.recastableCards.length === 0" class="empty">没有可重铸的卡（同阶已无可换强化）</p>
          <p v-else-if="!run.canRecast" class="empty">本次祭坛已重铸过（或 HP 不足）</p>
        </section>
      </div>

      <div class="bottom">
        <span class="relics">遗物：{{ run.relics.map((r) => t(`relic.${r}.name`, r)).join(" · ") || "无" }}</span>
        <button class="etch-btn go" @click="continueExpedition">继续远征</button>
      </div>

      <div v-if="notice" class="notice">{{ notice }}</div>
    </div>
  </div>
</template>

<style scoped>
.forge-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 48px 26px;
}
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 34px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r {
  display: flex;
  gap: 16px;
}
.topbar .r span {
  cursor: pointer;
}
.topbar .r span:hover {
  color: var(--gold);
}
.hd {
  text-align: center;
}
.head {
  font-family: var(--serif-title);
  font-size: 28px;
  letter-spacing: 0.5em;
  color: var(--gold);
  text-shadow: 0 0 24px rgba(176, 141, 74, 0.35);
}
.sub {
  margin-top: 8px;
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--ink-dim);
}
.sub em {
  color: #7fa6c8;
  font-style: normal;
}
.columns {
  display: flex;
  gap: 26px;
  width: 100%;
  flex: 1;
  margin-top: 18px;
  overflow: hidden;
}
.col {
  background: rgba(18, 16, 14, 0.8);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  box-shadow: var(--panel-shadow);
}
.col h2 {
  font-size: 12px;
  letter-spacing: 0.3em;
  color: var(--gold);
  font-weight: 400;
  margin-bottom: 12px;
}
.offers {
  width: 540px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.offer {
  text-align: left;
  border: 1px solid rgba(176, 141, 74, 0.45);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  background: linear-gradient(160deg, #1f1b16, #12100e);
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover), transform var(--dur-hover);
}
.offer:hover:not(:disabled) {
  transform: translateX(4px);
}
.offer:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.offer.tier-1 {
  border-left-color: #8fa1b5;
}
.offer.tier-2 {
  border-left-color: var(--gold);
}
.offer.tier-3 {
  border-left-color: var(--blood-hi);
}
.offer.active {
  border-color: var(--blood-hi);
  box-shadow: 0 0 20px rgba(192, 57, 43, 0.35);
}
.offer-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.offer-top b {
  font-family: var(--serif-title);
  font-size: 16px;
  letter-spacing: 0.16em;
  color: var(--ink-bone);
  font-weight: 400;
}
.tier {
  font-family: var(--serif-num);
  font-size: 11px;
  color: var(--gold-dim);
}
.offer p {
  font-size: 12px;
  line-height: 1.75;
  color: var(--ink-dim);
  margin: 8px 0 8px;
}
.offer-foot {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  letter-spacing: 0.14em;
}
.count {
  color: var(--gold-dim);
}
.mark {
  color: rgba(154, 144, 129, 0.6);
}
.offer.active .mark {
  color: var(--blood-hi);
}
.empty {
  font-size: 12px;
  color: var(--ink-dim);
  text-align: center;
  margin-top: 18px;
}
.deck {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.deck-list {
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.deck-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 10px;
  align-items: center;
  text-align: left;
  border: 1px solid rgba(110, 88, 54, 0.35);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  background: rgba(10, 8, 6, 0.6);
  transition: border-color var(--dur-hover), background var(--dur-hover), transform var(--dur-hover);
}
.deck-card.targetable {
  border-color: rgba(176, 141, 74, 0.9);
  background: rgba(40, 30, 18, 0.72);
  cursor: pointer;
}
.deck-card.targetable:hover {
  background: rgba(64, 47, 25, 0.9);
  transform: translateX(3px);
}
.name {
  font-size: 13px;
  color: var(--ink-bone);
  letter-spacing: 0.08em;
}
.name sup {
  color: var(--gold);
  font-size: 10px;
}
.slots {
  display: flex;
  gap: 4px;
}
.slots i {
  width: 9px;
  height: 9px;
  border: 1px solid var(--gold-dim);
  transform: rotate(45deg);
  background: rgba(176, 141, 74, 0.12);
}
.slots i.on {
  background: var(--blood-hi);
  border-color: var(--blood-hi);
  box-shadow: 0 0 6px rgba(192, 57, 43, 0.7);
}
.enhs {
  grid-column: 1 / -1;
  font-size: 10px;
  color: var(--gold-dim);
  overflow-wrap: anywhere;
}
.bottom {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}
.relics {
  font-size: 11px;
  color: var(--ink-dim);
  letter-spacing: 0.1em;
}
.go {
  padding: 10px 26px;
  font-size: 13px;
}
.notice {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--blood-hi);
  letter-spacing: 0.15em;
}
</style>
