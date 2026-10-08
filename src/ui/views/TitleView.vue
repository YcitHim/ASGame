<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent, t } from "@/data/load";
import EmberField from "@/ui/components/EmberField.vue";
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

/** 通关用时（ms）→ `m:ss`；没有计时（旧档 / 未通关）显示「—」。 */
function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return t("title.record.empty", "—");
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
                · {{ t("title.record.time", "完成用时") }} {{ fmtDuration(row.normal.millis) }}
              </span>
              <span v-if="showRustRecord" class="rline rust">
                <em class="rdiff rust">{{ t("title.record.rust", "锈蚀") }}</em>
                {{ t("title.record.turns", "最少回合") }}
                {{ row.rust.minTurns ?? t("title.record.empty", "—") }}
                · {{ t("title.record.hp", "最高余血") }}
                {{ row.rust.maxHp ?? t("title.record.empty", "—") }}
                · {{ t("title.record.time", "完成用时") }} {{ fmtDuration(row.rust.millis) }}
              </span>
            </span>
          </div>
        </div>
      </section>

      <!-- 底栏只留版本号（甲方 2026-10-08）：文档路径与封版日期移到版本总结里，不占标题页 -->
      <footer class="foot">
        <span>v{{ APP_RELEASE }}</span>
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
/* 远征纪事挪到右侧（甲方 2026-10-08）：底部留白还给品牌与菜单，纪事做成侧栏面板 */
.records {
  position: absolute;
  top: 50%;
  right: 44px;
  transform: translateY(-50%);
  z-index: 2;
  width: 272px;
  padding: 14px 16px 16px;
  text-align: left;
  border: 1px solid rgba(110, 88, 54, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(14, 12, 10, 0.55);
}
.records h2 {
  font-family: var(--serif-title);
  font-size: 12px;
  letter-spacing: 0.32em;
  color: var(--gold-dim);
  font-weight: 400;
  text-align: center;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid rgba(110, 88, 54, 0.3);
}
.record-rows {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.record {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--ink-dim);
  letter-spacing: 0.08em;
}
.record .rname {
  color: var(--ink-bone);
  letter-spacing: 0.14em;
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