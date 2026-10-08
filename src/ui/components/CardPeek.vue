<script setup lang="ts">
/**
 * CardPeek · 悬停时浮出的完整卡面（甲方 2026-10-08）
 *
 * 纯展示：位置由调用方的 `useCardPeek` 算好（舞台内坐标），这里只管画。
 * `pointer-events: none`——纯看，不吞点击。
 */
import { computed } from "vue";
import { loadGameContent } from "@/data/load";
import CardView from "@/ui/components/CardView.vue";

const props = defineProps<{
  cardId: string;
  upgraded?: boolean;
  enhancementIds?: readonly string[];
  left: number;
  top: number;
}>();

const content = loadGameContent().content;
const def = computed(() => content.cards.get(props.cardId));
</script>

<template>
  <div class="card-peek" :style="{ left: left + 'px', top: top + 'px' }">
    <CardView
      :card-id="cardId"
      :cost="def?.cost ?? 0"
      :charge-cost="def?.chargeCost ?? 0"
      :keywords="def?.keywords ?? []"
      :type="def?.type ?? 'skill'"
      :rarity="def?.rarity ?? 'common'"
      :playable="true"
      :selected="false"
      :index="0"
      :hand-count="1"
      :upgraded="upgraded === true"
      :enhancements="(enhancementIds ?? []).length"
      :enhancement-ids="enhancementIds ?? []"
      show-flavor
      display
    />
  </div>
</template>

<style scoped>
/* 舞台内 absolute 定位（避开 .stage 的 scale 二次缩放）、不吃指针事件 */
.card-peek {
  position: absolute;
  z-index: 60;
  pointer-events: none;
  filter: drop-shadow(0 12px 26px rgba(0, 0, 0, 0.72));
}
</style>
