<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import EmberField from "@/ui/components/EmberField.vue";
import { useStageFit } from "@/ui/composables/useStageFit";
import { useRunStore } from "@/stores/run";
import { hasSlot } from "@/systems/save";

const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);
const router = useRouter();
const run = useRunStore();
const canContinue = computed(() => hasSlot("progress"));

const menu = [
  { key: "expedition", label: "开始远征", enabled: true },
  { key: "continue", label: "继续远征", enabled: canContinue.value },
  { key: "codex", label: "图鉴", enabled: true },
  { key: "settings", label: "设置", enabled: true },
] as const;

function onMenu(key: (typeof menu)[number]["key"], enabled: boolean): void {
  if (!enabled) return;
  if (key === "settings") void router.push("/settings");
  else if (key === "codex") void router.push("/codex");
  else if (key === "expedition") {
    // 0.5：先走职业选择页，再进图（docs/16 5.3）
    void router.push("/class-select");
  } else if (key === "continue") {
    if (run.load()) void router.push("/map");
  }
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage title-stage">
      <EmberField />

      <header class="brand">
        <h1 class="title">锈 与 血</h1>
        <p class="subtitle">RUST &amp; BLOOD · 血肉科技的远征</p>
      </header>

      <nav class="menu">
        <button
          v-for="item in menu"
          :key="item.key"
          class="etch-btn menu-item"
          :disabled="!item.enabled"
          :title="item.enabled ? item.label : item.label + '（尚未开放）'"
          @click="onMenu(item.key, item.enabled)"
        >
          {{ item.label }}
        </button>
      </nav>

      <footer class="foot">
        <span>0.5 封版 · 2026-10-06</span>
        <span class="dim">docs/program/0.5封版总结.md · 效果图 docs/mockups/battle-screen.html</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.title-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.title-stage::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse 70% 60% at 50% 45%, transparent 60%, rgba(0, 0, 0, 0.7) 100%);
}

.brand {
  position: relative;
  z-index: 2;
  text-align: center;
}

.title {
  font-family: var(--serif-title);
  font-size: 76px;
  font-weight: 600;
  letter-spacing: 0.24em;
  color: var(--ink-bone);
  text-shadow: 0 0 34px rgba(138, 43, 31, 0.55), 0 3px 4px #000;
}

.subtitle {
  margin-top: 14px;
  font-size: 12px;
  letter-spacing: 0.42em;
  color: var(--gold-dim);
}

.menu {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 58px;
}

.menu-item {
  width: 268px;
  padding: 13px 22px;
  font-size: 15px;
}

.foot {
  position: absolute;
  bottom: 22px;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ink-dim);
}

.foot .dim {
  color: rgba(154, 144, 129, 0.55);
}
</style>