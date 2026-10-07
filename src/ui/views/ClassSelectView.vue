<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { loadGameContent, t } from "@/data/load";
import { relicPool, type RunDifficulty } from "@/core/map";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useSettingsStore } from "@/stores/settings";
import { useTutorialStore } from "@/stores/tutorial";
import { useStageFit } from "@/ui/composables/useStageFit";
import { relicResourceFit } from "@/ui/relic-fit";

const router = useRouter();
const run = useRunStore();
const meta = useMetaStore();
const settings = useSettingsStore();
const tutorial = useTutorialStore();
/** 开发者模式（测试跳关）：解锁全部 + 指定起始幕/层 */
const devMode = computed(() => settings.values.developerMode);
const devAct = ref(0);
const devLayer = ref(0);
const devActs = computed(() => loadGameContent().acts);
const devLayerCount = computed(() => devActs.value[devAct.value]?.layers.length ?? 0);
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

const classes = computed(() => [...loadGameContent().content.classes.values()]);

onMounted(() => {
  meta.ensureLoaded();
  // 随身遗物必选：默认选中 T1 池首件（docs/38 §一 A-2）
  const pool = companionPool.value;
  if (!companion.value && pool.length > 0) companion.value = pool.includes("blood_pump") ? "blood_pump" : pool[0];
  // 相性判定的"当前职业"：默认第一个已解锁职业，鼠标划过职业卡时跟着换（docs/43 §2.4）
  if (!focusClassId.value) {
    focusClassId.value = classes.value.find((c) => isUnlocked(c.id))?.id ?? classes.value[0]?.id ?? "";
  }
});

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

/**
 * 相性（docs/43 §2.4）：与当前职业机制不合的件置灰 + 标注。
 * "当前职业"跟着鼠标划过的职业卡走——选择页没有"已选中职业"这个状态。
 */
const focusClassId = ref("");
function companionFit(id: string) {
  return relicResourceFit(id, focusClassId.value, loadGameContent().content);
}
function className(id: string): string {
  return t(`class.${id}.name`, id);
}
function fitNote(id: string): string {
  const fit = companionFit(id);
  if (fit.ok) return "";
  return `需要${fit.resource}机制 · ${className(fit.ownerClassId ?? "")}专属相性`;
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
function relicDesc(id: string): string {
  return t(`relic.${id}.desc`, "");
}

/** 起始卡组折叠同名：打击×5 / 防御×3 / …（新手一眼看懂构成） */
function groupDeck(ids: readonly string[]): { id: string; count: number }[] {
  const out: { id: string; count: number }[] = [];
  for (const id of ids) {
    const hit = out.find((o) => o.id === id);
    if (hit) hit.count += 1;
    else out.push({ id, count: 1 });
  }
  return out;
}

/** 起始卡组悬停说明（新手看不懂「血之螺栓」时能看到完整信息）。 */
const KEYWORD_LABEL: Record<string, string> = {
  bloodpact: "血契",
  exhaust: "消耗",
  retain: "保留",
  ethereal: "虚无",
  innate: "固有",
  charge: "充能",
  pollution: "污染",
  overload: "过载",
  regenerate: "再生",
  corroding: "蚀锈",
};
const TYPE_LABEL: Record<string, string> = {
  attack: "攻击",
  skill: "技能",
  power: "能力",
  curse: "诅咒",
  status: "状态",
};
const hoverDeck = ref<{ classId: string; id: string } | null>(null);
const deckTipInfo = computed(() => {
  const hover = hoverDeck.value;
  if (!hover) return null;
  const id = hover.id;
  const def = loadGameContent().content.cards.get(id);
  return {
    classId: hover.classId,
    id,
    name: cardName(id),
    cost: def?.cost ?? 0,
    type: TYPE_LABEL[def?.type ?? "skill"] ?? "",
    rarity: def?.rarity ?? "",
    desc: t(`card.${id}.desc`, ""),
    keywords: (def?.keywords ?? []).map((k) => KEYWORD_LABEL[k] ?? k),
  };
});

/** 首次进远征前问一次「要人带路吗？」（docs/41 §4.3）；开发者模式跳过（测试不想被拦）。 */
const askTutorial = ref(false);
const pendingClassId = ref("");

function startRunWith(classId: string): void {
  run.startRun(
    classId,
    undefined,
    difficulty.value,
    companionDef.value,
    devMode.value ? { actIndex: devAct.value, layerIndex: devLayer.value } : {},
  );
}

function choose(classId: string): void {
  if (!isUnlocked(classId)) return;
  meta.ensureLoaded();
  // 邀请时机：选完职业之后、且这个职业还没被问过（docs/42 §三.0）
  if (!meta.wasTutorialOffered(classId) && !devMode.value) {
    pendingClassId.value = classId;
    askTutorial.value = true;
    return;
  }
  startRunWith(classId);
  void router.push("/map");
}

/**
 * 选「要人带路」：先开好这一局（第一班岗要用所选职业与起始卡组），再进教学。
 * 已经走完过某个职业的第一班岗 → 这个新职业只补教机制课（docs/42 §三.0）。
 */
function acceptTutorial(): void {
  startRunWith(pendingClassId.value);
  meta.ensureLoaded();
  tutorial.begin();
  askTutorial.value = false;
  void router.push("/tutorial");
}

/** 选「不用」：直接开始远征，并记住这个职业不要再问。 */
function declineTutorial(): void {
  meta.markTutorialOffered(pendingClassId.value);
  startRunWith(pendingClassId.value);
  askTutorial.value = false;
  void router.push("/map");
}

function back(): void {
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage class-stage" :class="{ 'dev-on': devMode }">
      <div class="topbar">
        <span>开始远征</span>
        <div class="r"><span @click="back">返回标题</span></div>
      </div>

      <!-- 首次进远征：可选的新手引导（docs/41 §4.3），不选也绝不再拦 -->
      <div v-if="askTutorial" class="ask-overlay">
        <div class="ask">
          <h2>要人带路吗？</h2>
          <p>一场速成课：认屏幕 → 会出牌 → 会防御 → 看懂敌人的异常。</p>
          <p class="dim">跟着提示走，做对才推进；随时可以跳过。教学不发奖励。</p>
          <div class="ask-actions">
            <button class="tut-cta" @click="acceptTutorial">
              <span class="glyph">▶</span>要，带我看一遍
            </button>
            <button class="tut-cta ghost" @click="declineTutorial">不用，直接开始</button>
          </div>
          <p class="ask-foot">约 3 分钟 · 一场带旁白的教学战 · 随时可以从右上角跳过</p>
        </div>
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
            :class="{ on: companionDef === id, unfit: !companionFit(id).ok }"
            :title="
              companionName(id) + '：' + companionDesc(id) + (companionFit(id).ok ? '' : '（' + fitNote(id) + '）')
            "
            @click="companion = id"
          >
            {{ companionName(id) }}
            <em v-if="!companionFit(id).ok" class="fit-note">{{ fitNote(id) }}</em>
          </button>
        </div>
        <div v-if="companionDef" class="companion-detail">
          <b>{{ companionName(companionDef) }}</b>
          <span>{{ companionDesc(companionDef) }}</span>
          <em>{{ companionFlavor(companionDef) }}</em>
          <span v-if="!companionFit(companionDef).ok" class="companion-warn">
            ⚠ {{ fitNote(companionDef) }}——这件对当前职业基本是白板，能选，但别指望它干活。
          </span>
        </div>
      </div>

      <!-- 开发者模式：指定起始幕 / 层（测试跳关） -->
      <div v-if="devMode" class="dev-panel">
        <span class="dev-tag">DEV</span>
        <span class="dev-label">起始幕</span>
        <button
          v-for="(a, i) in devActs"
          :key="a.id"
          class="dev-btn"
          :class="{ on: devAct === i }"
          @click="devAct = i; devLayer = 0"
        >
          {{ t(a.i18n, a.id) }}
        </button>
        <span class="dev-label">起始层</span>
        <input v-model.number="devLayer" class="dev-num" type="number" min="0" :max="devLayerCount - 1" />
        <span class="dev-hint">/ {{ devLayerCount }} 层（0 = 入口）</span>
      </div>

      <div class="classes">
        <article
          v-for="cls in classes"
          :key="cls.id"
          class="cls"
          :class="{ locked: !isUnlocked(cls.id) }"
          @mouseenter="focusClassId = cls.id"
        >
          <header>
            <h2>{{ isUnlocked(cls.id) ? t(cls.i18n + '.name', cls.id) : "？？？" }}</h2>
            <p class="title">{{ t(cls.i18n + '.title', '') }}</p>
          </header>
          <p class="intro">
            {{ isUnlocked(cls.id) ? t(cls.i18n + '.intro', '') : t(cls.i18n + '.locked', '尚未解锁。') }}
          </p>

          <template v-if="isUnlocked(cls.id)">
            <div class="stats">
              <span class="stat hp">
                <i>♥</i>
                <b>{{ cls.player.maxHp }}</b>
                <small>HP</small>
              </span>
              <span class="stat energy">
                <i>✦</i>
                <b>{{ cls.player.energy }}</b>
                <small>能量</small>
              </span>
            </div>
            <div class="block">
              <b>起始卡组</b>
              <div class="deck-chips" @mouseleave="hoverDeck = null">
                <span
                  v-for="g in groupDeck(cls.startDeck)"
                  :key="g.id"
                  class="deck-chip"
                  tabindex="0"
                  @mouseenter="hoverDeck = { classId: cls.id, id: g.id }"
                  @focus="hoverDeck = { classId: cls.id, id: g.id }"
                  @blur="hoverDeck = null"
                >
                  {{ cardName(g.id) }}<em v-if="g.count > 1">×{{ g.count }}</em>
                </span>
                <div v-if="deckTipInfo && deckTipInfo.classId === cls.id" class="deck-tip">
                  <b>{{ deckTipInfo.name }}</b>
                  <span class="meta">
                    {{ deckTipInfo.type }} · {{ deckTipInfo.cost }} 费
                    <template v-if="deckTipInfo.keywords.length">
                      · {{ deckTipInfo.keywords.join(" / ") }}
                    </template>
                  </span>
                  <p>{{ deckTipInfo.desc }}</p>
                </div>
              </div>
            </div>
            <div class="block">
              <b>起始遗物</b>
              <div v-if="(cls.startRelics ?? []).length" class="relic-list">
                <span v-for="id in cls.startRelics" :key="id" class="relic-chip">
                  <b>{{ relicName(id) }}</b>
                  <span>{{ relicDesc(id) }}</span>
                </span>
              </div>
              <p v-else>无</p>
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
/* 首次进远征的引导询问（docs/41 §4.3） */
.ask-overlay {
  position: absolute; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 3, 2, 0.72);
}
.ask {
  width: 520px; padding: 26px 30px; text-align: center;
  background: rgba(14, 12, 10, 0.96);
  border: 1px solid var(--edge-gold); border-radius: var(--radius-md);
  box-shadow: var(--panel-shadow);
}
.ask h2 {
  font-family: var(--serif-title); font-size: 24px; letter-spacing: 0.32em;
  color: var(--gold); font-weight: 500; margin-bottom: 14px;
}
.ask p { font-size: 13px; line-height: 1.9; letter-spacing: 0.08em; color: var(--ink-bone); }
.ask p.dim { color: var(--ink-dim); font-size: 12px; }
.ask-actions { display: flex; gap: 12px; justify-content: center; margin-top: 22px; }
.ask-foot {
  margin-top: 14px; font-size: 11px; letter-spacing: 0.1em; color: var(--gold-dim);
}

.class-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 44px 60px 24px;
}
/* 开发者模式下多一行 DEV 面板：收紧间距，避免把「选择」挤出屏幕 */
.class-stage.dev-on { gap: 10px; padding: 34px 60px 12px; }
.class-stage.dev-on .cls { min-height: 350px; }
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
.dev-panel {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center;
  padding: 6px 14px;
  border: 1px dashed rgba(192, 57, 43, 0.5);
  border-radius: var(--radius-sm);
  background: rgba(30, 12, 10, 0.35);
}
.dev-tag { font-size: 10px; letter-spacing: 0.2em; color: var(--blood-hi); border: 1px solid rgba(192,57,43,.6); padding: 1px 6px; border-radius: 999px; }
.dev-label { font-size: 11px; color: var(--ink-dim); letter-spacing: 0.12em; }
.dev-btn { padding: 4px 10px; font-size: 11px; color: var(--ink-dim); background: rgba(18,16,14,.7); border: 1px solid rgba(110,88,54,.4); border-radius: var(--radius-sm); cursor: pointer; }
.dev-btn.on { color: var(--gold); border-color: var(--gold); }
.dev-num { width: 56px; padding: 3px 6px; font-size: 12px; color: var(--ink-bone); background: rgba(10,8,6,.9); border: 1px solid rgba(176,141,74,.5); border-radius: var(--radius-sm); }
.dev-hint { font-size: 10px; color: var(--ink-dim); }
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
/* 机制不合（docs/43 §2.4）：置灰 + 标注，但不隐藏、不禁止 */
.companion-item.unfit { opacity: 0.46; border-style: dashed; }
.companion-item.unfit:hover { opacity: 0.72; }
.companion-item.unfit.on { opacity: 1; }
.companion-item .fit-note {
  display: block; margin-top: 2px; font-size: 9px; font-style: normal;
  letter-spacing: 0.04em; color: var(--gold-dim);
}
.companion-warn { color: var(--blood-hi) !important; }
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
.stats { display: flex; gap: 10px; }
.stat {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 7px 12px;
  border: 1px solid rgba(176, 141, 74, 0.4);
  border-radius: var(--radius-sm);
  background: linear-gradient(160deg, #1c1915, #12100e);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}
.stat i { font-style: normal; font-size: 13px; color: var(--blood-hi); }
.stat.energy i { color: var(--gold); }
.stat b { font-family: var(--serif-num); font-size: 19px; color: var(--ink-bone); }
.stat small { margin-left: auto; font-size: 10px; letter-spacing: 0.2em; color: var(--ink-dim); }
.deck-chips { position: relative; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.deck-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 6;
  padding: 9px 12px;
  text-align: left;
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  background: rgba(12, 10, 8, 0.97);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.75);
}
.deck-tip b {
  font-family: var(--serif-title);
  font-size: 13px;
  letter-spacing: 0.16em;
  color: var(--ink-bone);
  font-weight: 400;
}
.deck-tip .meta {
  margin-left: 8px;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--gold-dim);
}
.deck-tip p {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--ink-bone);
}
.deck-chip {
  padding: 3px 9px; font-size: 11px; color: var(--ink-bone);
  border: 1px solid rgba(110, 88, 54, 0.45); border-radius: 999px;
  background: rgba(18, 16, 14, 0.7);
}
.deck-chip em { font-style: normal; margin-left: 2px; color: var(--gold); }
.relic-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.relic-chip {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 10px;
  border-left: 2px solid var(--gold-dim);
  background: rgba(18, 16, 14, 0.6);
}
.relic-chip b {
  font-family: var(--serif-title); font-size: 12px;
  letter-spacing: 0.14em; color: var(--ink-bone); font-weight: 400;
}
.relic-chip span { font-size: 10px; line-height: 1.5; color: var(--ink-dim); }
.block { padding-top: 10px; border-top: 1px solid rgba(110, 88, 54, 0.28); }
.block b { font-size: 10px; letter-spacing: 0.24em; color: var(--ink-dim); font-weight: 400; }
.block p { margin-top: 6px; font-size: 11px; line-height: 1.7; color: var(--ink-bone); }
.go { margin-top: auto; padding: 11px 30px; font-size: 13px; }
</style>
