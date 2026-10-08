<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent, t } from "@/data/load";
import EmberField from "@/ui/components/EmberField.vue";
import LeaderboardModal from "@/ui/components/LeaderboardModal.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import { APP_RELEASE } from "@/ui/build-info";
import { readSlot } from "@/systems/save";

const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);
const router = useRouter();
const run = useRunStore();
const meta = useMetaStore();
const tutorial = useTutorialStore();
/**
 * 进度档：读不出来（迁移作废 / 版本不匹配 / 损坏）返回 null。
 * 甲方 2026-10-08 反馈「继续按钮点不了」——根因是以前只看 slot 在不在，
 * 档本身读不出来时按钮仍是亮的，点了什么都不发生。现在改成「能读出来才算能继续」。
 */
function loadableProgress(): { run?: { legacy?: boolean } } | null {
  return readSlot<{ run?: { legacy?: boolean } } | null>("progress", null);
}
const canContinue = computed(() => {
  const saved = loadableProgress();
  // legacy 档（一幕已通关的旧档）：docs/40 §2.1 不提供继续远征入口
  return saved !== null && saved.run !== undefined && saved.run.legacy !== true;
});
/** 读档失败时给一句明白话，别让按钮像坏了一样（甲方 2026-10-08）。 */
const notice = ref("");
onMounted(() => meta.ensureLoaded());

/**
 * 远征榜（docs/38 §三 C-3 / 甲方 2026-10-08）：
 * 原先嵌在标题页右侧的窄侧栏，现在收进「排行榜」按钮背后的弹窗里
 * （LeaderboardModal）：分难度页签 + 每职业×特性分档记最佳。
 * 这里只留一个「有没有成绩」的判断，用来决定按钮的措辞（有榜可看 / 尚无纪录）。
 */
const hasAnyRecord = computed(() =>
  [...loadGameContent().content.classes.keys()].some(
    (id) =>
      meta.recordsByTrait(id, "normal").length > 0 || meta.recordsByTrait(id, "rust").length > 0,
  ),
);

const leaderboardOpen = ref(false);

type MenuKey = "tutorial" | "expedition" | "continue" | "leaderboard" | "codex" | "settings";

/** 没走完的「第一班岗」（docs/43 Q2）：断点续做，直接回到那一步，不绕教学页。 */
const canResumeTutorial = computed(() => meta.tutorial !== null);

const menu = computed<{ key: MenuKey; label: string; enabled: boolean }[]>(() => [
  ...(canResumeTutorial.value
    ? [{ key: "tutorial" as const, label: "继续第一班岗", enabled: true }]
    : []),
  { key: "expedition", label: "开始远征", enabled: true },
  { key: "continue", label: "继续远征", enabled: canContinue.value },
  { key: "leaderboard", label: "排行榜", enabled: true },
  { key: "codex", label: "图鉴", enabled: true },
  { key: "settings", label: "设置", enabled: true },
]);

function onMenu(key: MenuKey, enabled: boolean): void {
  if (!enabled) return;
  if (key === "settings") void router.push("/settings");
  else if (key === "codex") void router.push("/codex");
  else if (key === "leaderboard") leaderboardOpen.value = true;
  else if (key === "expedition") {
    // 0.5：先走职业选择页，再进图（docs/16 5.3）
    void router.push("/class-select");
  } else if (key === "continue") {
    if (run.load()) void router.push("/map");
    else notice.value = "进度档读不出来（可能来自旧版本）——点「开始远征」开新的一局。";
  } else if (key === "tutorial") {
    if (!tutorial.resume()) return;
    // 战斗章直接回战场；结业章没有战斗，才回教学页
    void router.push(tutorial.isBattleChapter ? "/battle" : "/tutorial");
  }
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage title-stage">
      <EmberField />

      <header class="brand">
        <h1 class="title">锈 与 血</h1>
        <p class="subtitle">RUST &amp; BLOOD · 血肉科技的远征</p>
      </header>

      <p v-if="notice" class="save-notice">{{ notice }}</p>

      <nav class="menu">
        <button
          v-for="item in menu"
          :key="item.key"
          class="etch-btn menu-item"
          :disabled="!item.enabled"
          :title="item.enabled ? item.label : item.label + '（尚未开放）'"
          @click="onMenu(item.key, item.enabled)"
        >
          {{ item.label }}
        </button>
      </nav>

      <!-- 远征榜（甲方 2026-10-08）：收进弹窗，标题页只留一个按钮入口 -->
      <p v-if="hasAnyRecord" class="lb-teaser">
        {{ t("title.record.teaser", "榜上有名——按「排行榜」查看你的远征纪录") }}
      </p>

      <!-- 底栏只留版本号（甲方 2026-10-08）：文档路径与封版日期移到版本总结里，不占标题页 -->
      <footer class="foot">
        <span>v{{ APP_RELEASE }}</span>
      </footer>
    </div>

    <LeaderboardModal v-if="leaderboardOpen" @close="leaderboardOpen = false" />
  </div>
</template>

<style scoped>
.title-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.title-stage::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse 70% 60% at 50% 45%, transparent 60%, rgba(0, 0, 0, 0.7) 100%);
}

.brand {
  position: relative;
  z-index: 2;
  text-align: center;
}

.title {
  font-family: var(--serif-title);
  font-size: 76px;
  font-weight: 600;
  letter-spacing: 0.24em;
  color: var(--ink-bone);
  text-shadow: 0 0 34px rgba(138, 43, 31, 0.55), 0 3px 4px #000;
}

.subtitle {
  margin-top: 14px;
  font-size: 12px;
  letter-spacing: 0.42em;
  color: var(--gold-dim);
}

/* 读档失败提示（甲方 2026-10-08）：别让「继续远征」看起来像坏了 */
.save-notice {
  position: relative;
  z-index: 2;
  margin-top: 18px;
  max-width: 420px;
  font-size: 11px;
  line-height: 1.8;
  letter-spacing: 0.1em;
  text-align: center;
  color: var(--blood-hi);
}

.menu {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 58px;
}

.menu-item {
  width: 268px;
  padding: 13px 22px;
  font-size: 15px;
}
/* 榜上有名的提示（甲方 2026-10-08）：有成绩时给一句轻提示，入口就是「排行榜」按钮 */
.lb-teaser {
  position: relative;
  z-index: 2;
  margin-top: 34px;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--gold-dim);
  opacity: 0.85;
}

.foot {
  position: absolute;
  bottom: 22px;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-dim);
}

.foot .dim {
  color: rgba(154, 144, 129, 0.55);
}
</style>