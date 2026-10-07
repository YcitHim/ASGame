<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { loadGameContent, t } from "@/data/load";
import { traitsForClass, type TraitDefinition } from "@/core/registry";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useTutorialStore } from "@/stores/tutorial";
import { useStageFit } from "@/ui/composables/useStageFit";
import { highlightText } from "@/ui/glossary";

/**
 * docs/58 §二.1：选定职业后、进入地图前，出现特性选择界面。
 * 选项 = 该职业全部特性 + 「无特性」；选择落入 RunState.traitId，全程绑定本局。
 */
const route = useRoute();
const router = useRouter();
const run = useRunStore();
const meta = useMetaStore();
const tutorial = useTutorialStore();

const classId = computed(() => String(route.query.class ?? run.run?.classId ?? "bloodwright"));
const wantTutorial = computed(() => route.query.tutorial === "1");

const classDef = computed(() => loadGameContent().content.classes.get(classId.value));
const traits = computed<readonly TraitDefinition[]>(() =>
  traitsForClass(loadGameContent().content, classId.value),
);

const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

onMounted(() => {
  meta.ensureLoaded();
  // 防呆：没有进行中的局 / 非法入口 → 回落职业选择
  if (!run.active) {
    void router.replace("/class-select");
    return;
  }
  if (!classDef.value) void router.replace("/class-select");
});

/** 未选中 = null（不预选「无特性」：开局这一选必须是有意为之，别让玩家手滑跳过特性）。 */
const picked = ref<string | null>(null);

function traitName(id: string): string {
  return id === "" ? t("trait.none.name", "无特性") : t(`trait.${id}.name`, id);
}
function descHtml(id: string): string {
  const key = id === "" ? "trait.none.desc" : `trait.${id}.desc`;
  return highlightText(t(key, ""));
}

/** 确认：写入特性（局已在职业页开好）→ 教学 or 地图。 */
function confirm(): void {
  if (picked.value === null) return;
  run.setTrait(picked.value);
  if (wantTutorial.value) {
    tutorial.begin();
    void router.push("/tutorial");
    return;
  }
  void router.push("/map");
}

function back(): void {
  void router.push("/class-select");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage trait-stage">
      <div class="topbar">
        <span>开始远征</span>
        <div class="r"><span @click="back">返回职业</span></div>
      </div>

      <h1 class="head">{{ t("trait.select.title", "选择你的特性") }}</h1>
      <p class="sub">
        {{ classDef ? t(classDef.i18n + ".name", classId) : classId }} ·
        {{ t("trait.select.hint", "") }}
      </p>

      <div class="traits">
        <article class="trait" :class="{ on: picked === '' }" @click="picked = ''">
          <header>
            <h2>{{ traitName("") }}</h2>
          </header>
          <p class="desc" v-html="descHtml('')"></p>
        </article>

        <article
          v-for="tr in traits"
          :key="tr.id"
          class="trait"
          :class="{ on: picked === tr.id }"
          @click="picked = tr.id"
        >
          <header>
            <h2>{{ traitName(tr.id) }}</h2>
            <span class="tag">{{ t("trait.badge", "特性") }}</span>
          </header>
          <p class="desc" v-html="descHtml(tr.id)"></p>
        </article>
      </div>

      <button class="go" :disabled="picked === null" @click="confirm">进 图</button>
    </div>
  </div>
</template>

<style scoped>
.trait-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 44px 60px 24px;
}
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.22em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }
.head { font-family: var(--serif-title); font-size: 28px; letter-spacing: 0.42em; color: var(--ink-bone); }
.sub { font-size: 12px; letter-spacing: 0.08em; color: var(--ink-dim); max-width: 760px; text-align: center; line-height: 1.8; }
.traits { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; max-width: 1080px; }
.trait {
  width: 320px; min-height: 210px; display: flex; flex-direction: column; gap: 10px;
  padding: 18px 18px 16px; cursor: pointer;
  border: 1px solid rgba(110, 88, 54, 0.5); border-radius: var(--radius-sm);
  background: linear-gradient(165deg, #1c1915, #12100e 65%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7);
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover), transform var(--dur-hover);
}
.trait:hover { border-color: var(--gold-dim); }
.trait.on { border-color: var(--gold); box-shadow: 0 0 14px rgba(176, 141, 74, 0.22); transform: translateY(-2px); }
.trait header { display: flex; align-items: baseline; gap: 8px; }
.trait h2 { font-family: var(--serif-title); font-size: 19px; letter-spacing: 0.2em; color: var(--ink-bone); font-weight: 400; }
.trait .tag { font-size: 10px; letter-spacing: 0.18em; color: var(--gold-dim); border: 1px solid rgba(176, 141, 74, 0.5); padding: 1px 6px; border-radius: 999px; }
.trait .desc { font-size: 12px; line-height: 1.85; color: var(--ink-bone); }
.trait :deep(.kw) { color: #7fb2d9; }
.go {
  margin-top: 4px; padding: 11px 44px; font-size: 13px; letter-spacing: 0.3em;
  color: var(--ink-bone); background: rgba(18, 16, 14, 0.8);
  border: 1px solid var(--gold); border-radius: var(--radius-sm); cursor: pointer;
  transition: color var(--dur-hover), box-shadow var(--dur-hover);
}
.go:hover { color: var(--gold); box-shadow: 0 0 14px rgba(176, 141, 74, 0.3); }
/* 没选特性之前进不了图：这一选是有意为之，不能手滑跳过 */
.go:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; color: var(--ink-dim); }
</style>
