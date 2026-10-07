<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import EmberField from "@/ui/components/EmberField.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { TUTORIAL_TITLE, tutorialChapter } from "@/ui/tutorial";

/**
 * 「第一班岗」的章间页面（docs/42）：序章 / 幕间 A 奖励 / 幕间 B 地图与篝火 / 结业。
 * 战斗章由 BattleView 承担，本页只在非战斗章显示。
 */
const router = useRouter();
const tutorial = useTutorialStore();
const run = useRunStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const game = loadGameContent();
const chapter = computed(() => tutorial.chapter);

const enemyNames = computed(() =>
  (chapter.value?.kind === "battle" ? chapter.value.enemies : [])
    .map((id) => game.content.enemies.get(id)?.name ?? id)
    .join(" · "),
);

onMounted(() => {
  // 从首页/设置页进来时已 begin；直接访问 /tutorial 时补一次
  if (!tutorial.active && !tutorial.finished) tutorial.begin();
  // 战斗章交给 BattleView
  if (tutorial.active && chapter.value?.kind === "battle") void router.replace("/battle");
});

function enterBattle(): void {
  void router.push("/battle");
}

function cardName(id: string): string {
  return game.i18n[`card.${id}.name`] ?? id;
}

/** 序章等纯文本章：点 CTA 进下一章（下一章是战斗就交给 BattleView）。 */
function nextFromScreen(): void {
  const hasNext = tutorial.nextChapter();
  if (!hasNext) void router.push("/tutorial");
  else if (chapter.value?.kind === "battle") enterBattle();
}

function takeReward(id: string): void {
  tutorial.takeReward(id);
  const hasNext = tutorial.nextChapter();
  if (!hasNext) void router.push("/tutorial");
  else if (chapter.value?.kind === "battle") enterBattle();
}

/** 结业 → 无缝进正式远征第一层（不回首页：教学是这一局的序章）。 */
function finish(): void {
  tutorial.abort();
  void router.push(run.active ? "/map" : "/");
}

function leave(): void {
  tutorial.abort();
  void router.push(run.active ? "/map" : "/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage tutorial-stage">
      <EmberField />

      <div class="topbar">
        <span>{{ TUTORIAL_TITLE }}</span>
        <div class="r"><span @click="leave">跳过教学</span></div>
      </div>

      <!-- 结业（docs/42 §三.8） -->
      <template v-if="tutorial.finished">
        <h1 class="head">结 业</h1>
        <ul class="checklist">
          <li v-for="(line, i) in (chapter ?? tutorialChapter(6)) && (tutorialChapter(6) as { checklist?: readonly string[] })?.checklist" :key="i">
            <span class="tick">✓</span>{{ line }}
          </li>
        </ul>
        <p class="sub dim">这班你值完了。往后的岗，自己站——忘了就翻图鉴，或者从设置里再叫我。</p>
        <button class="etch-btn main" @click="finish">开 始 远 征</button>
      </template>

      <template v-else-if="chapter">
        <!-- 序章 / 一般幕间 -->
        <h1 class="head">{{ chapter.title }}</h1>
        <div v-if="chapter.kind === 'screen' || chapter.kind === 'graduation'" class="lines">
          <p v-for="(line, i) in chapter.lines" :key="i">{{ line }}</p>
        </div>
        <button v-if="chapter.kind === 'screen'" class="etch-btn main" @click="nextFromScreen">
          {{ chapter.cta }}
        </button>

        <!-- 战斗章（理论上会跳到 /battle，这里兜底） -->
        <template v-else-if="chapter.kind === 'battle'">
          <p class="sub">{{ chapter.theme }}</p>
          <p class="sub dim">对手：{{ enemyNames }}</p>
          <button class="etch-btn main" @click="enterBattle">进 入</button>
        </template>

        <!-- 幕间 A：三选一（按职业固定候选） -->
        <template v-else-if="chapter.kind === 'reward'">
          <div class="lines">
            <p v-for="(line, i) in chapter.lines" :key="i">{{ line }}</p>
          </div>
          <div class="offers">
            <button v-for="id in tutorial.rewardOffers" :key="id" class="offer" @click="takeReward(id)">
              <b>{{ cardName(id) }}</b>
              <small>{{ chapter.comments[id] ?? "" }}</small>
              <span class="pick">拿 走</span>
            </button>
          </div>
        </template>

        <!-- 幕间 B：地图选路 → 篝火二选一 -->
        <template v-else-if="chapter.kind === 'map'">
          <div class="lines">
            <p v-for="(line, i) in chapter.lines" :key="i">{{ line }}</p>
          </div>
          <div v-if="!tutorial.restChoiceOpen" class="offers">
            <button v-for="node in chapter.nodes" :key="node.id" class="offer" @click="tutorial.chooseMapNode(node.id)">
              <b>{{ node.label }}</b>
              <small>{{ node.note }}</small>
              <span class="pick">走 这 条</span>
            </button>
          </div>
          <div v-else class="rest">
            <div class="lines">
              <p v-for="(line, i) in chapter.restLines" :key="i">{{ line }}</p>
            </div>
            <div class="offers">
              <button class="offer" @click="tutorial.restHeal()">
                <b>{{ chapter.restHeal }}</b>
                <small>把血补回来，稳妥地往上走。</small>
                <span class="pick">选 它</span>
              </button>
              <button class="offer" @click="tutorial.restUpgrade()">
                <b>{{ chapter.restUpgrade }}</b>
                <small>永久强化一张牌——代价是这段路只能这么过。</small>
                <span class="pick">选 它</span>
              </button>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tutorial-stage {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px; padding: 60px;
  text-align: center;
}
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.3em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }
.head {
  font-family: var(--serif-title); font-size: 34px; letter-spacing: 0.4em;
  color: var(--gold); font-weight: 600; text-shadow: 0 0 30px rgba(176, 141, 74, 0.4);
}
.lines { display: flex; flex-direction: column; gap: 8px; max-width: 760px; }
.lines p { font-size: 14px; line-height: 1.9; letter-spacing: 0.1em; color: var(--ink-bone); }
.sub { font-size: 13px; letter-spacing: 0.16em; color: var(--ink-bone); }
.sub.dim { color: var(--ink-dim); font-size: 12px; }
.main { padding: 12px 40px; font-size: 14px; }
.offers { display: flex; gap: 16px; margin-top: 6px; }
.offer {
  width: 240px; padding: 16px 18px; text-align: left;
  display: flex; flex-direction: column; gap: 8px;
  background: rgba(18, 16, 14, 0.86);
  border: 1px solid rgba(110, 88, 54, 0.5); border-radius: var(--radius-md);
  transition: border-color 150ms ease-out, transform 150ms ease-out;
}
.offer:hover { border-color: var(--gold); transform: translateY(-2px); }
.offer b { font-family: var(--serif-title); font-size: 15px; letter-spacing: 0.18em; color: var(--ink-bone); font-weight: 400; }
.offer small { font-size: 11px; line-height: 1.7; color: var(--ink-dim); letter-spacing: 0.04em; }
.offer .pick { margin-top: auto; font-size: 11px; letter-spacing: 0.2em; color: var(--gold-dim); }
.checklist {
  list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 34px;
  max-width: 720px; margin: 4px 0;
}
.checklist li {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; letter-spacing: 0.1em; color: var(--ink-bone); text-align: left;
}
.tick { color: var(--gold); font-family: var(--serif-num); }
.rest { display: flex; flex-direction: column; align-items: center; gap: 12px; }
</style>
