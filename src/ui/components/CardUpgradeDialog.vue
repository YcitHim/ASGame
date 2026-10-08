<script setup lang="ts">
/**
 * CardUpgradeDialog · 升级前的「原版 vs 升级后」对照（甲方 2026-10-08）
 *
 * 默记祷文（幕间免费升级）原先只给一排卡名按钮，玩家看不到升级后是什么数。
 * 这里把图鉴（CodexView）那套对照搬过来：左原版、右升级后，看清再决定升不升。
 * 纯投影组件——升级与否由调用方决定，本组件只抛 confirm / cancel。
 */
import { computed } from "vue";
import { loadGameContent, t } from "@/data/load";
import CardView from "@/ui/components/CardView.vue";

const props = defineProps<{ cardId: string }>();
const emit = defineEmits<{ (e: "confirm"): void; (e: "cancel"): void }>();

const def = computed(() => loadGameContent().content.cards.get(props.cardId));
/** 有没有升级面：升级文案存在才算（descUp 为空 = 空升级，不给「升级」按钮）。 */
const hasUpgrade = computed(() => t(`card.${props.cardId}.descUp`, "") !== "");

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("cancel");
}
</script>

<template>
  <div v-if="def" class="up-dialog" tabindex="-1" @click.self="emit('cancel')" @keydown="onKey">
    <div class="up-panel">
      <header class="up-head">
        <h3>{{ t(`card.${def.id}.name`, def.id) }}</h3>
        <p class="up-tip">看清升级后的数，再决定升不升。</p>
      </header>
      <div class="up-cards">
        <div class="up-col">
          <b>原版</b>
          <CardView
            :card-id="def.id"
            :cost="def.cost"
            :charge-cost="def.chargeCost ?? 0"
            :keywords="def.keywords ?? []"
            :type="def.type"
            :rarity="def.rarity"
            :playable="true"
            :selected="false"
            :index="0"
            :hand-count="1"
            show-flavor
            display
          />
        </div>
        <div v-if="hasUpgrade" class="up-col">
          <b class="up">升级后</b>
          <CardView
            :card-id="def.id"
            :cost="def.upgraded?.cost ?? def.cost"
            :charge-cost="def.chargeCost ?? 0"
            :keywords="def.upgraded?.keywords ?? def.keywords ?? []"
            :type="def.type"
            :rarity="def.rarity"
            :playable="true"
            :selected="false"
            :index="0"
            :hand-count="1"
            :upgraded="true"
            show-flavor
            display
          />
        </div>
        <p v-else class="up-note">这张牌没有升级面。</p>
      </div>
      <footer class="up-actions">
        <button class="etch-btn ghost" type="button" @click="emit('cancel')">取 消</button>
        <button v-if="hasUpgrade" class="etch-btn" type="button" @click="emit('confirm')">升 级 这 张</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.up-dialog {
  position: fixed; inset: 0; z-index: 80;
  display: flex; align-items: center; justify-content: center;
  background: rgba(6, 5, 4, 0.82);
}
.up-panel {
  max-width: 900px; max-height: 92vh; overflow-y: auto;
  padding: 18px 28px 26px;
  background: rgba(18, 16, 14, 0.96);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  box-shadow: var(--panel-shadow);
}
.up-head { text-align: center; }
.up-head h3 { font-family: var(--serif-title); font-size: 18px; letter-spacing: 0.3em; color: var(--ink-bone); font-weight: 400; }
.up-tip { margin-top: 8px; font-size: 11px; letter-spacing: 0.18em; color: var(--ink-dim); }
.up-cards { display: flex; align-items: flex-start; justify-content: center; gap: 26px; margin-top: 18px; }
.up-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.up-col b { font-size: 11px; font-weight: 400; letter-spacing: 0.24em; color: var(--ink-dim); }
.up-col b.up { color: var(--gold); }
.up-note { align-self: center; font-size: 12px; color: var(--ink-dim); letter-spacing: 0.14em; }
.up-actions { display: flex; justify-content: center; gap: 16px; margin-top: 20px; }
</style>
