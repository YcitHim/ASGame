<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import type { MapNode } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { actCopy } from "@/ui/act-copy";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const meta = useMetaStore();
const settings = useSettingsStore();
const tips = useTipsStore();
const tutorial = useTutorialStore();
const devMode = computed(() => settings.values.developerMode);
/** 教学里已经讲过选路与篝火，正式局首次再遇不再重复弹（docs/42 §五）。 */
const taughtByTutorial = computed(() => tutorial.active || tutorial.finished);

/** 开发者模式：跳过当前层（不结算），用于快速抵达后续内容。 */
function devSkipLayer(): void {
  if (run.finished) return;
  run.advance();
}
/** 开发者模式：一路推进到 Boss 层。 */
function devToBoss(): void {
  for (let i = 0; i < 14 && !run.finished; i += 1) {
    const node = run.current;
    if (node?.kind === "boss") break;
    run.advance();
  }
}
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

onMounted(() => {
  if (!run.active) void router.replace("/");
  // 首遇提示（docs/42 §五）：进地图讲选路；到了 Boss 层提示"别急着敲门"
  tips.triggerUnlessTaught("map_route", taughtByTutorial.value);
  if (run.current?.kind === "boss") tips.trigger("boss_warning");
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

const view = computed(() => run.view);
const layers = computed(() => view.value?.layers ?? []);
const edges = computed(() => view.value?.edges ?? []);
const picked = computed<readonly number[]>(() => run.run?.picked ?? []);
const currentIndex = computed(() => view.value?.currentIndex ?? -1);
const finished = computed(() => run.finished);
const interNeeded = computed(() => run.needsIntermission);
const reachable = computed(() => new Set(view.value?.reachable ?? []));
const currentId = computed(() => view.value?.current?.id ?? "");

/* ---------- 布局：10 层为行、层内按 col(0~3) 分列；边用 SVG 细线 ---------- */
const COL_W = 176;
const ROW_H = 62;
const MAP_TOP = 12;
const COLS = 4;
/** 列心中点（col 0~3 → −1.5 ~ +1.5）：全图在舞台里左右居中 */
const CENTER_COL = (COLS - 1) / 2;
const MAP_W = 880;
const MAP_H = computed(() => MAP_TOP * 2 + Math.max(1, layers.value.length) * ROW_H);
const CENTER_X = MAP_W / 2;

const positions = computed(() => {
  const map = new Map<string, { x: number; y: number }>();
  layers.value.forEach((layer, li) => {
    for (const node of layer.nodes) {
      const col = node.col ?? 0;
      map.set(node.id, {
        x: CENTER_X + (col - CENTER_COL) * COL_W,
        y: MAP_TOP + li * ROW_H + ROW_H / 2,
      });
    }
  });
  return map;
});

/* ---------- 视口：超出时纵向滚动、当前位置自动居中（docs/48 §四 布局） ---------- */
const viewport = useTemplateRef<HTMLElement>("viewport");
/** 当前层的纵向锚点：有选中节点就用它，否则用该层第一个节点（分支层未选时也要有锚） */
const currentY = computed(() => {
  const picked = currentId.value ? positions.value.get(currentId.value) : undefined;
  if (picked) return picked.y;
  const first = layers.value[currentIndex.value]?.nodes[0];
  return first ? positions.value.get(first.id)?.y : undefined;
});
function centerOnCurrent(): void {
  const el = viewport.value;
  const y = currentY.value;
  if (!el || y === undefined) return;
  const target = y - el.clientHeight / 2;
  el.scrollTop = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight));
}
watch(currentY, () => void nextTick(centerOnCurrent));
onMounted(() => void nextTick(centerOnCurrent));
const edgeLines = computed(() =>
  edges.value
    .map((e) => ({ from: positions.value.get(e.from), to: positions.value.get(e.to) }))
    .filter((e): e is { from: { x: number; y: number }; to: { x: number; y: number } } => !!e.from && !!e.to),
);
function pos(id: string): { x: number; y: number } {
  return positions.value.get(id) ?? { x: 0, y: 0 };
}
function isOnPath(nodeId: string): boolean {
  return picked.value.some((idx, li) => layers.value[li]?.nodes[idx]?.id === nodeId);
}
function nodeClass(node: MapNode): Record<string, boolean> {
  return {
    current: node.id === currentId.value && !finished.value,
    reachable: reachable.value.has(node.id) && !finished.value && !interNeeded.value,
    done: run.run?.cleared.includes(node.id) === true,
    onpath: isOnPath(node.id),
    boss: node.kind === "boss",
  };
}

/** 通关新解锁的内容（docs/36 T1）：结算页弹一行提示 */
const unlockLine = computed(() => {
  const ids = meta.lastUnlocked;
  if (ids.length === 0) return "";
  const content = loadGameContent().content;
  const names = ids.map((id) =>
    content.cards.has(id) ? t(`card.${id}.name`, id) : t(`relic.${id}.name`, id),
  );
  return t("meta.unlock", "{name} 已解锁。").replace("{name}", names.join(" / "));
});

/** 通关新达成的成就（docs/38 §三 C-3）：结算页再弹一行 */
const achievementLine = computed(() => {
  const ids = meta.lastAchievements;
  if (ids.length === 0) return "";
  const names = ids.map((id) => t(`ach.${id}.name`, id));
  return t("meta.achieve", "已铭刻：{name}").replace("{name}", names.join(" / "));
});

function nodeTitle(node: MapNode): string {
  return node.i18n ? t(node.i18n, node.id) : node.id;
}

const canEnter = computed(() => !finished.value && !interNeeded.value);

/** 点击可达节点：选定并进入（DAG 里点不到就是点不动，docs/48 §四）。 */
function enter(node: MapNode): void {
  if (!canEnter.value || !reachable.value.has(node.id)) return;
  const layer = layers.value[currentIndex.value];
  const index = layer?.nodes.findIndex((n) => n.id === node.id) ?? -1;
  if (index < 0) return;
  run.pickNode(index);
  if (node.kind === "rest") void router.push("/rest");
  else if (node.kind === "altar") void router.push("/forge");
  else if (node.kind === "reward") void router.push("/reward");
  else if (node.kind === "event") void router.push("/event");
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
        <span>{{ t(run.act?.i18n ?? "", "远征") }} · 路线全图</span>
        <div class="r">
          <span class="hp">HP {{ run.hp }} / {{ run.maxHp }}</span>
          <span @click="toTitle">返回标题</span>
        </div>
      </div>

      <div v-if="devMode" class="dev-panel">
        <span class="dev-tag">DEV</span>
        <button class="dev-btn" @click="devSkipLayer">跳过本层</button>
        <button class="dev-btn" @click="devToBoss">直达 Boss</button>
        <span class="dev-hint">幕 {{ (run.run?.actIndex ?? 0) + 1 }} · 层 {{ run.run?.layerIndex ?? 0 }}</span>
      </div>

      <h1 class="head">远 征 路 线</h1>

      <div ref="viewport" class="graph-viewport">
        <div class="graph" :style="{ width: MAP_W + 'px', height: MAP_H + 'px' }">
        <svg class="edges" :width="MAP_W" :height="MAP_H" aria-hidden="true">
          <line
            v-for="(e, i) in edgeLines"
            :key="i"
            :x1="e.from.x"
            :y1="e.from.y + 18"
            :x2="e.to.x"
            :y2="e.to.y - 18"
            stroke="rgba(176,141,74,0.35)"
            stroke-width="1.2"
          />
        </svg>
        <template v-for="layer in layers" :key="layer.id">
          <button
            v-for="node in layer.nodes"
            :key="node.id"
            class="node"
            :class="nodeClass(node)"
            :disabled="!nodeClass(node).reachable"
            :style="{ left: pos(node.id).x + 'px', top: pos(node.id).y + 'px' }"
            :title="nodeTitle(node)"
            @click="enter(node)"
          >
            <span class="glyph"><i>{{ KIND_GLYPH[node.kind] ?? "?" }}</i></span>
            <span class="info">
              <b>{{ nodeTitle(node) }}</b>
              <small>{{ KIND_LABEL[node.kind] ?? node.kind }}</small>
            </span>
          </button>
        </template>
        </div>
      </div>

      <div v-if="interNeeded" class="victory-overlay">
        <div class="victory">
          <h2>回 廊 已 尽</h2>
          <p>地板裂开了，下面是水声——还有歌声。</p>
          <div class="victory-actions">
            <button class="etch-btn" @click="router.push('/intermission')">继 续 下 潜</button>
          </div>
        </div>
      </div>

      <div v-if="finished && !interNeeded" class="victory-overlay">
        <div class="victory">
          <h2>远 征 胜 利</h2>
          <p>{{ actCopy("result.victory", run.run?.actIndex ?? 0) }}</p>
          <p v-if="unlockLine" class="unlock">{{ unlockLine }}</p>
          <p v-if="achievementLine" class="achieve">{{ achievementLine }}</p>
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
.map-stage { display: flex; flex-direction: column; align-items: center; padding: 40px 20px 20px; }
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r { display: flex; gap: 18px; }
.topbar .r span { cursor: pointer; }
.topbar .hp { color: var(--blood-hi); font-family: var(--serif-num); }
.head { font-family: var(--serif-title); font-size: 22px; letter-spacing: 0.5em; color: var(--ink-bone); }
.dev-panel { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 5px 12px; border: 1px dashed rgba(192,57,43,.5); border-radius: var(--radius-sm); background: rgba(30,12,10,.35); }
.dev-tag { font-size: 10px; letter-spacing: .2em; color: var(--blood-hi); border: 1px solid rgba(192,57,43,.6); padding: 1px 6px; border-radius: 999px; }
.dev-btn { padding: 4px 10px; font-size: 11px; color: var(--ink-dim); background: rgba(18,16,14,.7); border: 1px solid rgba(110,88,54,.4); border-radius: var(--radius-sm); cursor: pointer; }
.dev-btn:hover { color: var(--gold); border-color: var(--gold); }
.dev-hint { font-size: 10px; color: var(--ink-dim); }
.graph-viewport {
  width: 100%; max-height: 500px; margin-top: 8px;
  overflow-y: auto; overflow-x: hidden; scrollbar-width: thin;
}
.graph-viewport::-webkit-scrollbar { width: 6px; }
.graph-viewport::-webkit-scrollbar-thumb { background: rgba(176, 141, 74, 0.35); border-radius: 3px; }
.graph { position: relative; margin: 0 auto; }
.edges { position: absolute; inset: 0; pointer-events: none; }
.node {
  position: absolute; transform: translate(-50%, -50%);
  width: 156px; display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border: 1px solid rgba(110, 88, 54, 0.4); border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.86); box-shadow: var(--edge-inner);
  color: inherit; text-align: left;
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover), opacity var(--dur-hover);
}
/* 全图可见（docs/48 §4）：未达区域正常显示，不置灰 */
.node:disabled { cursor: default; }
.node.onpath { border-color: rgba(176, 141, 74, 0.6); }
.node.done { opacity: 0.55; }
.node.reachable { border-color: var(--gold); box-shadow: 0 0 14px rgba(176, 141, 74, 0.3); cursor: pointer; }
.node.reachable:hover { box-shadow: 0 0 20px rgba(216, 180, 106, 0.5); }
.node.current {
  border-color: var(--gold); border-left: 3px solid var(--gold);
  box-shadow: 0 0 18px rgba(176, 141, 74, 0.45);
  animation: node-pulse 1.6s ease-in-out infinite;
}
@keyframes node-pulse { 0%,100% { box-shadow: 0 0 14px rgba(176,141,74,0.3); } 50% { box-shadow: 0 0 22px rgba(216,180,106,0.55); } }
.node.boss.current { border-color: var(--blood-hi); box-shadow: 0 0 22px rgba(192, 57, 43, 0.45); }
.glyph {
  width: 24px; height: 24px; flex: none; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--gold-dim); transform: rotate(45deg); color: var(--gold);
  font-family: var(--serif-title); font-size: 11px;
}
.glyph i { transform: rotate(-45deg); font-style: normal; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.info b { font-family: var(--serif-title); font-size: 11px; letter-spacing: 0.12em; color: var(--ink-bone); font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.info small { font-size: 9px; letter-spacing: 0.18em; color: var(--ink-dim); }
.victory-overlay {
  position: absolute; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse 70% 60% at 50% 45%, rgba(10, 7, 5, 0.86), rgba(4, 3, 2, 0.94));
  animation: overlay-in 200ms ease-out;
}
@keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }
.victory {
  text-align: center; padding: 34px 64px 28px;
  background: rgba(18, 16, 14, 0.9); border: 1px solid var(--edge-gold); border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 22px 50px rgba(0, 0, 0, 0.8);
  animation: victory-in 260ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
@keyframes victory-in { from { transform: translateY(14px) scale(0.96); opacity: 0; } to { transform: none; opacity: 1; } }
.victory h2 { font-family: var(--serif-title); font-size: 34px; letter-spacing: 0.4em; color: var(--gold); text-shadow: 0 0 26px rgba(176, 141, 74, 0.5); }
.victory p { margin: 14px 0 22px; font-size: 12px; color: var(--ink-dim); letter-spacing: 0.2em; }
.victory p.unlock { margin: -8px 0 20px; color: var(--gold); font-size: 12px; text-shadow: 0 0 14px rgba(176, 141, 74, 0.4); }
.victory p.achieve { margin: -14px 0 20px; color: var(--blood-hi); font-size: 11px; letter-spacing: 0.16em; }
.victory-actions { display: flex; justify-content: center; }
.victory .etch-btn { padding: 11px 30px; font-size: 13px; }
.relics { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--ink-dim); letter-spacing: 0.12em; }
</style>
