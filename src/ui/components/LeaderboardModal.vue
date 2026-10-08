<script setup lang="ts">
/**
 * LeaderboardModal · 远征榜（甲方 2026-10-08）
 *
 * 把标题页原先那块窄窄的「远征纪事」侧栏，升级成一个可开关的**榜殿**弹窗：
 *  - 上方两个档位页签：普通 / 锈蚀（互不覆盖，各记一榜）；
 *  - 每个职业一张「榜牌」：职业名 + 是否已通关 + 各**特性分档**的最佳纪录
 *    （最少回合 / 最高余血 / 完成日期），无特性单独一档、也列出来；
 *  - 未通关的职业显示为暗牌（尚未解锁），不藏也不清。
 *
 * 纯展示：数据全读 meta store，不写任何状态（关闭由父级控制）。
 */
import { computed } from "vue";
import { loadGameContent, t } from "@/data/load";
import { useMetaStore } from "@/stores/meta";
import { useSettingsStore } from "@/stores/settings";

const emit = defineEmits<{ (e: "close"): void }>();

const meta = useMetaStore();
const settings = useSettingsStore();
meta.ensureLoaded();
settings.init();

/** 开发者模式：全部职业视为已亮（方便查榜样式）。 */
const devMode = computed(() => settings.values.developerMode);

type Diff = "normal" | "rust";
const diff = defineModel<Diff>("diff", { default: "normal" });
/** 未通关也可看榜，但没有成绩时显示空态；难度页签在锈蚀未解锁时仍可看（不藏玩家成绩）。 */
const rustAvailable = computed(
  () =>
    devMode.value ||
    meta.rustUnlocked ||
    [...loadGameContent().content.classes.keys()].some(
      (id) => meta.recordsByTrait(id, "rust").length > 0,
    ),
);

interface TraitRow {
  traitId: string;
  name: string;
  minTurns: number | null;
  maxHp: number | null;
  date: string | null;
  /** 该档是否为「无特性」对照 */
  none: boolean;
}
interface ClassBoard {
  id: string;
  name: string;
  title: string;
  cleared: boolean;
  rows: TraitRow[];
}

function traitName(id: string): string {
  if (id === "" || id === "none") return t("leaderboard.trait.none", "无特性");
  return t(`trait.${id}.name`, id);
}

const boards = computed<ClassBoard[]>(() =>
  [...loadGameContent().content.classes.values()].map((cls) => {
    const rows = meta.recordsByTrait(cls.id, diff.value).map<TraitRow>((r) => ({
      traitId: r.traitId === "none" ? "" : r.traitId,
      name: traitName(r.traitId),
      minTurns: r.record.minTurns,
      maxHp: r.record.maxHp,
      date: r.record.date ?? null,
      none: r.traitId === "" || r.traitId === "none",
    }));
    // 无纪录的档不列；排序：无特性最后、其余按名
    rows.sort((a, b) => (a.none ? 1 : 0) - (b.none ? 1 : 0) || a.name.localeCompare(b.name));
    return {
      id: cls.id,
      name: t(`${cls.i18n}.name`, cls.id),
      title: t(`${cls.i18n}.title`, ""),
      cleared: devMode.value || meta.hasCleared(cls.id),
      rows,
    };
  }),
);

const totalRecords = computed(() => boards.value.reduce((n, b) => n + b.rows.length, 0));

function fmt(value: number | null): string {
  return value == null ? t("title.record.empty", "—") : String(value);
}
function fmtDate(date: string | null): string {
  if (!date) return t("title.record.empty", "—");
  return date;
}
</script>

<template>
  <div class="lb-overlay" @click.self="emit('close')">
    <section class="lb-panel" role="dialog" aria-label="远征榜">
      <!-- 顶部：标题 + 关闭 -->
      <header class="lb-head">
        <div class="lb-titles">
          <h2>{{ t("leaderboard.title", "远 征 榜") }}</h2>
          <p class="lb-sub">{{ t("leaderboard.subtitle", "") }}</p>
        </div>
        <button class="lb-close" @click="emit('close')">{{ t("leaderboard.close", "关 闭") }}</button>
      </header>

      <!-- 档位页签 -->
      <nav class="lb-tabs">
        <button class="lb-tab" :class="{ on: diff === 'normal' }" @click="diff = 'normal'">
          {{ t("leaderboard.tab.normal", "普通") }}
        </button>
        <button
          class="lb-tab rust"
          :class="{ on: diff === 'rust', dim: !rustAvailable }"
          :disabled="!rustAvailable"
          @click="diff = 'rust'"
        >
          {{ t("leaderboard.tab.rust", "锈蚀") }}
        </button>
        <span class="lb-summary">
          {{ t("leaderboard.summary", "通关 {n} 次 · 纪录 {m} 条").replace("{n}", String(meta.clearedClasses.length)).replace("{m}", String(totalRecords)) }}
        </span>
      </nav>

      <!-- 榜牌 -->
      <div class="lb-body">
        <article
          v-for="board in boards"
          :key="board.id"
          class="lb-board"
          :class="{ locked: !board.cleared && board.rows.length === 0 }"
        >
          <header class="lb-board-head">
            <div class="lb-cls">
              <span class="lb-ring" aria-hidden="true">◆</span>
              <div>
                <h3>{{ board.cleared ? board.name : "？？？" }}</h3>
                <p v-if="board.cleared" class="lb-cls-title">{{ board.title }}</p>
                <p v-else class="lb-cls-title">{{ t("leaderboard.lockedHint", "") }}</p>
              </div>
            </div>
            <span v-if="!board.cleared" class="lb-lock">{{ t("leaderboard.locked", "尚未解锁") }}</span>
          </header>

          <div v-if="board.rows.length" class="lb-rows">
            <div class="lb-row lb-row-head">
              <span class="c-trait">{{ t("leaderboard.trait.header", "特性") }}</span>
              <span class="c-num">{{ t("leaderboard.col.turns", "最少回合") }}</span>
              <span class="c-num">{{ t("leaderboard.col.hp", "最高余血") }}</span>
              <span class="c-date">{{ t("leaderboard.col.date", "完成日期") }}</span>
            </div>
            <div
              v-for="row in board.rows"
              :key="row.traitId || 'none'"
              class="lb-row"
              :class="{ none: row.none }"
            >
              <span class="c-trait">
                <em v-if="row.none" class="tag-none">{{ row.name }}</em>
                <template v-else>{{ row.name }}</template>
              </span>
              <span class="c-num">{{ fmt(row.minTurns) }}</span>
              <span class="c-num">{{ fmt(row.maxHp) }}</span>
              <span class="c-date">{{ fmtDate(row.date) }}</span>
            </div>
          </div>
          <p v-else class="lb-empty">
            {{ board.cleared ? t("leaderboard.empty", "这个职业还没有人走到底。") : t("leaderboard.lockedHint", "") }}
          </p>
        </article>
      </div>

      <footer class="lb-foot">{{ t("leaderboard.hint", "") }}</footer>
    </section>
  </div>
</template>

<style scoped>
.lb-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 4, 3, 0.82);
  backdrop-filter: blur(2px);
}
.lb-panel {
  width: 900px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  padding: 22px 26px 18px;
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-md);
  background:
    radial-gradient(ellipse 60% 40% at 50% 0%, rgba(176, 141, 74, 0.12), transparent 70%),
    linear-gradient(168deg, #1c1915, #100e0c 72%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 24px 60px rgba(0, 0, 0, 0.7);
}
.lb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(110, 88, 54, 0.35);
}
.lb-titles h2 {
  font-family: var(--serif-title);
  font-size: 26px;
  letter-spacing: 0.42em;
  color: var(--gold);
  font-weight: 500;
  text-shadow: 0 0 24px rgba(176, 141, 74, 0.4);
}
.lb-sub {
  margin-top: 7px;
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--ink-dim);
}
.lb-close {
  padding: 6px 16px;
  font-size: 11px;
  letter-spacing: 0.24em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.45);
  border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7);
  cursor: pointer;
}
.lb-close:hover { color: var(--gold); border-color: var(--gold); }

.lb-tabs {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 12px;
}
.lb-tab {
  padding: 6px 22px;
  font-family: var(--serif-title);
  font-size: 12px;
  letter-spacing: 0.22em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.42);
  border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7);
  cursor: pointer;
}
.lb-tab.on { color: var(--gold); border-color: var(--gold); box-shadow: 0 0 14px rgba(176, 141, 74, 0.24); }
.lb-tab.rust.on { color: var(--blood-hi); border-color: var(--blood-hi); box-shadow: 0 0 14px rgba(192, 57, 43, 0.28); }
.lb-tab.dim { opacity: 0.4; cursor: not-allowed; }
.lb-summary {
  margin-left: auto;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--gold-dim);
}

.lb-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  padding: 4px 6px 8px;
}
.lb-board {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 12px;
  border: 1px solid rgba(110, 88, 54, 0.4);
  border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1a1713, #110f0d 70%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}
.lb-board.locked { opacity: 0.62; }
.lb-board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 9px;
  border-bottom: 1px solid rgba(110, 88, 54, 0.28);
}
.lb-cls { display: flex; align-items: center; gap: 9px; }
.lb-ring { color: var(--gold-dim); font-size: 12px; }
.lb-board h3 {
  font-family: var(--serif-title);
  font-size: 16px;
  letter-spacing: 0.18em;
  color: var(--ink-bone);
  font-weight: 400;
}
.lb-cls-title { margin-top: 3px; font-size: 10px; letter-spacing: 0.1em; color: var(--ink-dim); }
.lb-lock {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--blood-hi);
  opacity: 0.85;
  white-space: nowrap;
}

.lb-rows { display: flex; flex-direction: column; gap: 5px; }
.lb-row {
  display: grid;
  grid-template-columns: 1.35fr 0.8fr 0.8fr 1fr;
  gap: 6px;
  align-items: baseline;
  padding: 5px 4px;
  font-size: 12px;
  color: var(--ink-bone);
  border-bottom: 1px dashed rgba(110, 88, 54, 0.18);
}
.lb-row-head {
  padding-bottom: 4px;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--gold-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.28);
}
.lb-row .c-num { font-family: var(--serif-num); color: var(--ink-bone); }
.lb-row .c-date { font-family: var(--serif-num); font-size: 11px; color: var(--ink-dim); }
.lb-row.none .c-trait { color: var(--ink-dim); }
.tag-none {
  font-style: normal;
  padding: 0 7px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.4);
  border-radius: 999px;
}
.lb-empty {
  padding: 14px 4px;
  font-size: 11px;
  line-height: 1.7;
  letter-spacing: 0.08em;
  color: var(--ink-dim);
}
.lb-foot {
  margin-top: 12px;
  padding-top: 10px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-align: center;
  color: rgba(154, 144, 129, 0.6);
  border-top: 1px solid rgba(110, 88, 54, 0.25);
}
</style>
