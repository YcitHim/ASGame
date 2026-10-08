<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent, t } from "@/data/load";
import EmberField from "@/ui/components/EmberField.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import { APP_RELEASE, SEAL_DATE } from "@/ui/build-info";
import { hasSlot, readSlot } from "@/systems/save";

const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);
const router = useRouter();
const run = useRunStore();
const meta = useMetaStore();
const tutorial = useTutorialStore();
/** legacy 档（一幕已通关的旧档）：docs/40 §2.1 不提供继续远征入口。 */
function isLegacySave(): boolean {
  const saved = readSlot<{ run?: { legacy?: boolean } } | null>("progress", null);
  return saved?.run?.legacy === true;
}
const canContinue = computed(() => hasSlot("progress") && !isLegacySave());
onMounted(() => meta.ensureLoaded());

/**
 * 远征纪事（docs/38 §三 C-3 / 甲方 2026-10-08）：每职业**分难度**记最佳纪录——
 * 普通与锈蚀各一栏，两个榜互不覆盖。
 */
const recordRows = computed(() =>
  [...loadGameContent().content.classes.keys()].map((id) => ({
    id,
    name: t(`class.${id}.name`, id),
    normal: meta.recordOf(id, "normal"),
    rust: meta.recordOf(id, "rust"),
  })),
);
/** 锈蚀栏：难度解锁后常驻；未解锁时只要有旧记录也照常显示（不藏玩家自己的成绩）。 */
const showRustRecord = computed(
  () => meta.rustUnlocked || recordRows.value.some((r) => r.rust.minTurns !== null || r.rust.maxHp !== null),
);

type MenuKey = "tutorial" | "expedition" | "continue" | "codex" | "settings";

/** 没走完的「第一班岗」（docs/43 Q2）：断点续做，直接回到那一步，不绕教学页。 */
const canResumeTutorial = computed(() => meta.tutorial !== null);

const menu = computed<{ key: MenuKey; label: string; enabled: boolean }[]>(() => [
  ...(canResumeTutorial.value
    ? [{ key: "tutorial" as const, label: "继续第一班岗", enabled: true }]
    : []),
  { key: "expedition", label: "开始远征", enabled: true },
  { key: "continue", label: "继续远征", enabled: canContinue.value },
  { key: "codex", label: "图鉴", enabled: true },
  { key: "settings", label: "设置", enabled: true },
]);

function onMenu(key: MenuKey, enabled: boolean): void {
  if (!enabled) return;
  if (key === "settings") void router.push("/settings");
  else if (key === "codex") void router.push("/codex");
  else if (key === "expedition") {
    // 0.5：先走职业选择页，再进图（docs/16 5.3）
    void router.push("/class-select");
  } else if (key === "continue") {
    if (run.load()) void router.push("/map");
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

      <section v-if="recordRows.length" class="records">
        <h2>{{ t("title.records", "远征纪事") }}</h2>
        <div class="record-rows">
          <div v-for="row in recordRows" :key="row.id" class="record">
            <span class="rname">{{ row.name }}</span>
            <span class="rlines">
              <span class="rline">
                <em class="rdiff">{{ t("title.record.normal", "普通") }}</em>
                {{ t("title.record.turns", "最少回合") }}
                {{ row.normal.minTurns ?? t("title.record.empty", "—") }}
                · {{ t("title.record.hp", "最高余血") }}
                {{ row.normal.maxHp ?? t("title.record.empty", "—") }}
              </span>
              <span v-if="showRustRecord" class="rline rust">
                <em class="rdiff rust">{{ t("title.record.rust", "锈蚀") }}</em>
                {{ t("title.record.turns", "最少回合") }}
                {{ row.rust.minTurns ?? t("title.record.empty", "—") }}
                · {{ t("title.record.hp", "最高余血") }}
                {{ row.rust.maxHp ?? t("title.record.empty", "—") }}
              </span>
            </span>
          </div>
        </div>
      </section>

      <footer class="foot">
        <span>{{ APP_RELEASE }} 封版 · {{ SEAL_DATE }}</span>
        <span class="dim">docs/program/{{ APP_RELEASE }}版本总结.md · 效果图 docs/mockups/battle-screen.html</span>
      </footer>
    </div>
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
.records {
  position: relative;
  z-index: 2;
  margin-top: 26px;
  text-align: center;
}
.records h2 {
  font-family: var(--serif-title);
  font-size: 12px;
  letter-spacing: 0.42em;
  color: var(--gold-dim);
  font-weight: 400;
}
.record-rows {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.record {
  display: flex;
  gap: 16px;
  justify-content: center;
  font-size: 11px;
  color: var(--ink-dim);
  letter-spacing: 0.1em;
}
.record .rname {
  width: 88px;
  text-align: right;
  color: var(--ink-bone);
}
.rlines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.record .rline {
  font-family: var(--serif-num);
}
.record .rline.rust {
  color: rgba(154, 144, 129, 0.75);
}
.record .rdiff {
  margin-right: 6px;
  font-style: normal;
  color: var(--gold-dim);
}
.record .rdiff.rust {
  color: var(--blood-hi);
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