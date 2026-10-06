<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent, t } from "@/data/load";
import { relicPool, type RunDifficulty } from "@/core/map";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const meta = useMetaStore();
/** 难度档（docs/36 T2）：锈蚀需通关一次解锁 */
const difficulty = ref<RunDifficulty>("normal");
const rustLocked = computed(() => !meta.rustUnlocked);

function pickDifficulty(next: RunDifficulty): void {
  if (next === "rust" && rustLocked.value) return;
  difficulty.value = next;
}
function difficultyDesc(): string {
  return difficulty.value === "rust" ? t("difficulty.rust.desc", "") : "";
}
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

onMounted(() => {
  meta.ensureLoaded();
  // 随身遗物必选：默认选中 T1 池首件（docs/38 §一 A-2）
  const pool = companionPool.value;
  if (!companion.value && pool.length > 0) companion.value = pool.includes("blood_pump") ? "blood_pump" : pool[0];
});

const classes = computed(() => [...loadGameContent().content.classes.values()]);

/** 随身遗物（docs/38 §一 A-2）：T1 起始池横排自选，不允许跳过。 */
const companion = ref("");
const companionPool = computed(() => relicPool(loadGameContent().content, 1, meta.unlocked));
const companionDef = computed(() =>
  companionPool.value.includes(companion.value) ? companion.value : (companionPool.value[0] ?? ""),
);
function companionName(id: string): string {
  return t(`relic.${id}.name`, id);
}
function companionDesc(id: string): string {
  return t(`relic.${id}.desc`, "");
}
function companionFlavor(id: string): string {
  return t(`relic.${id}.flavor`, "");
}

function isUnlocked(classId: string): boolean {
  const def = loadGameContent().content.classes.get(classId);
  return meta.isUnlocked(def?.unlock);
}

function cardName(id: string): string {
  return t(`card.${id}.name`, id);
}
function relicName(id: string): string {
  return t(`relic.${id}.name`, id);
}

function choose(classId: string): void {
  if (!isUnlocked(classId)) return;
  run.startRun(classId, undefined, difficulty.value, companionDef.value);
  void router.push("/map");
}

function back(): void {
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage class-stage">
      <div class="topbar">
        <span>开始远征</span>
        <div class="r"><span @click="back">返回标题</span></div>
      </div>

      <h1 class="head">{{ t("class.select.title", "选择你的朝圣之路") }}</h1>

      <div class="depth">
        <span class="depth-label">{{ t("difficulty.title", "选择深度") }}</span>
        <button
          class="depth-btn"
          :class="{ on: difficulty === 'normal' }"
          @click="pickDifficulty('normal')"
        >
          {{ t("difficulty.normal", "普通") }}
        </button>
        <button
          class="depth-btn"
          :class="{ on: difficulty === 'rust', locked: rustLocked }"
          :disabled="rustLocked"
          :title="rustLocked ? t('difficulty.rust.locked', '') : ''"
          @click="pickDifficulty('rust')"
        >
          {{ t("difficulty.rust", "锈蚀难度") }}
        </button>
        <span v-if="rustLocked" class="depth-desc locked">{{ t("difficulty.rust.locked", "") }}</span>
        <span v-else-if="difficultyDesc()" class="depth-desc">{{ difficultyDesc() }}</span>
      </div>

      <!-- 随身遗物（docs/38 §一 A-2）：T1 起始池必选一件 -->
      <div class="companion">
        <div class="companion-head">
          <span class="depth-label">{{ t("class.companion.title", "随身遗物") }}</span>
          <span class="companion-hint">{{ t("class.companion.hint", "") }}</span>
        </div>
        <div class="companion-row">
          <button
            v-for="id in companionPool"
            :key="id"
            class="companion-item"
            :class="{ on: companionDef === id }"
            :title="companionName(id) + '：' + companionDesc(id)"
            @click="companion = id"
          >
            {{ companionName(id) }}
          </button>
        </div>
        <div v-if="companionDef" class="companion-detail">
          <b>{{ companionName(companionDef) }}</b>
          <span>{{ companionDesc(companionDef) }}</span>
          <em>{{ companionFlavor(companionDef) }}</em>
        </div>
      </div>

      <div class="classes">
        <article
          v-for="cls in classes"
          :key="cls.id"
          class="cls"
          :class="{ locked: !isUnlocked(cls.id) }"
        >
          <header>
            <h2>{{ isUnlocked(cls.id) ? t(cls.i18n + '.name', cls.id) : "？？？" }}</h2>
            <p class="title">{{ t(cls.i18n + '.title', '') }}</p>
          </header>
          <p class="intro">
            {{ isUnlocked(cls.id) ? t(cls.i18n + '.intro', '') : t(cls.i18n + '.locked', '尚未解锁。') }}
          </p>

          <template v-if="isUnlocked(cls.id)">
            <div class="stat">
              <span>HP {{ cls.player.maxHp }}</span>
              <span>能量 {{ cls.player.energy }}</span>
            </div>
            <div class="block">
              <b>起始卡组</b>
              <p>{{ cls.startDeck.map(cardName).join(" · ") }}</p>
            </div>
            <div class="block">
              <b>起始遗物</b>
              <p>{{ (cls.startRelics ?? []).map(relicName).join(" · ") || "无" }}</p>
            </div>
            <button class="etch-btn go" @click="choose(cls.id)">选 择</button>
          </template>
          <button v-else class="etch-btn go" disabled>未 解 锁</button>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.class-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 44px 60px 24px;
}
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.22em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }
.head { font-family: var(--serif-title); font-size: 28px; letter-spacing: 0.42em; color: var(--ink-bone); }
.depth { display: flex; align-items: center; gap: 12px; }
.depth-label { font-size: 11px; letter-spacing: 0.24em; color: var(--ink-dim); }
.depth-btn {
  padding: 6px 16px; font-size: 12px; letter-spacing: 0.16em;
  color: var(--ink-dim); background: rgba(18, 16, 14, 0.7);
  border: 1px solid rgba(110, 88, 54, 0.4); border-radius: var(--radius-sm);
  cursor: pointer; transition: border-color var(--dur-hover), color var(--dur-hover);
}
.depth-btn:hover:not(:disabled) { border-color: var(--gold); color: var(--gold); }
.depth-btn.on { border-color: var(--gold); color: var(--gold); box-shadow: 0 0 12px rgba(176, 141, 74, 0.24); }
.depth-btn.locked { opacity: 0.45; cursor: not-allowed; }
.depth-desc { font-size: 11px; color: var(--gold-dim); letter-spacing: 0.1em; }
.depth-desc.locked { color: var(--ink-dim); }
.companion { display: flex; flex-direction: column; align-items: center; gap: 7px; }
.companion-head { display: flex; align-items: center; gap: 12px; }
.companion-hint { font-size: 11px; color: var(--ink-dim); letter-spacing: 0.08em; }
.companion-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; max-width: 900px; }
.companion-item {
  padding: 5px 12px; font-size: 11px; letter-spacing: 0.1em;
  color: var(--ink-dim); background: rgba(18, 16, 14, 0.7);
  border: 1px solid rgba(110, 88, 54, 0.4); border-radius: var(--radius-sm);
  cursor: pointer; transition: border-color var(--dur-hover), color var(--dur-hover);
}
.companion-item:hover { border-color: var(--gold); color: var(--gold); }
.companion-item.on {
  border-color: var(--gold); color: var(--gold);
  box-shadow: 0 0 12px rgba(176, 141, 74, 0.24);
}
.companion-detail { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 46px; }
.companion-detail b { font-family: var(--serif-title); font-size: 12px; letter-spacing: 0.16em; color: var(--ink-bone); font-weight: 400; }
.companion-detail span { font-size: 11px; color: var(--ink-dim); }
.companion-detail em { font-style: normal; font-size: 10px; color: var(--gold-dim); letter-spacing: 0.08em; }
.classes { display: flex; gap: 34px; }
.cls {
  width: 380px;
  min-height: 400px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px 22px 20px;
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1c1915, #12100e 65%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 16px 36px rgba(0, 0, 0, 0.6);
}
.cls.locked { opacity: 0.5; filter: saturate(0.4); }
.cls h2 { font-family: var(--serif-title); font-size: 22px; letter-spacing: 0.24em; color: var(--ink-bone); font-weight: 400; }
.cls .title { margin-top: 5px; font-size: 11px; letter-spacing: 0.16em; color: var(--gold-dim); }
.cls .intro { margin-top: 6px; font-size: 12px; line-height: 1.8; color: var(--ink-dim); }
.stat { display: flex; gap: 18px; font-family: var(--serif-num); font-size: 13px; color: var(--blood-hi); letter-spacing: 0.1em; }
.block { padding-top: 10px; border-top: 1px solid rgba(110, 88, 54, 0.28); }
.block b { font-size: 10px; letter-spacing: 0.24em; color: var(--ink-dim); font-weight: 400; }
.block p { margin-top: 6px; font-size: 11px; line-height: 1.7; color: var(--ink-bone); }
.go { margin-top: auto; padding: 11px 30px; font-size: 13px; }
</style>
