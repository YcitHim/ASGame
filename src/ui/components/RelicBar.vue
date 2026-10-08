<script setup lang="ts">
/**
 * RelicBar · 左上角遗物栏（甲方 2026-10-08）
 *
 * 以前遗物只是底部一行「遗物：A · B · C」纯文字，看不出每件是干嘛的。
 * 现在固定在左上角一排徽记；鼠标放上去（或键盘聚焦）出名字 + 说明。身份件也在内。
 */
import { t } from "@/data/load";

defineProps<{ relics: readonly string[] }>();

/** 文案走 i18n；查不到的 id（旧档 / 调试注入）降级成 id 本身，不炸。 */
function name(id: string): string {
  return t(`relic.${id}.name`, id);
}
function desc(id: string): string {
  return t(`relic.${id}.desc`, "");
}
</script>

<template>
  <div class="relic-bar">
    <div v-for="id in relics" :key="id" class="relic-chip" tabindex="0">
      <span class="glyph">◆</span>
      <span class="rname">{{ name(id) }}</span>
      <div class="relic-tip">
        <b>{{ name(id) }}</b>
        <p>{{ desc(id) }}</p>
      </div>
    </div>
    <span v-if="relics.length === 0" class="empty">遗物：无</span>
  </div>
</template>

<style scoped>
/* 左上角（top 42 让开 34px 的顶栏），不吃点击 */
.relic-bar {
  position: absolute;
  top: 42px;
  left: 14px;
  z-index: 26;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 190px;
}
.relic-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(14, 12, 10, 0.6);
  cursor: default;
}
.relic-chip:hover { border-color: var(--gold); color: var(--ink-bone); }
.relic-chip .glyph { color: var(--gold-dim); font-size: 9px; }
.relic-tip {
  display: none;
  position: absolute;
  left: calc(100% + 10px);
  top: -4px;
  width: 236px;
  padding: 10px 12px;
  z-index: 60;
  text-align: left;
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.97);
  box-shadow: var(--panel-shadow);
}
.relic-chip:hover .relic-tip,
.relic-chip:focus .relic-tip { display: block; }
.relic-tip b {
  display: block;
  font-family: var(--serif-title);
  font-size: 13px;
  letter-spacing: 0.16em;
  color: var(--ink-bone);
  font-weight: 400;
}
.relic-tip p { margin-top: 6px; font-size: 11px; line-height: 1.7; color: var(--ink-dim); }
.relic-bar .empty { font-size: 11px; color: var(--ink-dim); }
</style>
