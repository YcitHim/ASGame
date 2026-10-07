<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { isContentAvailable } from "@/core/map";
import type { RelicDefinition } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { useCodexStore } from "@/stores/codex";
import { ACHIEVEMENT_IDS, useMetaStore } from "@/stores/meta";
import { useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";
import { TUTORIAL_CHAPTERS, TUTORIAL_TITLE } from "@/ui/tutorial";
import CardView from "@/ui/components/CardView.vue";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const codex = useCodexStore();
const meta = useMetaStore();
const tips = useTipsStore();
const settings = useSettingsStore();
/** 开发者模式：图鉴全解锁（含遗物解锁条件与首遇提示） */
const devMode = computed(() => settings.values.developerMode);
const tutorial = useTutorialStore();
const stage = useTemplateRef<HTMLElement>("stage");
/** 速成课的全部知识点（docs/42 速成版）：图鉴里可随时回看 */
const lesson = TUTORIAL_CHAPTERS.find((c) => c.kind === "battle");
const lessonSteps = lesson?.kind === "battle" ? lesson.steps : [];
useStageFit(stage);

const game = loadGameContent();
type Tab = "card" | "relic" | "enemy" | "tip" | "tutorial" | "achievement";
const tab = ref<Tab>("card");

onMounted(() => {
  codex.ensureLoaded();
  meta.ensureLoaded();
});

/** 遗物按 tier 分组（docs/38 §一 A-1）：0 = 身份件（不入池），1/2/3 = 起始/常规/稀有。 */
const TIER_LABEL: Record<number, string> = { 0: "身份件", 1: "起始池", 2: "常规池", 3: "稀有池" };
const relicGroups = computed<{ tier: number; label: string; items: RelicDefinition[] }[]>(() => {
  const buckets = new Map<number, RelicDefinition[]>();
  for (const r of game.content.relics.values()) {
    const key = r.tier ?? 0;
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, items]) => ({
      tier,
      label: TIER_LABEL[tier] ?? "其它",
      items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
    }));
});

function relicKnown(r: RelicDefinition): boolean {
  if (devMode.value) return true;
  return codex.relicSeen(r.id) && isContentAvailable(r.unlockCondition, r.id, meta.unlocked);
}
/** 首遇提示是否算"已读"（开发者模式下全部展开）。 */
function tipRead(id: string): boolean {
  return devMode.value || meta.hasSeenTip(id);
}
function relicFlavor(id: string): string {
  return t(`relic.${id}.flavor`, "");
}
/** 成就是否算"已达成"（开发者模式下全部展开，方便查文案）。 */
function achShown(id: string): boolean {
  return devMode.value || meta.isAchieved(id);
}
const achievedCount = computed(() =>
  devMode.value ? ACHIEVEMENT_IDS.length : ACHIEVEMENT_IDS.filter((id) => meta.isAchieved(id)).length,
);

const cards = computed(() =>
  [...game.content.cards.values()].filter((c) => c.rarity !== "starter" || codex.cardSeen(c.id)).sort((a, b) => a.id.localeCompare(b.id)),
);
const enemies = computed(() => [...game.content.enemies.values()].sort((a, b) => a.id.localeCompare(b.id)));

/** 图鉴里重进「第一班岗」（docs/42 §四「回放」）。 */
function replayTutorial(): void {
  tutorial.begin();
  void router.push("/tutorial");
}

function back(): void {
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage codex-stage">
      <div class="topbar">
        <span>图 鉴</span>
        <div class="r"><span @click="back">返回标题</span></div>
      </div>

      <nav class="tabs">
        <button class="tab" :class="{ active: tab === 'card' }" @click="tab = 'card'">卡牌 {{ cards.length }}</button>
        <button class="tab" :class="{ active: tab === 'relic' }" @click="tab = 'relic'">遗物 {{ game.content.relics.size }}</button>
        <button class="tab" :class="{ active: tab === 'enemy' }" @click="tab = 'enemy'">敌人 {{ enemies.length }}</button>
        <button class="tab" :class="{ active: tab === 'tip' }" @click="tab = 'tip'">
          {{ t("codex.tab.tip", "提示") }} {{ meta.tips.length }}/{{ tips.all.length }}
        </button>
        <button class="tab" :class="{ active: tab === 'tutorial' }" @click="tab = 'tutorial'">
          {{ TUTORIAL_TITLE }}
        </button>
        <button class="tab" :class="{ active: tab === 'achievement' }" @click="tab = 'achievement'">
          {{ t("codex.tab.achievement", "成就") }} {{ achievedCount }}/{{ ACHIEVEMENT_IDS.length }}
        </button>
      </nav>

      <div class="body">
        <template v-if="tab === 'card'">
          <div class="card-grid">
            <div v-for="c in cards" :key="c.id" class="card-slot">
              <CardView
                v-if="codex.cardSeen(c.id)"
                :card-id="c.id"
                :cost="c.cost"
                :keywords="c.keywords ?? []"
                :type="c.type"
                :rarity="c.rarity"
                :playable="true"
                :selected="false"
                :index="0"
                :hand-count="1"
                show-flavor
                display
              />
              <div v-else class="locked-card">
                <span class="q">？</span>
                <small>尚未记述</small>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="tab === 'relic'">
          <div class="rows">
            <template v-for="group in relicGroups" :key="group.tier">
              <h4 class="tier-head">{{ group.label }} · {{ group.items.length }}</h4>
              <article v-for="r in group.items" :key="r.id" class="row" :class="{ locked: !relicKnown(r) }">
                <h3>{{ relicKnown(r) ? t(`relic.${r.id}.name`, r.id) : "？？？" }}</h3>
                <p>{{ relicKnown(r) ? t(`relic.${r.id}.desc`, "") : "尚未记述。" }}</p>
                <p v-if="relicKnown(r) && relicFlavor(r.id)" class="flavor">{{ relicFlavor(r.id) }}</p>
              </article>
            </template>
          </div>
        </template>

        <template v-else-if="tab === 'tip'">
          <div class="rows">
            <div class="tip-actions">
              <span>首遇提示：第一次遇到机制时弹一次，点掉后不再出现（会记在这份存档里）。</span>
              <button class="etch-btn tip-reset" @click="tips.resetAll()">重新显示一遍</button>
            </div>
            <article v-for="tip in tips.all" :key="tip.id" class="row" :class="{ locked: !tipRead(tip.id) }">
              <h3>{{ tip.title }}<small>{{ tipRead(tip.id) ? "已读" : "未读" }}</small></h3>
              <p class="tip-body">{{ tip.body }}</p>
            </article>
          </div>
        </template>

        <template v-else-if="tab === 'tutorial'">
          <div class="rows">
            <div class="tip-actions">
              <span>
                {{
                  meta.tutorialDone.length > 0
                    ? `已完成「${TUTORIAL_TITLE}」：${meta.tutorialDone.length} 个职业`
                    : "还没走过「第一班岗」——速成课只要 3 分钟，第一次玩建议走一遍。"
                }}
              </span>
              <button class="etch-btn tip-reset" @click="replayTutorial">重 进 第 一 班 岗</button>
            </div>
            <article v-for="(step, i) in lessonSteps" :key="i" class="row">
              <h3>{{ i + 1 }}. {{ step.why }}</h3>
              <p class="tip-body">{{ step.how }}</p>
            </article>
          </div>
        </template>

        <template v-else-if="tab === 'achievement'">
          <div class="rows">
            <article v-for="id in ACHIEVEMENT_IDS" :key="id" class="row" :class="{ locked: !achShown(id) }">
              <h3>{{ achShown(id) ? t(`ach.${id}.name`, id) : "？？？" }}</h3>
              <p>{{ achShown(id) ? t(`ach.${id}.desc`, "") : "尚未达成。" }}</p>
            </article>
          </div>
        </template>

        <template v-else>
          <div class="rows">
            <article v-for="e in enemies" :key="e.id" class="row" :class="{ locked: !codex.enemySeen(e.id) }">
              <h3>
                {{ codex.enemySeen(e.id) ? e.name : "？？？" }}
                <small v-if="codex.enemySeen(e.id)">{{ t(`enemy.${e.id}.title`, "") }}</small>
              </h3>
              <p>{{ codex.enemySeen(e.id) ? t(`enemy.${e.id}.lore`, "") : "尚未记述。" }}</p>
            </article>
          </div>
        </template>
      </div>

    </div>
  </div>
</template>

<style scoped>
.codex-stage { display: flex; flex-direction: column; align-items: center; padding: 42px 40px 18px; }
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.3em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }
.tabs { display: flex; gap: 12px; z-index: 2; }
.tab {
  padding: 8px 24px;
  font-family: var(--serif-title); font-size: 13px; letter-spacing: 0.24em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.45);
  border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7);
}
.tab.active { color: var(--gold); border-color: var(--gold); box-shadow: 0 0 14px rgba(176, 141, 74, 0.25); }
.body { margin-top: 16px; width: 1160px; max-height: 560px; overflow-y: auto; padding: 4px 10px 18px; }
.card-grid { display: flex; flex-wrap: wrap; gap: 18px; justify-content: center; }
.card-slot { width: 170px; }
.card-slot :deep(.card) { cursor: default; }
.locked-card {
  width: 170px; height: 240px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  border: 1px dashed rgba(110, 88, 54, 0.4);
  border-radius: var(--radius-md);
  background: rgba(12, 10, 8, 0.55);
  color: rgba(154, 144, 129, 0.5);
}
.locked-card .q { font-family: var(--serif-title); font-size: 40px; }
.locked-card small { letter-spacing: 0.2em; }
.rows { display: flex; flex-direction: column; gap: 10px; width: 820px; margin: 0 auto; }
.row {
  padding: 12px 18px;
  border: 1px solid rgba(110, 88, 54, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7);
}
.row h3 { font-family: var(--serif-title); font-size: 15px; letter-spacing: 0.18em; color: var(--ink-bone); font-weight: 400; }
.row h3 small { margin-left: 12px; font-family: var(--serif-body); font-size: 11px; letter-spacing: 0.12em; color: var(--gold-dim); }
.row p { margin-top: 7px; font-size: 12px; line-height: 1.8; color: var(--ink-dim); }
.row.locked h3 { color: rgba(154, 144, 129, 0.45); }
.tier-head {
  margin-top: 6px; font-family: var(--serif-title); font-size: 12px;
  letter-spacing: 0.24em; color: var(--gold-dim); font-weight: 400;
}
.row p.flavor { color: var(--gold-dim); font-style: italic; }
/* 首遇提示回看（docs/41 §4.1） */
.tip-actions {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  font-size: 11px; letter-spacing: 0.08em; color: var(--ink-dim);
}
.tip-reset { padding: 6px 14px; font-size: 11px; }
.row p.tip-body { white-space: pre-line; }
</style>
