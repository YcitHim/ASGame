<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import EmberField from "@/ui/components/EmberField.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { TUTORIAL_TITLE } from "@/ui/tutorial";

/**
 * 「第一班岗」的章间页面（docs/42 速成版）：课时卡 + 结业。
 * 只有一场战斗，打完即走——幕间、三课、清单全部砍掉。
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
/** 这一课要教的东西（课时卡上先列出来，进场就不慌）。 */
const lessonPoints = computed(() =>
  chapter.value?.kind === "battle"
    ? chapter.value.steps.map((s) => s.why).slice(0, 4)
    : [],
);

onMounted(() => {
  if (!tutorial.active && !tutorial.finished) tutorial.begin();
  // 不自动跳战斗：战斗章停在课时卡上，玩家点「开始」才走（早先会闪一帧兜底页）
}); 

function enterBattle(): void {
  void router.push("/battle");
}

/** 结业：走完最后一章（记完成 / 解锁徽章），然后无缝进正式远征。 */
function graduate(): void {
  tutorial.nextChapter();
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

      <template v-if="chapter">
        <!-- 战斗章：课时卡。停在这里让玩家看清"要学什么"，点了才开始 -->
        <template v-if="chapter.kind === 'battle'">
          <div class="lesson-tag">速 成 课 · 约 3 分 钟</div>
          <h1 class="head">{{ chapter.title }}</h1>
          <p class="theme">「{{ chapter.theme }}」</p>
          <div class="plan">
            <div class="step-row"><b>这一课</b><small>{{ lessonPoints.join(" · ") }}</small></div>
            <div class="step-row"><b>陪练</b><small>{{ enemyNames }}（不会打死你）</small></div>
            <div class="step-row">
              <b>怎么走</b><small>跟着屏幕上方的一句话走，做对了才推进；随时可以点右上角「跳过教学」。</small>
            </div>
          </div>
          <button class="tut-cta main" @click="enterBattle">
            <span class="glyph">▶</span>开 始
          </button>
        </template>

        <!-- 结业 -->
        <template v-else>
          <h1 class="head">{{ chapter.title }}</h1>
          <div class="lines">
            <p v-for="(line, i) in chapter.lines" :key="i">{{ line }}</p>
          </div>
          <button class="tut-cta main" @click="graduate">{{ chapter.cta }}</button>
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
.lesson-tag {
  font-family: var(--serif-title); font-size: 12px; letter-spacing: 0.32em; color: var(--gold-dim);
}
.theme { font-size: 14px; letter-spacing: 0.12em; color: var(--gold); font-style: italic; }
.lines { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
.lines p { font-size: 14px; line-height: 1.9; letter-spacing: 0.1em; color: var(--ink-bone); }
.main { padding: 12px 40px; font-size: 14px; }
/* 课时卡的信息块 */
.plan {
  display: flex; flex-direction: column; gap: 10px;
  width: 640px; padding: 16px 22px;
  text-align: left;
  border: 1px solid rgba(110, 88, 54, 0.4);
  border-radius: var(--radius-md);
  background: rgba(18, 16, 14, 0.72);
}
.step-row { display: flex; gap: 12px; align-items: baseline; }
.step-row b {
  flex: none; width: 76px;
  font-family: var(--serif-title); font-size: 12px; letter-spacing: 0.2em;
  color: var(--gold-dim); font-weight: 400;
}
.step-row b::after { content: "："; }
.step-row small { font-size: 12px; line-height: 1.7; color: var(--ink-dim); letter-spacing: 0.06em; }
</style>
