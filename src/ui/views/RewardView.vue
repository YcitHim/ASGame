<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import type { CardDefinition } from "@/core/registry";
import { useRunStore } from "@/stores/run";
import CardView from "@/ui/components/CardView.vue";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const rewards = ref<string[]>([]);
const node = computed(() => run.current);

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
  if (node.value?.kind !== "boss") rewards.value = run.cardRewards();
});

function pick(cardId: string): void {
  run.addCard(cardId);
  run.advance();
  void router.push("/map");
}

function finishRun(): void {
  run.advance();
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
      <template v-if="node?.kind === 'boss'">
        <div class="triumph">
          <h1 class="head">远 征 胜 利</h1>
          <p class="sub">锈喉倒下，锈蚀回廊重归死寂。</p>
          <button class="etch-btn" @click="finishRun">完成远征</button>
        </div>
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
.skip {
  padding: 10px 24px;
  font-size: 11px;
  letter-spacing: 0.3em;
  color: var(--ink-dim);
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
</style>
