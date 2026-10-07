<script setup lang="ts">
/**
 * DeckView · 卡组（甲方 2026-10-07 玩家反馈）：走到哪儿都能翻一眼自己现在有什么牌。
 *
 * 纯投影：读 run store 的卡组实例（含升级与附魔），不做任何规则判断。
 * 排序按「类型 → 费用 → 名字」，同名牌排在一起——这是玩家翻卡组时脑子里的顺序。
 */
import { computed, onMounted, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { t } from "@/data/load";
import { useRunStore } from "@/stores/run";
import CardView from "@/ui/components/CardView.vue";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

onMounted(() => {
  if (!run.active) void router.replace("/");
});

const TYPE_ORDER: Record<string, number> = { attack: 0, skill: 1, power: 2, status: 3, curse: 4 };
const TYPE_LABEL: Record<string, string> = {
  attack: "攻击",
  skill: "技能",
  power: "能力",
  status: "状态",
  curse: "诅咒",
};

const cards = computed(() =>
  run.deck
    .map((card, index) => ({ card, index, def: run.cardDef(card.cardId) }))
    .sort((a, b) => {
      const byType = (TYPE_ORDER[a.def?.type ?? ""] ?? 9) - (TYPE_ORDER[b.def?.type ?? ""] ?? 9);
      if (byType !== 0) return byType;
      const byCost = (a.def?.cost ?? 0) - (b.def?.cost ?? 0);
      if (byCost !== 0) return byCost;
      const nameA = t(`card.${a.card.cardId}.name`, a.card.cardId);
      const nameB = t(`card.${b.card.cardId}.name`, b.card.cardId);
      return nameA.localeCompare(nameB);
    }),
);

/** 一句话摘要：张数 / 类型分布 / 升级数。 */
const summary = computed(() => {
  const counts = new Map<string, number>();
  let upgraded = 0;
  let enhanced = 0;
  for (const { card, def } of cards.value) {
    const type = def?.type ?? "";
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (card.upgraded) upgraded += 1;
    enhanced += card.enhancements.length;
  }
  const parts = [...counts.entries()]
    .sort((a, b) => (TYPE_ORDER[a[0]] ?? 9) - (TYPE_ORDER[b[0]] ?? 9))
    .map(([type, count]) => `${TYPE_LABEL[type] ?? "其它"} ${count}`);
  return `共 ${cards.value.length} 张 · ${parts.join(" / ")} · 已升级 ${upgraded}${
    enhanced > 0 ? ` · 附魔 ${enhanced}` : ""
  }`;
});

function back(): void {
  const previous = (window.history.state as { back?: unknown } | null)?.back;
  if (typeof previous === "string" && previous.length > 0) router.back();
  else void router.push("/map");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage deck-stage">
      <div class="topbar">
        <span>卡 组</span>
        <div class="r"><span @click="back">返回</span></div>
      </div>

      <header class="hd">
        <h1 class="head">卡 组</h1>
        <p class="sub">{{ summary }}</p>
      </header>

      <div v-if="cards.length > 0" class="grid">
        <div v-for="entry in cards" :key="entry.index" class="slot">
          <CardView
            :card-id="entry.card.cardId"
            :cost="entry.def?.cost ?? 0"
            :charge-cost="entry.def?.chargeCost ?? 0"
            :keywords="entry.def?.keywords ?? []"
            :type="entry.def?.type ?? 'skill'"
            :rarity="entry.def?.rarity"
            :playable="true"
            :selected="false"
            :index="0"
            :hand-count="1"
            :upgraded="entry.card.upgraded"
            :enhancements="entry.card.enhancements.length"
            :enhancement-ids="entry.card.enhancements"
            show-flavor
            display
          />
        </div>
      </div>
      <p v-else class="empty">这一局还没有牌。</p>
    </div>
  </div>
</template>

<style scoped>
.deck-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 42px 40px 18px;
}
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.3em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }
.hd { text-align: center; }
.head { font-family: var(--serif-title); font-size: 26px; letter-spacing: 0.44em; color: var(--ink-bone); }
.sub {
  margin-top: 8px;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--ink-dim);
}
.grid {
  margin-top: 18px;
  width: 1160px;
  max-height: 520px;
  overflow-y: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  padding: 4px 8px 16px;
}
.slot { width: 170px; }
.slot :deep(.card) { cursor: default; }
.empty { margin-top: 40px; color: var(--ink-dim); letter-spacing: 0.2em; }
</style>
