<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import type { MapNode } from "@/core/registry";
import { t } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

onMounted(() => {
  if (!run.active) void router.replace("/");
});

const KIND_LABEL: Record<string, string> = {
  battle: "战斗",
  elite: "精英",
  rest: "休息",
  altar: "祭坛",
  reward: "奖励",
  boss: "首领",
  event: "事件",
};
const KIND_GLYPH: Record<string, string> = {
  battle: "剑",
  elite: "角",
  rest: "火",
  altar: "砧",
  reward: "匣",
  boss: "颅",
  event: "？",
};

const nodes = computed<readonly MapNode[]>(() => run.view?.nodes ?? []);
const currentIndex = computed(() => run.view?.currentIndex ?? -1);
const finished = computed(() => run.finished);

function nodeTitle(node: MapNode): string {
  return node.i18n ? t(node.i18n, node.id) : `节点 ${node.id}`;
}

function enter(node: MapNode, index: number): void {
  if (index !== currentIndex.value || finished.value) return;
  if (node.kind === "rest") void router.push("/rest");
  else if (node.kind === "altar") void router.push("/forge");
  else if (node.kind === "reward") void router.push("/reward");
  else void router.push("/battle");
}

function toTitle(): void {
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage map-stage">
      <div class="topbar">
        <span>{{ t("act.rusty_corridor", "第一幕") }} · 线性地图</span>
        <div class="r">
          <span class="hp">HP {{ run.hp }} / {{ run.maxHp }}</span>
          <span @click="toTitle">返回标题</span>
        </div>
      </div>

      <h1 class="head">远 征 路 线</h1>

      <div class="track">
        <div
          v-for="(node, index) in nodes"
          :key="node.id"
          class="node"
          :class="{
            current: index === currentIndex && !finished,
            cleared: index < currentIndex || finished,
            locked: index > currentIndex,
            boss: node.kind === 'boss',
          }"
        >
          <div class="glyph">{{ KIND_GLYPH[node.kind] ?? "?" }}</div>
          <div class="info">
            <b>{{ nodeTitle(node) }}</b>
            <small>{{ KIND_LABEL[node.kind] ?? node.kind }}</small>
          </div>
          <button v-if="index === currentIndex && !finished" class="etch-btn go" @click="enter(node, index)">进入</button>
          <span v-else-if="index < currentIndex || finished" class="state">已通过</span>
          <span v-else class="state locked">未抵达</span>
        </div>
      </div>

      <!-- 远征胜利：居中弹窗（不再挂在地图下方） -->
      <div v-if="finished" class="victory-overlay">
        <div class="victory">
          <h2>远 征 胜 利</h2>
          <p>锈喉已倒下，锈蚀回廊暂时沉寂。</p>
          <div class="victory-actions">
            <button class="etch-btn" @click="toTitle">返回标题</button>
          </div>
        </div>
      </div>

      <div class="relics">遗物：{{ run.relics.map((r) => t(`relic.${r}.name`, r)).join(" · ") || "无" }}</div>
    </div>
  </div>
</template>

<style scoped>
.map-stage { display: flex; flex-direction: column; align-items: center; padding: 44px 60px 24px; }
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r { display: flex; gap: 18px; }
.topbar .r span { cursor: pointer; }
.topbar .hp { color: var(--blood-hi); font-family: var(--serif-num); }
.head { font-family: var(--serif-title); font-size: 26px; letter-spacing: 0.5em; color: var(--ink-bone); }
.track { margin-top: 26px; display: flex; flex-direction: column; gap: 12px; width: 620px; }
.node {
  display: flex; align-items: center; gap: 14px; padding: 10px 16px;
  border: 1px solid rgba(110, 88, 54, 0.4); border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7); box-shadow: var(--edge-inner);
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover);
}
.node.current { border-color: var(--gold); box-shadow: 0 0 18px rgba(176, 141, 74, 0.3); }
.node.cleared { opacity: 0.5; }
.node.locked { opacity: 0.35; }
.node.boss.current { border-color: var(--blood-hi); box-shadow: 0 0 22px rgba(192, 57, 43, 0.45); }
.glyph {
  width: 34px; height: 34px; flex: none; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--gold-dim); transform: rotate(45deg); color: var(--gold); font-family: var(--serif-title);
}
.glyph > * { transform: rotate(-45deg); }
.info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.info b { font-family: var(--serif-title); font-size: 14px; letter-spacing: 0.2em; color: var(--ink-bone); font-weight: 400; }
.info small { font-size: 10px; letter-spacing: 0.2em; color: var(--ink-dim); }
.go { padding: 7px 18px; font-size: 12px; }
.state { font-size: 11px; color: var(--ink-dim); letter-spacing: 0.15em; }
.state.locked { color: rgba(154, 144, 129, 0.5); }
.victory-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse 70% 60% at 50% 45%, rgba(10, 7, 5, 0.86), rgba(4, 3, 2, 0.94));
  animation: overlay-in 200ms ease-out;
}
@keyframes overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.victory {
  text-align: center;
  padding: 34px 64px 28px;
  background: rgba(18, 16, 14, 0.9);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 22px 50px rgba(0, 0, 0, 0.8);
  animation: victory-in 260ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
@keyframes victory-in {
  from { transform: translateY(14px) scale(0.96); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.victory h2 { font-family: var(--serif-title); font-size: 34px; letter-spacing: 0.4em; color: var(--gold); text-shadow: 0 0 26px rgba(176, 141, 74, 0.5); }
.victory p { margin: 14px 0 22px; font-size: 12px; color: var(--ink-dim); letter-spacing: 0.2em; }
.victory-actions { display: flex; justify-content: center; }
.victory .etch-btn { padding: 11px 30px; font-size: 13px; }
.relics { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--ink-dim); letter-spacing: 0.12em; }
</style>
