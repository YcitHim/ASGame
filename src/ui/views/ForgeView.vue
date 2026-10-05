<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { t } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const selected = ref<string | null>(null);
const notice = ref("");

onMounted(() => {
  if (!run.active) run.startRun();
});

/** 三选一：按 tier 排序后取前三（0.1 强化池共 3 个，正好三选一）。 */
const offers = computed(() => run.offers().slice(0, 3));
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
  if (!chosenOffer.value) return false;
  return chosenOffer.value.targets.includes(deckIndex);
}

function pickOffer(id: string): void {
  selected.value = selected.value === id ? null : id;
  notice.value = selected.value ? "选择要附着的卡牌" : "";
}

function attach(deckIndex: number): void {
  const offer = chosenOffer.value;
  if (!offer) return;
  if (!isTarget(deckIndex)) {
    notice.value = "该强化不适用于此牌";
    return;
  }
  if (run.applyEnhancement(deckIndex, offer.id)) {
    notice.value = `${cardName(run.deck[deckIndex].cardId)} 已附着「${enhancementName(offer.id)}」`;
    selected.value = null;
  }
}

function continueExpedition(): void {
  run.advanceEncounter();
  void router.push("/battle");
}

function backToBattle(): void {
  void router.push("/battle");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage forge-stage">
      <div class="topbar">
        <span>锻造祭坛 · 第一幕</span>
        <div class="r">
          <span @click="backToBattle">返回战斗</span>
          <span @click="router.push('/')">放弃远征</span>
        </div>
      </div>

      <h1 class="head">锻 造 祭 坛</h1>
      <p class="sub">选择一枚强化，附着到一张卡牌上（每张上限 3 枚）</p>

      <div class="columns">
        <section class="col offers">
          <h2>强化 · 三选一</h2>
          <button
            v-for="offer in offers"
            :key="offer.id"
            class="offer"
            :class="{ active: selected === offer.id }"
            @click="pickOffer(offer.id)"
          >
            <div class="offer-top">
              <b>{{ enhancementName(offer.id) }}</b>
              <span class="tier">T{{ offer.tier }}</span>
            </div>
            <p>{{ enhancementDesc(offer.id) }}</p>
            <small>可附着 {{ offer.targets.length }} 张</small>
          </button>
          <p v-if="offers.length === 0" class="empty">没有可附着的强化</p>
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
              <span class="name">{{ cardName(card.cardId) }}{{ card.upgraded ? "+" : "" }}</span>
              <span class="slots">
                <i v-for="n in 3" :key="n" :class="{ on: n <= card.enhancements.length }" />
              </span>
              <span v-if="card.enhancements.length" class="enhs">
                {{ card.enhancements.map(enhancementName).join(" · ") }}
              </span>
            </button>
          </div>
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
  padding: 34px 44px 24px;
}
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r { display: flex; gap: 16px; }
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }
.head {
  font-family: var(--serif-title); font-size: 30px; letter-spacing: 0.5em; color: var(--ink-bone); margin-top: 8px;
}
.sub { font-size: 11px; letter-spacing: 0.2em; color: var(--ink-dim); margin-top: 8px; }
.columns { display: flex; gap: 28px; width: 100%; flex: 1; margin-top: 22px; overflow: hidden; }
.col { background: rgba(18, 16, 14, 0.8); border: 1px solid var(--edge-gold); border-radius: var(--radius-sm); padding: 14px 16px; box-shadow: var(--panel-shadow); }
.col h2 { font-size: 12px; letter-spacing: 0.3em; color: var(--gold); font-weight: 400; margin-bottom: 12px; }
.offers { width: 520px; display: flex; flex-direction: column; gap: 12px; }
.offer {
  text-align: left; border: 1px solid rgba(176, 141, 74, 0.45); border-radius: var(--radius-sm);
  padding: 12px 14px; background: linear-gradient(160deg, #1c1915, #12100e);
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover);
}
.offer:hover { border-color: var(--gold); }
.offer.active { border-color: var(--blood-hi); box-shadow: 0 0 18px rgba(192, 57, 43, 0.35); }
.offer-top { display: flex; justify-content: space-between; align-items: center; }
.offer-top b { font-family: var(--serif-title); font-size: 16px; letter-spacing: 0.15em; color: var(--ink-bone); }
.tier { font-family: var(--serif-num); font-size: 11px; color: var(--gold-dim); }
.offer p { font-size: 12px; line-height: 1.7; color: var(--ink-dim); margin: 8px 0 6px; }
.offer small { font-size: 10px; color: var(--gold-dim); }
.deck { flex: 1; display: flex; flex-direction: column; }
.deck-list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.deck-card {
  display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: center; text-align: left;
  border: 1px solid rgba(110, 88, 54, 0.35); border-radius: var(--radius-sm);
  padding: 6px 10px; background: rgba(10, 8, 6, 0.6);
  transition: border-color var(--dur-hover), background var(--dur-hover);
}
.deck-card.targetable { border-color: rgba(176, 141, 74, 0.9); background: rgba(40, 30, 18, 0.7); cursor: pointer; }
.deck-card.targetable:hover { background: rgba(60, 44, 24, 0.85); }
.name { font-size: 13px; color: var(--ink-bone); letter-spacing: 0.08em; }
.slots { display: flex; gap: 4px; }
.slots i { width: 9px; height: 9px; border: 1px solid var(--gold-dim); transform: rotate(45deg); background: rgba(176, 141, 74, 0.12); }
.slots i.on { background: var(--blood-hi); border-color: var(--blood-hi); box-shadow: 0 0 6px rgba(192, 57, 43, 0.7); }
.enhs { grid-column: 1 / -1; font-size: 10px; color: var(--gold-dim); }
.bottom { width: 100%; display: flex; align-items: center; justify-content: space-between; margin-top: 18px; }
.relics { font-size: 11px; color: var(--ink-dim); letter-spacing: 0.1em; }
.go { padding: 10px 26px; font-size: 13px; }
.notice { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--blood-hi); letter-spacing: 0.15em; }
</style>
