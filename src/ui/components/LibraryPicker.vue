<script setup lang="ts">
/**
 * LibraryPicker · 神眼选牌（docs/58 §七.2）
 *
 * 超级大畸变的「神眼」档：战斗开局快照污染 ≥400 时解锁，每回合一次从**牌库**任选一张
 * 加入手牌。这里只做展示与选择——合法性（每回合一次 / 是否解锁）全由 core 兜底，
 * UI 不另立一套规则。
 *
 * 版式复用卡组页的卡面网格骨架（CardView 的 display 模式），保证「牌库长什么样」
 * 与玩家在卡组页看到的观感一致。
 */
import { computed } from "vue";
import { loadGameContent, t } from "@/data/load";
import type { CardInstance } from "@/core/combat";
import CardView from "@/ui/components/CardView.vue";

// dismissable 是 Boolean prop：Vue 对未传的 Boolean 默认 false，会误伤「神眼可取消」的旧行为，
// 所以用 withDefaults 显式给 true，只有祭血狂热的「销毁」强制选择时才传 false。
const props = withDefaults(defineProps<{
  /** 牌库（抽牌堆）里可选的卡实例 id —— 直接来自核心 state.piles.draw */
  instanceIds: readonly string[];
  /** 实例 id → 卡牌实例（取升级 / 附魔），来自核心 state.cardInstances */
  instances: Readonly<Record<string, CardInstance>>;
  /** 标题 / 副标题 / 空态文案（缺省 = 神眼取牌） */
  title?: string;
  sub?: string;
  emptyText?: string;
  /** 是否可取消（缺省 true）。祭血狂热的「销毁」是强制选择，传 false 去掉取消与点外关闭 */
  dismissable?: boolean;
}>(), { dismissable: true });

const emit = defineEmits<{
  (e: "pick", instanceId: string): void;
  (e: "close"): void;
}>();

const content = loadGameContent().content;

/** 牌库卡面（按「类型 → 费用 → 名字」排，与卡组页同一顺序，翻起来不陌生）。 */
const TYPE_ORDER: Record<string, number> = { attack: 0, skill: 1, power: 2, status: 3, curse: 4 };
const cards = computed(() =>
  props.instanceIds
    .map((instanceId, order) => {
      const inst = props.instances[instanceId];
      const def = inst ? content.cards.get(inst.cardId) : undefined;
      return { instanceId, order, inst, def };
    })
    .filter((c) => c.inst !== undefined)
    .sort((a, b) => {
      const byType = (TYPE_ORDER[a.def?.type ?? ""] ?? 9) - (TYPE_ORDER[b.def?.type ?? ""] ?? 9);
      if (byType !== 0) return byType;
      const byCost = (a.def?.cost ?? 0) - (b.def?.cost ?? 0);
      if (byCost !== 0) return byCost;
      const nameA = a.def ? t(`card.${a.def.id}.name`, a.def.id) : "";
      const nameB = b.def ? t(`card.${b.def.id}.name`, b.def.id) : "";
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return a.order - b.order;
    }),
);
</script>

<template>
  <div class="eye-overlay" @click.self="dismissable !== false && emit('close')">
    <div class="eye-panel">
      <header class="eye-hd">
        <h2 class="eye-title">{{ title ?? "神 眼 · 取 牌" }}</h2>
        <p class="eye-sub">{{ sub ?? "从牌库中任选一张入手 —— 本回合一次。" }}</p>
      </header>
      <div v-if="cards.length > 0" class="eye-grid">
        <button
          v-for="entry in cards"
          :key="entry.instanceId"
          class="eye-slot"
          type="button"
          @click="emit('pick', entry.instanceId)"
        >
          <CardView
            :card-id="entry.inst!.cardId"
            :cost="entry.def?.cost ?? 0"
            :charge-cost="entry.def?.chargeCost ?? 0"
            :keywords="entry.def?.keywords ?? []"
            :type="entry.def?.type ?? 'skill'"
            :rarity="entry.def?.rarity"
            :playable="true"
            :selected="false"
            :index="0"
            :hand-count="1"
            :upgraded="entry.inst!.upgraded"
            :enhancements="entry.inst!.enhancements.length"
            :enhancement-ids="entry.inst!.enhancements"
            display
          />
        </button>
      </div>
      <p v-else class="eye-empty">{{ emptyText ?? "牌库已空 —— 没有可取之牌。" }}</p>
      <div v-if="dismissable !== false" class="eye-actions">
        <button class="etch-btn ghost" type="button" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.eye-overlay {
  position: absolute;
  inset: 0;
  z-index: 47;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 4, 3, 0.82);
}
.eye-panel {
  width: 1100px;
  max-width: calc(100% - 80px);
  max-height: calc(100% - 80px);
  padding: 22px 26px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: linear-gradient(165deg, #1c1915, #100d0a);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-md);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 18px 44px rgba(0, 0, 0, 0.8);
}
.eye-hd { text-align: center; }
.eye-title {
  font-family: var(--serif-title);
  font-size: 22px;
  letter-spacing: 0.4em;
  color: var(--gold);
  text-shadow: 0 0 20px rgba(176, 141, 74, 0.5);
}
.eye-sub {
  margin-top: 6px;
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--ink-dim);
}
.eye-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
  padding: 4px 8px 12px;
}
.eye-slot {
  width: 170px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  transition: transform 0.14s ease-out, filter 0.14s ease-out;
}
.eye-slot:hover {
  transform: translateY(-6px);
  filter: drop-shadow(0 12px 20px rgba(0, 0, 0, 0.7))
    drop-shadow(0 0 12px rgba(176, 141, 74, 0.5));
}
.eye-empty {
  padding: 40px 0;
  text-align: center;
  color: var(--ink-dim);
  letter-spacing: 0.2em;
}
.eye-actions { display: flex; justify-content: center; }
.eye-actions .etch-btn.ghost {
  background: none;
  border-color: rgba(110, 88, 54, 0.5);
  color: var(--ink-dim);
}
.eye-actions .etch-btn.ghost:hover { color: var(--gold); border-color: var(--gold); }
</style>
