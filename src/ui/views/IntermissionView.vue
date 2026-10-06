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

type Step = "copy" | "boon" | "upgrade" | "enhance" | "enhance-target";
const step = ref<Step>("copy");
const chosenEnh = ref("");

onMounted(() => {
  if (!run.active) void router.replace("/");
});

const enhancementChoices = computed(() => run.boonEnhancementChoices());
/** C 项可附着目标：任一卡能装下所选项（全满槽 → 该项置灰，docs/40 §2.3） */
const enhanceUsable = computed(() => enhancementChoices.value.length > 0);
function enhanceName(id: string): string {
  return t(`enh.${id}.name`, id);
}
function enhanceDesc(id: string): string {
  return t(`enh.${id}.desc`, "");
}
function canTarget(deckIndex: number): boolean {
  return chosenEnh.value ? run.canApply(chosenEnh.value, deckIndex) : false;
}
function finish(): void {
  void router.push("/map");
}
function pickBoon(kind: "a" | "b" | "c"): void {
  if (kind === "a") {
    run.applyBoon("heal");
    finish();
  } else if (kind === "b") {
    step.value = "upgrade";
  } else if (enhanceUsable.value) {
    step.value = "enhance";
  }
}
function doUpgrade(index: number): void {
  run.applyBoon("upgrade", index);
  finish();
}
function doEnhance(index: number): void {
  run.applyBoon("enhance", index, chosenEnh.value);
  finish();
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage inter-stage">
      <template v-if="step === 'copy'">
        <h1 class="head">{{ t("intermission.act1_to_act2.title", "回 廊 已 尽") }}</h1>
        <p class="body">{{ t("intermission.act1_to_act2.body", "") }}</p>
        <button class="etch-btn" @click="step = 'boon'">继 续 下 潜</button>
      </template>

      <template v-else-if="step === 'boon'">
        <h1 class="head">{{ t("intermission.boon.title", "圣 堂 馈 赠") }}</h1>
        <div class="boons">
          <button class="boon" @click="pickBoon('a')">
            <b>圣水洗礼</b>
            <span>回复一半生命</span>
          </button>
          <button class="boon" @click="pickBoon('b')">
            <b>默记祷文</b>
            <span>免费升级一张牌</span>
          </button>
          <button class="boon" :disabled="!enhanceUsable" @click="pickBoon('c')">
            <b>圣堂锻核</b>
            <span>{{ enhanceUsable ? "获得一枚圣堂强化" : "强化槽全满" }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="step === 'upgrade'">
        <h1 class="head">默 记 祷 文</h1>
        <p class="sub">选择一张牌免费升级</p>
        <div class="deck">
          <button v-for="(card, i) in run.deck" :key="i" class="deck-card" :disabled="card.upgraded" @click="doUpgrade(i)">
            {{ t(`card.${card.cardId}.name`, card.cardId) }}{{ card.upgraded ? "（已升级）" : "" }}
          </button>
        </div>
      </template>

      <template v-else-if="step === 'enhance'">
        <h1 class="head">圣 堂 锻 核</h1>
        <p class="sub">选择一枚圣堂强化</p>
        <div class="boons">
          <button v-for="id in enhancementChoices" :key="id" class="boon" @click="chosenEnh = id; step = 'enhance-target'">
            <b>{{ enhanceName(id) }}</b>
            <span>{{ enhanceDesc(id) }}</span>
          </button>
        </div>
      </template>

      <template v-else>
        <h1 class="head">选 择 附 着 目 标</h1>
        <p class="sub">{{ enhanceName(chosenEnh) }} · 选择一张牌附着</p>
        <div class="deck">
          <button
            v-for="(card, i) in run.deck"
            :key="i"
            class="deck-card"
            :disabled="!canTarget(i)"
            @click="doEnhance(i)"
          >
            {{ t(`card.${card.cardId}.name`, card.cardId) }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.inter-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 40px 60px; }
.head { font-family: var(--serif-title); font-size: 30px; letter-spacing: 0.5em; color: var(--gold); text-align: center; }
.body { max-width: 720px; font-size: 13px; line-height: 2.1; color: var(--ink-bone); text-align: center; }
.sub { font-size: 12px; letter-spacing: 0.2em; color: var(--ink-dim); }
.boons { display: flex; gap: 20px; }
.boon {
  width: 230px; min-height: 96px; padding: 16px; text-align: left;
  border: 1px solid rgba(176, 141, 74, 0.5); border-radius: var(--radius-sm);
  background: linear-gradient(160deg, #1c1915, #12100e);
  display: flex; flex-direction: column; gap: 8px; cursor: pointer;
}
.boon:hover:not(:disabled) { border-color: var(--gold); }
.boon:disabled { opacity: 0.45; cursor: not-allowed; }
.boon b { font-family: var(--serif-title); font-size: 15px; letter-spacing: 0.18em; color: var(--ink-bone); font-weight: 400; }
.boon span { font-size: 11px; line-height: 1.7; color: var(--ink-dim); }
.deck { display: flex; flex-wrap: wrap; gap: 8px; width: 720px; justify-content: center; }
.deck-card { padding: 8px 14px; font-size: 12px; color: var(--ink-bone); border: 1px solid rgba(176, 141, 74, 0.4); border-radius: var(--radius-sm); background: linear-gradient(165deg, #1c1915, #12100e); cursor: pointer; }
.deck-card:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
