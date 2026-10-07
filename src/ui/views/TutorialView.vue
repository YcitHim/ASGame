<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import { useStageFit } from "@/ui/composables/useStageFit";
import { useTemplateRef } from "vue";
import { TUTORIAL_STAGES, tutorialStage } from "@/ui/tutorial";
import EmberField from "@/ui/components/EmberField.vue";

/**
 * 教学遭遇战的入口与结算页（docs/41 §4.3）。
 * 全程可跳过；完成不给任何数值/内容奖励，只在图鉴解锁「引路人」。
 */
const router = useRouter();
const tutorial = useTutorialStore();
const run = useRunStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const game = loadGameContent();
const current = computed(() => tutorialStage(tutorial.stageIndex));
const enemyNames = computed(() =>
  (current.value?.enemies ?? []).map((id) => game.content.enemies.get(id)?.name ?? id).join(" · "),
);

onMounted(() => {
  // 从首页「要人带路吗？」进来时已 begin；从设置页重看则在这里补一次
  if (!tutorial.active) tutorial.begin();
});

function start(): void {
  void router.push("/battle");
}

/** 教学退出：已经开了局就继续远征，否则回标题。 */
function leave(): void {
  tutorial.abort();
  void router.push(run.active ? "/map" : "/");
}

function abort(): void {
  leave();
}

/** 完成三场后的收尾：回到远征（不给奖励）。 */
function finish(): void {
  leave();
}

/** 用当前所选职业的起始卡组（教学里出现的牌就是他真正要用的牌）。 */
const deckNames = computed(() => {
  const cls = run.classDef ?? [...game.content.classes.values()][0];
  return (cls?.startDeck ?? []).map((id) => game.i18n[`card.${id}.name`] ?? id).join(" · ");
});

</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage tutorial-stage">
      <EmberField />

      <div class="topbar">
        <span>教 学 遭 遇 战</span>
        <div class="r">
          <span @click="abort">跳过教学</span>
        </div>
      </div>

      <template v-if="tutorial.finished">
        <h1 class="head">走 完 了</h1>
        <p class="sub">三场演武到此为止。剩下的交给远征。</p>
        <p class="sub dim">图鉴已解锁徽章「引路人」。教学不发放任何奖励——它只是带路。</p>
        <button class="etch-btn main" @click="finish">{{ run.active ? "继 续 远 征" : "返 回 标 题" }}</button>
      </template>

      <template v-else-if="current">
        <h1 class="head">{{ current.title }}</h1>
        <p class="sub">{{ current.theme }}</p>

        <div class="plan">
          <div class="step-row">
            <b>第 {{ tutorial.stageIndex + 1 }} / {{ TUTORIAL_STAGES.length }} 场</b>
            <small>{{ TUTORIAL_STAGES.map((s) => s.title).join(" → ") }}</small>
          </div>
          <div class="step-row">
            <b>对手</b>
            <small>{{ enemyNames }}</small>
          </div>
          <div class="step-row">
            <b>你的卡组</b>
            <small>{{ deckNames || "（未选职业：将使用默认职业）" }}</small>
          </div>
          <div class="step-row">
            <b>这一场怎么走</b>
            <small>跟着屏幕上的一句话提示走，做对了才会推进；随时可以点右上角跳过。</small>
          </div>
        </div>

        <button class="etch-btn main" @click="start">开 始</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tutorial-stage {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; padding: 60px;
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
  font-family: var(--serif-title); font-size: 38px; letter-spacing: 0.4em;
  color: var(--gold); font-weight: 600; text-shadow: 0 0 30px rgba(176, 141, 74, 0.4);
}
.sub { font-size: 13px; letter-spacing: 0.16em; color: var(--ink-bone); }
.sub.dim { color: var(--ink-dim); font-size: 12px; }
.plan {
  display: flex; flex-direction: column; gap: 10px;
  width: 620px; padding: 18px 22px;
  border: 1px solid rgba(110, 88, 54, 0.4); border-radius: var(--radius-md);
  background: rgba(18, 16, 14, 0.72);
}
.step-row { display: flex; gap: 14px; align-items: baseline; text-align: left; }
.step-row b {
  flex: none; width: 92px;
  font-family: var(--serif-title); font-size: 12px; letter-spacing: 0.2em; color: var(--gold-dim); font-weight: 400;
}
.step-row small { font-size: 12px; line-height: 1.7; color: var(--ink-dim); letter-spacing: 0.06em; }
.main { padding: 12px 40px; font-size: 14px; }
</style>
