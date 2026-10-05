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

const mode = ref<"choice" | "upgrade" | "remove">("choice");
const node = computed(() => run.current);
const healAmount = computed(() => Math.round(run.maxHp * 0.3));

onMounted(() => {
  if (!run.active) void router.replace("/");
});

function heal(): void {
  run.rest("heal");
  run.advance();
  void router.push("/map");
}

function chooseUpgrade(): void {
  mode.value = "upgrade";
}

function chooseRemove(): void {
  mode.value = "remove";
}

function doRemove(index: number): void {
  const ok = run.removeCard(index);
  if (!ok) return;
  run.advance();
  void router.push("/map");
}

function doUpgrade(index: number): void {
  const ok = run.upgradeCard(index);
  if (!ok) return;
  run.advance();
  void router.push("/map");
}

function cardName(id: string): string {
  return t(`card.${id}.name`, id);
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage rest-stage">
      <h1 class="head">残 破 圣 坛</h1>
      <p class="sub">HP {{ run.hp }} / {{ run.maxHp }} · 节点 {{ node?.id ?? "" }}</p>

      <template v-if="mode === 'choice'">
        <div class="choices">
          <button class="choice" @click="heal">
            <b>憩息</b>
            <p>回复 <em>{{ healAmount }}</em> 点 HP</p>
          </button>
          <button class="choice" @click="chooseUpgrade">
            <b>打磨</b>
            <p>升级一张卡牌</p>
          </button>
          <button class="choice" @click="chooseRemove">
            <b>剔除</b>
            <p>从卡组移除一张卡牌</p>
          </button>
        </div>
      </template>

      <template v-else-if="mode === 'upgrade'">
        <p class="sub">选择一张卡升级</p>
        <div class="deck">
          <button
            v-for="(card, index) in run.deck"
            :key="index"
            class="deck-card"
            :class="{ upgraded: card.upgraded }"
            :disabled="card.upgraded"
            @click="doUpgrade(index)"
          >
            {{ cardName(card.cardId) }}{{ card.upgraded ? "+（已升级）" : "" }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="sub">选择一张卡移除（卡组至少保留 1 张）</p>
        <div class="deck">
          <button
            v-for="(card, index) in run.deck"
            :key="index"
            class="deck-card"
            :disabled="run.deck.length <= 1"
            @click="doRemove(index)"
          >
            {{ cardName(card.cardId) }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rest-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.head { font-family: var(--serif-title); font-size: 30px; letter-spacing: 0.5em; color: var(--gold); }
.sub { font-size: 11px; letter-spacing: 0.22em; color: var(--ink-dim); }
.choices { display: flex; gap: 20px; margin-top: 16px; }
.choice {
  width: 220px; padding: 22px 18px; text-align: center;
  border: 1px solid rgba(176, 141, 74, 0.5); border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1c1915, #12100e);
  transition: transform var(--dur-hover), border-color var(--dur-hover);
}
.choice:hover { transform: translateY(-6px); border-color: var(--gold); }
.choice b { font-family: var(--serif-title); font-size: 18px; letter-spacing: 0.24em; color: var(--ink-bone); font-weight: 400; }
.choice p { margin-top: 10px; font-size: 12px; color: var(--ink-dim); }
.choice em { color: var(--blood-hi); font-style: normal; }
.deck { display: flex; flex-wrap: wrap; gap: 8px; width: 640px; justify-content: center; margin-top: 10px; }
.deck-card {
  padding: 8px 14px; font-size: 12px; letter-spacing: 0.1em;
  border: 1px solid rgba(110, 88, 54, 0.5); border-radius: var(--radius-sm); color: var(--ink-bone);
}
.deck-card:hover:not(:disabled) { border-color: var(--gold); color: var(--gold); }
.deck-card:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
