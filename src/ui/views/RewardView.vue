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

const rewards = ref<string[]>([]);
const node = computed(() => run.current);

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

function cardName(id: string): string {
  return t(`card.${id}.name`, id);
}
function cardDesc(id: string): string {
  return t(`card.${id}.desc`, "");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage reward-stage">
      <template v-if="node?.kind === 'boss'">
        <h1 class="head">远 征 胜 利</h1>
        <p class="sub">锈喉倒下，回廊重归死寂。</p>
        <button class="etch-btn" @click="finishRun">完成远征</button>
      </template>

      <template v-else>
        <h1 class="head">战 利 品</h1>
        <p class="sub">三选一，加入卡组</p>
        <div class="options">
          <button v-for="id in rewards" :key="id" class="option" @click="pick(id)">
            <b>{{ cardName(id) }}</b>
            <p>{{ cardDesc(id) }}</p>
          </button>
          <button class="skip" @click="skip">跳过</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.reward-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.head { font-family: var(--serif-title); font-size: 30px; letter-spacing: 0.5em; color: var(--ink-bone); }
.sub { font-size: 11px; letter-spacing: 0.25em; color: var(--ink-dim); }
.options { display: flex; gap: 18px; margin-top: 18px; }
.option {
  width: 240px; height: 200px; padding: 18px 16px; text-align: left;
  border: 1px solid rgba(176, 141, 74, 0.5); border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1c1915, #12100e);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 10px 26px rgba(0, 0, 0, 0.6);
  transition: transform var(--dur-hover), border-color var(--dur-hover);
}
.option:hover { transform: translateY(-6px); border-color: var(--gold); }
.option b { font-family: var(--serif-title); font-size: 16px; letter-spacing: 0.16em; color: var(--ink-bone); font-weight: 400; }
.option p { margin-top: 12px; font-size: 12px; line-height: 1.8; color: var(--ink-dim); }
.skip { padding: 10px 24px; font-size: 12px; color: var(--ink-dim); letter-spacing: 0.2em; }
.skip:hover { color: var(--gold); }
.etch-btn { padding: 11px 26px; font-size: 13px; }
</style>
