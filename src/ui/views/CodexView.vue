<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { isContentAvailable } from "@/core/map";
import type { RelicDefinition } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { useCodexStore } from "@/stores/codex";
import { ACHIEVEMENT_IDS, useMetaStore } from "@/stores/meta";
import { useSettingsStore } from "@/stores/settings";
import CardView from "@/ui/components/CardView.vue";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const codex = useCodexStore();
const meta = useMetaStore();
const settings = useSettingsStore();
/** 开发者模式：图鉴全解锁（含遗物解锁条件） */
const devMode = computed(() => settings.values.developerMode);
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const game = loadGameContent();
// 提示 / 第一班岗 已迁到设置页的「教学」页（甲方 2026-10-07）
type Tab = "card" | "relic" | "enemy" | "achievement";
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

/**
 * 卡组图鉴分组（甲方 2026-10-07 / docs/56 §四.5）：各职业的卡分开，**中立池单独一组**。
 * 中立 = class 不在职业表里的那些（docs/56 重划后为 cards/neutral/，20 张）。
 * 判据不写死 "neutral"，新职业 / 新池子一出现就自动成组。
 */
const cardGroup = ref<string>("all");
const visibleCards = computed(() =>
  [...game.content.cards.values()]
    .filter((c) => c.rarity !== "starter" || codex.cardSeen(c.id))
    .sort((a, b) => a.id.localeCompare(b.id)),
);
const cardClasses = computed(() => [...game.content.classes.values()]);
const hasOtherCards = computed(() =>
  visibleCards.value.some((c) => !game.content.classes.has(c.class)),
);
const cardCounts = computed(() => {
  const counts: Record<string, number> = { all: visibleCards.value.length, other: 0 };
  for (const c of visibleCards.value) {
    // 不在职业表里的归「中立」桶——计数口径必须与 cards 的过滤口径一致，
    // 否则页签会显示「中立 0」却列出一堆卡（走查时真的这样）
    if (game.content.classes.has(c.class)) counts[c.class] = (counts[c.class] ?? 0) + 1;
    else counts.other += 1;
  }
  return counts;
});
const cards = computed(() => {
  if (cardGroup.value === "all") return visibleCards.value;
  if (cardGroup.value === "other") {
    return visibleCards.value.filter((c) => !game.content.classes.has(c.class));
  }
  return visibleCards.value.filter((c) => c.class === cardGroup.value);
});
const enemies = computed(() => [...game.content.enemies.values()].sort((a, b) => a.id.localeCompare(b.id)));

/**
 * 卡牌详情（甲方 2026-10-07）：点开一张卡，**原版与升级后并排看**。
 * 之前图鉴只画原版，玩家看完不知道升级到底加了多少——升级面就藏在 descUp 里，
 * 而卡面数值全在文案里，所以这里不需要另做一套数值表，直接把两张卡摆出来。
 */
const detailId = ref<string | null>(null);
const detailCard = computed(() => (detailId.value ? game.content.cards.get(detailId.value) : undefined));
const detailHasUpgrade = computed(() => {
  const card = detailCard.value;
  if (!card) return false;
  return t(`card.${card.id}.descUp`, "") !== "";
});

function openDetail(id: string): void {
  if (codex.cardSeen(id)) detailId.value = id;
}
function closeDetail(): void {
  detailId.value = null;
}
function onDetailKey(event: KeyboardEvent): void {
  if (event.key === "Escape") closeDetail();
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
        <button class="tab" :class="{ active: tab === 'card' }" @click="tab = 'card'">卡牌 {{ cardCounts.all }}</button>
        <button class="tab" :class="{ active: tab === 'relic' }" @click="tab = 'relic'">遗物 {{ game.content.relics.size }}</button>
        <button class="tab" :class="{ active: tab === 'enemy' }" @click="tab = 'enemy'">敌人 {{ enemies.length }}</button>
        <button class="tab" :class="{ active: tab === 'achievement' }" @click="tab = 'achievement'">
          {{ t("codex.tab.achievement", "成就") }} {{ achievedCount }}/{{ ACHIEVEMENT_IDS.length }}
        </button>
      </nav>

      <div class="body">
        <template v-if="tab === 'card'">
          <!-- 职业分开（甲方）：找「我的牌」不用在三职业里翻 -->
          <div class="subnav">
            <button class="subtab" :class="{ active: cardGroup === 'all' }" @click="cardGroup = 'all'">
              全部 {{ cardCounts.all }}
            </button>
            <button
              v-for="cls in cardClasses"
              :key="cls.id"
              class="subtab"
              :class="{ active: cardGroup === cls.id }"
              @click="cardGroup = cls.id"
            >
              {{ t(cls.i18n + '.name', cls.id) }} {{ cardCounts[cls.id] ?? 0 }}
            </button>
            <button
              v-if="hasOtherCards"
              class="subtab"
              :class="{ active: cardGroup === 'other' }"
              @click="cardGroup = 'other'"
            >
              中立 {{ cardCounts.other }}
            </button>
          </div>
          <div class="card-grid">
            <div
              v-for="c in cards"
              :key="c.id"
              class="card-slot"
              :class="{ clickable: codex.cardSeen(c.id) }"
              :tabindex="codex.cardSeen(c.id) ? 0 : undefined"
              :title="codex.cardSeen(c.id) ? '点击查看升级后的效果' : undefined"
              @click="openDetail(c.id)"
              @keydown.enter="openDetail(c.id)"
            >
              <CardView
                v-if="codex.cardSeen(c.id)"
                :card-id="c.id"
                :cost="c.cost"
                :charge-cost="c.chargeCost ?? 0"
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

      <!-- 卡牌详情：原版 vs 升级后（甲方：不给升级面，玩家不知道升级以后是什么数） -->
      <div
        v-if="detailCard"
        class="card-detail"
        tabindex="-1"
        @click.self="closeDetail"
        @keydown="onDetailKey"
      >
        <div class="detail-panel">
          <header class="detail-head">
            <h3>{{ t(`card.${detailCard.id}.name`, detailCard.id) }}</h3>
            <button class="etch-btn detail-close" @click="closeDetail">关 闭</button>
          </header>
          <div class="detail-cards">
            <div class="detail-col">
              <b>原版</b>
              <CardView
                :card-id="detailCard.id"
                :cost="detailCard.cost"
                :charge-cost="detailCard.chargeCost ?? 0"
                :keywords="detailCard.keywords ?? []"
                :type="detailCard.type"
                :rarity="detailCard.rarity"
                :playable="true"
                :selected="false"
                :index="0"
                :hand-count="1"
                show-flavor
                display
              />
            </div>
            <div v-if="detailHasUpgrade" class="detail-col">
              <b class="up">升级后</b>
              <CardView
                :card-id="detailCard.id"
                :cost="detailCard.upgraded?.cost ?? detailCard.cost"
                :charge-cost="detailCard.chargeCost ?? 0"
                :keywords="detailCard.upgraded?.keywords ?? detailCard.keywords ?? []"
                :type="detailCard.type"
                :rarity="detailCard.rarity"
                :playable="true"
                :selected="false"
                :index="0"
                :hand-count="1"
                :upgraded="true"
                show-flavor
                display
              />
            </div>
            <p v-else class="detail-note">这张牌没有升级面。</p>
          </div>
        </div>
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
/* 卡牌分组副导航：比主 tab 轻一档 */
.subnav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-bottom: 14px;
}
.subtab {
  padding: 5px 14px;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.6);
}
.subtab:hover { color: var(--gold); }
.subtab.active { color: var(--gold); border-color: var(--gold); background: rgba(176, 141, 74, 0.12); }
.card-grid { display: flex; flex-wrap: wrap; gap: 18px; justify-content: center; }
.card-slot.clickable { cursor: pointer; transition: transform var(--dur-hover); }
.card-slot.clickable:hover { transform: translateY(-4px); }
.card-slot.clickable:focus-visible { outline: 1px solid var(--gold); outline-offset: 4px; }

/* 卡牌详情浮层 */
.card-detail {
  position: fixed; inset: 0; z-index: 80;
  display: flex; align-items: center; justify-content: center;
  background: rgba(6, 5, 4, 0.82);
}
.detail-panel {
  max-width: 900px; max-height: 92vh; overflow-y: auto;
  padding: 18px 28px 26px;
  background: rgba(18, 16, 14, 0.96);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  box-shadow: var(--panel-shadow);
}
.detail-head { display: flex; align-items: center; justify-content: space-between; gap: 32px; }
.detail-head h3 { font-family: var(--serif-title); font-size: 18px; letter-spacing: 0.3em; color: var(--ink-bone); font-weight: 400; }
.detail-close { padding: 6px 16px; font-size: 11px; }
.detail-cards { display: flex; align-items: flex-start; justify-content: center; gap: 26px; margin-top: 18px; }
.detail-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.detail-col b { font-size: 11px; font-weight: 400; letter-spacing: 0.24em; color: var(--ink-dim); }
.detail-col b.up { color: var(--gold); }
.detail-note { align-self: center; font-size: 12px; color: var(--ink-dim); letter-spacing: 0.14em; }
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
</style>
