<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import EmberField from "@/ui/components/EmberField.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { useMetaStore } from "@/stores/meta";
import { type Settings, useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";
import { previewSfx, toggleBgmPreview, type SfxId } from "@/ui/composables/useAudio";
import { TUTORIAL_CHAPTERS, TUTORIAL_TITLE } from "@/ui/tutorial";

const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);
const router = useRouter();
const store = useSettingsStore();
const { values } = storeToRefs(store);
const tips = useTipsStore();

/** 设置页一分为二：常规设置 / 教学（甲方 2026-10-07：提示与第一班岗从图鉴搬过来，单独成页）。 */
const page = ref<"settings" | "teaching">("settings");
const TUTORIAL_LABEL = TUTORIAL_TITLE;
/** 速成课的全部知识点（docs/42 速成版）：教学页里可随时回看。 */
const lesson = TUTORIAL_CHAPTERS.find((c) => c.kind === "battle");
const lessonSteps = lesson?.kind === "battle" ? lesson.steps : [];

interface VolumeRow {
  key: keyof Pick<Settings, "masterVolume" | "bgmVolume" | "sfxVolume">;
  label: string;
  hint: string;
}

const volumes: VolumeRow[] = [
  { key: "masterVolume", label: "主音量", hint: "全局总闸" },
  { key: "bgmVolume", label: "音乐", hint: "循环氛围 BGM" },
  { key: "sfxVolume", label: "音效", hint: "出牌 / 命中 / 回合切换" },
];

function onVolume(key: VolumeRow["key"], event: Event): void {
  const value = Number((event.target as HTMLInputElement).value) / 100;
  store.update({ [key]: value });
}

/**
 * 试听（docs/45 Q10）：四条音效各给一个按钮，音量行也给一个——
 * 命中分敌我两种，策划要的是"听得出区别"，那就得让耳朵直接比对。
 */
const SFX_PREVIEWS: readonly { id: SfxId; label: string }[] = [
  { id: "cardPlay", label: "出牌" },
  { id: "hitEnemy", label: "打中敌人" },
  { id: "hitPlayer", label: "自己挨打" },
  { id: "turn", label: "回合切换" },
];

/** BGM 试听是开关（一个按钮管开停），状态只在设置页本地维护。 */
const bgmOn = ref(false);
function onPreviewBgm(): void {
  bgmOn.value = toggleBgmPreview();
}

/** 音效滑块松手时放一声样本：调音量立刻听得到。 */
function onVolumeCommit(key: VolumeRow["key"]): void {
  if (key === "sfxVolume") previewSfx("hitEnemy");
}

function onToggle(key: "developerMode" | "tipPopups", event: Event): void {
  store.update({ [key]: (event.target as HTMLInputElement).checked });
}

function onBattleAnim(value: Settings["battleAnim"]): void {
  store.update({ battleAnim: value });
}

function onSpeed(event: Event): void {
  const speed = Number((event.target as HTMLInputElement).value) === 2 ? 2 : 1;
  store.update({ animationSpeed: speed as Settings["animationSpeed"] });
}

/**
 * 重看教学（docs/42）：从设置页随时重进。
 * 已经走完过某个职业 → 只补机制课（和选人页的邀请口径一致）。
 */
function replayTutorial(): void {
  useTutorialStore().begin();
  void router.push("/tutorial");
}

const meta = useMetaStore();
meta.ensureLoaded();

/** 已经走完教学的职业数（0 = 还没上过岗）。 */
const tutorialDoneCount = computed(() => meta.tutorialDone.length);
/** 这条首遇提示是否已读过。 */
function tipRead(id: string): boolean {
  return meta.hasSeenTip(id);
}

/** 教学进度摘要：走过几个职业 / 第一次玩是什么体验。 */
const tutorialSummary = computed(() => {
  if (tutorialDoneCount.value === 0)
    return "一场 3 分钟的速成课：认屏幕 → 会出牌 → 会防御 → 看懂异常。随时可跳过";
  return `已完成 ${tutorialDoneCount.value} 个职业；再听铆叔唠叨一遍也行`;
});

/**
 * 返回：回到**进入设置前的那一页**（战斗中打开设置 → 返回战斗，而不是回主菜单）。
 * 玩家反馈：以前一律 push("/")，打一半点设置再返回就被踢回标题。
 * 直接访问 /settings（无历史）时才回标题。
 */
function back(): void {
  const previous = (window.history.state as { back?: unknown } | null)?.back;
  if (typeof previous === "string" && previous.length > 0) router.back();
  else void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage settings-stage">
      <EmberField />

      <header class="bar">
        <button class="etch-btn back" @click="back">← 返回</button>
        <h2>设 置</h2>
        <span class="spacer" />
      </header>

      <nav class="pages">
        <button class="page-btn" :class="{ on: page === 'settings' }" @click="page = 'settings'">
          设 置
        </button>
        <button class="page-btn" :class="{ on: page === 'teaching' }" @click="page = 'teaching'">
          教 学 {{ meta.tips.length }}/{{ tips.all.length }}
        </button>
      </nav>

      <section v-if="page === 'settings'" class="panel">
        <h3 class="group">音频</h3>
        <p class="group-note">
          出牌 / 命中（打中敌人、自己挨打两种）/ 回合切换 四条音效，加一首循环氛围 BGM。改动即时生效。
        </p>
        <div v-for="row in volumes" :key="row.key" class="row">
          <div class="label">
            <b>{{ row.label }}</b>
            <small>{{ row.hint }}</small>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :value="Math.round(values[row.key] * 100)"
            @input="onVolume(row.key, $event)"
            @change="onVolumeCommit(row.key)"
          />
          <span class="num">{{ Math.round(values[row.key] * 100) }}</span>
        </div>
        <div class="try-row">
          <span class="try-label">试听</span>
          <button v-for="s in SFX_PREVIEWS" :key="s.id" class="etch-btn try" @click="previewSfx(s.id)">
            {{ s.label }}
          </button>
          <button class="etch-btn try" :class="{ on: bgmOn }" @click="onPreviewBgm">
            {{ bgmOn ? "停下 BGM" : "氛围 BGM" }}
          </button>
        </div>

        <h3 class="group">反馈</h3>
        <div class="row">
          <div class="label">
            <b>战斗动画</b>
            <small>完整＝前扑/屏震/飘字；简化＝仅飘字；关闭＝全关</small>
          </div>
          <div class="speeds">
            <label
              ><input
                type="radio"
                name="battle-anim"
                :checked="values.battleAnim === 'full'"
                @change="onBattleAnim('full')"
              />
              完整</label
            >
            <label
              ><input
                type="radio"
                name="battle-anim"
                :checked="values.battleAnim === 'simple'"
                @change="onBattleAnim('simple')"
              />
              简化</label
            >
            <label
              ><input
                type="radio"
                name="battle-anim"
                :checked="values.battleAnim === 'off'"
                @change="onBattleAnim('off')"
              />
              关闭</label
            >
          </div>
        </div>
        <div class="row">
          <div class="label"><b>动画倍速</b><small>跳过 / 2× 消费事件流</small></div>
          <div class="speeds">
            <label><input type="radio" name="speed" :checked="values.animationSpeed === 1" value="1" @change="onSpeed" /> 1×</label>
            <label><input type="radio" name="speed" :checked="values.animationSpeed === 2" value="2" @change="onSpeed" /> 2×</label>
          </div>
        </div>

        <h3 class="group">开发者</h3>
        <div class="row">
          <div class="label">
            <b>开发者模式</b>
            <small>解锁全部职业与内容，并在选人 / 地图页露出跳关入口（仅供测试）</small>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="values.developerMode"
              @change="onToggle('developerMode', $event)"
            />
            <span>{{ values.developerMode ? "开" : "关" }}</span>
          </label>
        </div>

        <h3 class="group">语言</h3>
        <div class="row">
          <div class="label"><b>界面语言</b><small>i18n key 已就位，0.1 暂锁中文</small></div>
          <span class="locked">简体中文</span>
        </div>

        <div class="actions">
          <button class="etch-btn" @click="store.reset()">恢复默认</button>
        </div>
      </section>

      <!-- 教学页（甲方 2026-10-07）：第一班岗 + 首遇提示，从图鉴搬来单独成页 -->
      <section v-else class="panel">
        <h3 class="group">{{ TUTORIAL_LABEL }}</h3>
        <div class="row">
          <div class="label">
            <b>速成课</b>
            <small>{{ tutorialSummary }}</small>
          </div>
          <button class="tut-cta" @click="replayTutorial">
            <span class="glyph">▶</span>{{ tutorialDoneCount > 0 ? "再听铆叔唠叨一遍" : "进 入 教 学" }}
          </button>
        </div>
        <article v-for="(step, i) in lessonSteps" :key="i" class="lesson">
          <h4>{{ i + 1 }}. {{ step.why }}</h4>
          <p>{{ step.how }}</p>
        </article>

        <h3 class="group">首遇提示</h3>
        <div class="row">
          <div class="label">
            <b>弹窗教学</b>
            <small>机制第一次出现时弹一条说明；关掉后不再打扰，这里仍可随时回看</small>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="values.tipPopups" @change="onToggle('tipPopups', $event)" />
            <span>{{ values.tipPopups ? "开" : "关" }}</span>
          </label>
        </div>
        <div class="row tip-head">
          <span>已读 {{ meta.tips.length }} / {{ tips.all.length }} 条</span>
          <button class="etch-btn tip-reset" @click="tips.resetAll()">重新显示一遍</button>
        </div>
        <article
          v-for="tip in tips.all"
          :key="tip.id"
          class="lesson"
          :class="{ locked: !tipRead(tip.id) }"
        >
          <h4>{{ tip.title }}<small>{{ tipRead(tip.id) ? "已读" : "未读" }}</small></h4>
          <p>{{ tip.body }}</p>
        </article>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 34px 0;
}

.bar {
  position: relative;
  z-index: 2;
  width: 760px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bar h2 {
  font-family: var(--serif-title);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.4em;
  color: var(--ink-bone);
}

.back {
  padding: 8px 16px;
  font-size: 12px;
  letter-spacing: 0.16em;
}

.spacer {
  width: 96px;
}

.pages {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.page-btn {
  padding: 7px 22px;
  font-family: var(--serif-title);
  font-size: 13px;
  letter-spacing: 0.24em;
  color: var(--ink-dim);
  background: rgba(18, 16, 14, 0.7);
  border: 1px solid rgba(110, 88, 54, 0.45);
  border-radius: var(--radius-sm);
  transition: color var(--dur-hover), border-color var(--dur-hover);
}
.page-btn:hover { color: var(--gold); border-color: var(--gold); }
.page-btn.on {
  color: var(--gold);
  border-color: var(--gold);
  box-shadow: 0 0 14px rgba(176, 141, 74, 0.25);
}

.panel {
  position: relative;
  z-index: 2;
  width: 620px;
  margin-top: 14px;
  padding: 8px 26px 22px;
  background: rgba(18, 16, 14, 0.82);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  box-shadow: var(--panel-shadow);
  /* 设置项已经长到超出 720 画布：面板内部滚动，标题栏固定，
     否则最底下的「恢复默认」永远看不见（玩家反馈） */
  max-height: 540px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* 教学页：知识点与首遇提示条目 */
.lesson {
  padding: 9px 12px;
  border: 1px solid rgba(110, 88, 54, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7);
}
.lesson + .lesson { margin-top: 8px; }
.lesson h4 {
  font-family: var(--serif-title);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.14em;
  color: var(--ink-bone);
}
.lesson h4 small {
  margin-left: 10px;
  font-family: var(--serif-body);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--gold-dim);
}
.lesson p {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.75;
  color: var(--ink-dim);
  white-space: pre-line;
}
.lesson.locked h4 { color: rgba(154, 144, 129, 0.6); }
.tip-head {
  justify-content: space-between;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--ink-dim);
}
.tip-reset { padding: 6px 14px; font-size: 11px; }

.group {
  margin: 20px 0 10px;
  font-size: 11px;
  letter-spacing: 0.34em;
  color: var(--gold);
  font-weight: 400;
  border-bottom: 1px solid rgba(110, 88, 54, 0.35);
  padding-bottom: 6px;
}

.group-note {
  margin: -2px 0 6px;
  font-size: 11px;
  line-height: 1.7;
  letter-spacing: 0.06em;
  color: var(--gold-dim);
}
.try-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 2px;
}

.try-label {
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--ink-dim);
}

.etch-btn.try {
  padding: 5px 12px;
  font-size: 11px;
  letter-spacing: 0.08em;
}

.etch-btn.try.on {
  color: var(--gold);
  border-color: var(--gold);
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 0;
}

.label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label b {
  font-size: 14px;
  font-weight: 400;
  color: var(--ink-bone);
  letter-spacing: 0.08em;
}

.label small {
  font-size: 10px;
  color: var(--ink-dim);
}

.slider {
  width: 240px;
  accent-color: var(--gold);
}

.num {
  width: 32px;
  text-align: right;
  font-family: var(--serif-num);
  color: var(--gold);
  font-size: 14px;
}

.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-dim);
  cursor: pointer;
}

.switch input,
.speeds input {
  accent-color: var(--blood-hi);
}

.speeds {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--ink-dim);
}

.speeds label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.locked {
  font-size: 12px;
  color: var(--ink-dim);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  padding: 3px 10px;
}

.actions {
  margin-top: 22px;
  display: flex;
  justify-content: flex-end;
}

.actions .etch-btn {
  padding: 9px 18px;
  font-size: 12px;
}
</style>