<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { useRunStore, REST_HEAL_RATIO } from "@/stores/run";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";
import CardView from "@/ui/components/CardView.vue";
import CardUpgradeDialog from "@/ui/components/CardUpgradeDialog.vue";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const tips = useTipsStore();
const tutorial = useTutorialStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const mode = ref<"choice" | "upgrade" | "remove">("choice");
const node = computed(() => run.current);
const healAmount = computed(() => Math.round(run.maxHp * REST_HEAL_RATIO));

onMounted(() => {
  if (!run.ensureActive()) {
    void router.replace("/");
    return;
  }
  // 首遇提示（docs/42 §五）：篝火能干什么
  tips.triggerUnlessTaught("rest", tutorial.finished);
});

function heal(): void {
  run.rest("heal");
  run.advance();
  void router.push("/map");
}

/**
 * 升级对照（甲方 2026-10-08）：卡组先按**原版**摆出来，点开一张才弹「原版 vs 升级后」，
 * 看清了再按「升级这张」——和幕间「默记祷文」共用同一个 CardUpgradeDialog。
 */
const previewIndex = ref<number | null>(null);
const previewCard = computed(() => (previewIndex.value === null ? null : run.deck[previewIndex.value] ?? null));

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

/** 对照浮层里点「升级这张」才真正落地。 */
function confirmUpgrade(): void {
  if (previewIndex.value === null) return;
  doUpgrade(previewIndex.value);
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
        <p class="sub">点击卡牌查看升级后的效果 —— 看清再决定升不升</p>
        <div class="upgrade-grid">
          <button
            v-for="(card, index) in run.deck"
            :key="index"
            class="upgrade-card"
            :class="{ upgraded: card.upgraded }"
            :disabled="card.upgraded"
            @click="previewIndex = index"
          >
            <span class="cap">{{ card.upgraded ? "已升级" : "查看升级" }}</span>
            <CardView
              :card-id="card.cardId"
              :cost="run.cardDef(card.cardId)?.cost ?? 0"
              :charge-cost="run.cardDef(card.cardId)?.chargeCost ?? 0"
              :keywords="run.cardDef(card.cardId)?.keywords ?? []"
              :type="run.cardDef(card.cardId)?.type ?? 'skill'"
              :rarity="run.cardDef(card.cardId)?.rarity ?? 'common'"
              :playable="true"
              :selected="false"
              :index="0"
              :hand-count="1"
              :upgraded="card.upgraded"
              :enhancements="card.enhancements.length"
              :enhancement-ids="card.enhancements"
              display
            />
          </button>
        </div>
      </template>

      <template v-else>
        <p class="sub">点击卡牌将其移出卡组 —— 卡面看清了再点（卡组至少保留 1 张）</p>
        <div class="upgrade-grid">
          <button
            v-for="(card, index) in run.deck"
            :key="index"
            class="upgrade-card"
            :disabled="run.deck.length <= 1"
            @click="doRemove(index)"
          >
            <span class="cap">剔 除</span>
            <CardView
              :card-id="card.cardId"
              :cost="run.cardDef(card.cardId)?.cost ?? 0"
              :charge-cost="run.cardDef(card.cardId)?.chargeCost ?? 0"
              :keywords="run.cardDef(card.cardId)?.keywords ?? []"
              :type="run.cardDef(card.cardId)?.type ?? 'skill'"
              :rarity="run.cardDef(card.cardId)?.rarity ?? 'common'"
              :playable="true"
              :selected="false"
              :index="0"
              :hand-count="1"
              :upgraded="card.upgraded"
              :enhancements="card.enhancements.length"
              :enhancement-ids="card.enhancements"
              display
            />
          </button>
        </div>
      </template>
    </div>

    <!-- 升级对照（甲方 2026-10-08）：点开一张牌先看原版 vs 升级后，确认才升 -->
    <CardUpgradeDialog
      v-if="mode === 'upgrade' && previewCard"
      :card-id="previewCard.cardId"
      @confirm="confirmUpgrade"
      @cancel="previewIndex = null"
    />
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
.upgrade-grid {
  display: flex; flex-wrap: wrap; gap: 14px 16px;
  justify-content: center;
  width: 1040px; max-height: 470px;
  overflow-y: auto;
  padding: 18px 6px 6px;
}
.upgrade-card {
  position: relative;
  padding: 0; background: none; border: none; cursor: pointer;
}
.upgrade-card:disabled { opacity: 0.45; cursor: default; }
.upgrade-card .cap {
  position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  font-size: 10px; letter-spacing: 0.2em; color: var(--gold-dim); white-space: nowrap;
}
.upgrade-card.upgraded .cap { color: var(--ink-dim); }
</style>
