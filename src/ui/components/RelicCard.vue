<script setup lang="ts">
/**
 * RelicCard · 遗物卡面（甲方 2026-10-08「完善遗物系统」）
 *
 * 把一件遗物的**全部结构信息**摆在一张卡上，供图鉴 / 排行榜 / 奖励页复用：
 * 分级徽记（身份件 / 起始池 / 常规池 / 稀有池）、触发时机、次数限制、
 * 名称 / 描述 / 风味、以及与本职业的机制相性标注（只提示、不拦截，docs/59）。
 *
 * 纯展示组件：只读 ContentDb + i18n，不碰任何规则（G3）。
 */
import { computed } from "vue";
import type { RelicDefinition } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { relicFitNote, relicResourceFit } from "@/ui/relic-fit";
import { highlightText } from "@/ui/glossary";

const props = defineProps<{
  relicId: string;
  /** 当前职业（给相性标注用）；缺省 = 通用件，不标相性 */
  classId?: string;
  /** 紧凑模式（图鉴列表里用）：省掉风味行 */
  compact?: boolean;
}>();

const def = computed<RelicDefinition | undefined>(() =>
  loadGameContent().content.relics.get(props.relicId),
);

function label(key: string, fallback: string): string {
  return t(key, fallback);
}
const name = computed(() => label(`relic.${props.relicId}.name`, props.relicId));
const desc = computed(() => highlightText(label(`relic.${props.relicId}.desc`, "")));
const flavor = computed(() => label(`relic.${props.relicId}.flavor`, ""));

/** 分级：无 tier = 身份件（不入池）。 */
const tier = computed(() => def.value?.tier ?? 0);
const tierLabel = computed(() =>
  tier.value === 0 ? label("relic.tier.identity", "身份件") : label(`relic.tier.${tier.value}`, "遗物"),
);
const timingLabel = computed(() => label(`relic.timing.${def.value?.timing ?? ""}`, def.value?.timing ?? ""));
const onceLabel = computed(() => {
  const once = def.value?.once;
  if (once === "battle") return label("relic.once.battle", "整场一次");
  if (once === "turn") return label("relic.once.turn", "每回合一次");
  return label("relic.once.always", "次次触发");
});

/** 相性：只在与本职业不搭时给一行说明；无 classId 或通用件不出。 */
const fitNote = computed(() => {
  if (!props.classId) return "";
  return relicFitNote(relicResourceFit(props.relicId, props.classId, loadGameContent().content));
});
</script>

<template>
  <article class="relic-card" :class="[`tier-${tier}`, { compact }]">
    <header class="rc-head">
      <span class="rc-glyph" aria-hidden="true">◆</span>
      <h3 class="rc-name">{{ name }}</h3>
      <span class="rc-tier">{{ tierLabel }}</span>
    </header>

    <div class="rc-meta">
      <span class="rc-chip">{{ t("relic.timing.label", "触发") }} · {{ timingLabel }}</span>
      <span class="rc-chip">{{ onceLabel }}</span>
    </div>

    <p class="rc-desc" v-html="desc"></p>
    <p v-if="!compact && flavor" class="rc-flavor">{{ flavor }}</p>
    <p v-if="fitNote" class="rc-fit">{{ t("relic.fit.label", "相性") }} · {{ fitNote }}</p>
  </article>
</template>

<style scoped>
.relic-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 15px;
  text-align: left;
  border: 1px solid rgba(110, 88, 54, 0.42);
  border-radius: var(--radius-sm);
  background: linear-gradient(162deg, #1c1915, #12100e 68%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65);
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover), transform var(--dur-hover);
}
.relic-card:hover {
  border-color: var(--gold-dim);
  transform: translateY(-2px);
}
/* 分级用左侧色条区分（身份件黄金 / T1 常 / T2 蓝 / T3 金亮） */
.relic-card.tier-0 { border-left: 2px solid var(--gold); }
.relic-card.tier-1 { border-left: 2px solid rgba(110, 88, 54, 0.7); }
.relic-card.tier-2 { border-left: 2px solid var(--steel); }
.relic-card.tier-3 { border-left: 2px solid var(--gold); }

.rc-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.rc-glyph {
  color: var(--gold-dim);
  font-size: 10px;
}
.rc-name {
  font-family: var(--serif-title);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--ink-bone);
  font-weight: 400;
}
.rc-tier {
  margin-left: auto;
  padding: 1px 7px;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--gold-dim);
  border: 1px solid rgba(176, 141, 74, 0.42);
  border-radius: 999px;
  white-space: nowrap;
}
.relic-card.tier-2 .rc-tier { color: #8fa1b5; border-color: rgba(107, 122, 140, 0.5); }

.rc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rc-chip {
  padding: 1px 8px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.32);
  border-radius: 999px;
  background: rgba(10, 8, 6, 0.42);
}
.rc-desc {
  font-size: 12px;
  line-height: 1.8;
  color: var(--ink-bone);
}
.rc-desc :deep(.kw) { color: #7fb2d9; }
.rc-flavor {
  font-size: 11px;
  line-height: 1.7;
  font-style: italic;
  color: var(--gold-dim);
}
.rc-fit {
  font-size: 10px;
  letter-spacing: 0.06em;
  line-height: 1.6;
  color: var(--gold-dim);
  opacity: 0.92;
}
.compact { padding: 11px 13px 12px; gap: 6px; }
</style>
