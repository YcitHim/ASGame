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
const view = computed(() => run.view);
const layers = computed(() => view.value?.layers ?? []);
const edges = computed(() => view.value?.edges ?? []);
const picked = computed<readonly number[]>(() => run.run?.picked ?? []);
const currentIndex = computed(() => view.value?.currentIndex ?? -1);
const finished = computed(() => run.finished);
const interNeeded = computed(() => run.needsIntermission);
const reachable = computed(() => new Set(view.value?.reachable ?? []));
const currentId = computed(() => view.value?.current?.id ?? "");

/* ---------- 布局：10 层为行、层内居中排布；边用 SVG 细线 ---------- */
const COL_W = 168;
const ROW_H = 74;
const MAP_TOP = 18;
/** 最宽一层 4 个节点 = 3 列间距 + 两侧留白 */
const MAP_W = COL_W * 3 + 110;
const MAP_H = computed(() => MAP_TOP * 2 + Math.max(1, layers.value.length) * ROW_H);
const CENTER_X = MAP_W / 2;

const positions = computed(() => {
  const map = new Map<string, { x: number; y: number }>();
  // 自下而上（爬塔）：l0 在最底、Boss 在最顶
  const lastLayer = Math.max(0, layers.value.length - 1);
  layers.value.forEach((layer, li) => {
    const count = layer.nodes.length;
    layer.nodes.forEach((node, ni) => {
      // 每层按"层内序号"居中排布：拓扑的列差约束仍由 col 决定，
      // 但视觉上每层都对称、脊椎（起点/祭坛/Boss）永远落在一根中轴上
      map.set(node.id, {
        x: CENTER_X + (ni - (count - 1) / 2) * COL_W,
        y: MAP_TOP + (lastLayer - li) * ROW_H + ROW_H / 2,
      });
    });
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
    [`k-${node.kind}`]: true,
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
            :y1="e.from.y"
            :x2="e.to.x"
            :y2="e.to.y"
            stroke="rgba(176,141,74,0.32)"
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
            <svg
              class="icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <g v-if="node.kind === 'battle'">
                <path d="M12 2.2l1.5 2.4v6.2h-3V4.6z" />
                <path d="M8.2 10.8h7.6" />
                <path d="M12 10.8v3.4" />
                <circle cx="12" cy="16.3" r="1.5" />
              </g>
              <g v-else-if="node.kind === 'elite'">
                <path d="M12 3l2.4 6.1 6.4 1.1-4.9 4.4 1.4 6.3L12 17.8 6.7 20.9l1.4-6.3L3.2 10.2l6.4-1.1z" />
              </g>
              <g v-else-if="node.kind === 'boss'">
                <path d="M12 3.4c-4.4 0-7.5 2.9-7.5 6.9 0 2.2.9 3.6 2 4.7v2.7c0 .8.7 1.4 1.5 1.4h8c.8 0 1.5-.6 1.5-1.4V15c1.1-1.1 2-2.5 2-4.7 0-4-3.1-6.9-7.5-6.9z" />
                <circle cx="9.4" cy="10.1" r="1.5" />
                <circle cx="14.6" cy="10.1" r="1.5" />
                <path d="M12 13l1 1.7h-2z" />
              </g>
              <g v-else-if="node.kind === 'rest'">
                <path d="M12 3.4c2.6 3.2 4.5 5.5 4.5 8.5a4.5 4.5 0 0 1-9 0c0-1.9.8-3.3 2.1-5 .5.9.9 1.5 1.4 2.1.3-1.8.6-3.6 1-5.6z" />
                <path d="M6.4 20.6l11.2-3.4" />
                <path d="M17.6 20.6L6.4 17.2" />
              </g>
              <g v-else-if="node.kind === 'altar'">
                <g transform="rotate(45 12 12)">
                  <rect x="11" y="4.4" width="2" height="12.6" rx="0.9" />
                  <rect x="7.6" y="2.6" width="8.8" height="4.2" rx="1" />
                </g>
              </g>
              <g v-else-if="node.kind === 'reward'">
                <path d="M3.6 10.8a8.4 4.2 0 0 1 16.8 0" />
                <rect x="3.6" y="10.8" width="16.8" height="8.4" rx="1.2" />
                <path d="M3.6 14.4h16.8" />
                <rect x="10.6" y="12.7" width="2.8" height="3.4" rx="1" />
              </g>
              <g v-else>
                <path d="M8.8 9.3a3.2 3.2 0 1 1 4.5 2.9c-1 .5-1.3 1.1-1.3 2.1" />
                <circle cx="12" cy="17.8" r="1.1" />
              </g>
            </svg>
            <span class="tag">{{ KIND_LABEL[node.kind] ?? node.kind }}</span>
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
.map-stage { display: flex; flex-direction: column; align-items: center; padding: 34px 20px 30px; }
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r { display: flex; gap: 18px; }
.topbar .r span { cursor: pointer; }
.topbar .hp { color: var(--blood-hi); font-family: var(--serif-num); }
.head { margin: 4px 0 2px; font-family: var(--serif-title); font-size: 20px; letter-spacing: 0.5em; color: var(--ink-bone); }
.dev-panel { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 5px 12px; border: 1px dashed rgba(192,57,43,.5); border-radius: var(--radius-sm); background: rgba(30,12,10,.35); }
.dev-tag { font-size: 10px; letter-spacing: .2em; color: var(--blood-hi); border: 1px solid rgba(192,57,43,.6); padding: 1px 6px; border-radius: 999px; }
.dev-btn { padding: 4px 10px; font-size: 11px; color: var(--ink-dim); background: rgba(18,16,14,.7); border: 1px solid rgba(110,88,54,.4); border-radius: var(--radius-sm); cursor: pointer; }
.dev-btn:hover { color: var(--gold); border-color: var(--gold); }
.dev-hint { font-size: 10px; color: var(--ink-dim); }
.graph-viewport {
  flex: 1 1 auto; min-height: 0; width: 100%; margin-top: 8px;
  overflow-y: auto; overflow-x: hidden; scrollbar-width: thin;
}
.graph-viewport::-webkit-scrollbar { width: 6px; }
.graph-viewport::-webkit-scrollbar-thumb { background: rgba(176, 141, 74, 0.35); border-radius: 3px; }
.graph { position: relative; margin: 0 auto; }
.edges { position: absolute; inset: 0; pointer-events: none; }
.node {
  position: absolute; transform: translate(-50%, -50%);
  width: 38px; height: 38px; padding: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(110, 88, 54, 0.55);
  background: radial-gradient(circle at 34% 28%, rgba(48, 42, 33, 0.96), rgba(13, 11, 9, 0.96));
  box-shadow: var(--edge-inner);
  color: inherit;
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover), opacity var(--dur-hover);
}
/* 全图可见（docs/48 §4）：未达区域正常显示，不置灰 */
.node:disabled { cursor: default; }
.node.onpath { border-color: rgba(176, 141, 74, 0.7); }
.node.done { opacity: 0.5; }
.node.reachable { border-color: var(--gold); box-shadow: 0 0 14px rgba(176, 141, 74, 0.3); cursor: pointer; }
.node.reachable:hover { border-color: var(--gold-hi); box-shadow: 0 0 20px rgba(216, 180, 106, 0.5); }
.node.current {
  border-color: var(--gold-hi); border-width: 2px;
  box-shadow: 0 0 18px rgba(216, 180, 106, 0.55);
  animation: node-pulse 1.6s ease-in-out infinite;
}
@keyframes node-pulse { 0%,100% { box-shadow: 0 0 12px rgba(176,141,74,0.3); } 50% { box-shadow: 0 0 22px rgba(216,180,106,0.6); } }
.node.boss { border-color: rgba(192, 57, 43, 0.65); }
.node.boss.current { box-shadow: 0 0 22px rgba(192, 57, 43, 0.5); }
/* 类型只靠图标 + 标签区分（docs/48 §四 美术口径；图标为内联 SVG，不依赖字体） */
.node.k-elite { border-color: rgba(158, 106, 194, 0.6); }
.node.k-elite .icon { color: #b98ad6; }
.node.k-boss .icon { color: var(--blood-hi); }
.node.k-rest .icon { color: #d9a566; }
.icon { width: 19px; height: 19px; color: var(--gold); }
.tag {
  position: absolute; top: calc(100% + 2px); left: 50%; transform: translateX(-50%);
  padding: 1px 4px; border-radius: 3px; background: rgba(12, 10, 8, 0.92);
  font-size: 8.5px; letter-spacing: 0.1em; color: var(--ink-dim); white-space: nowrap;
  pointer-events: none;
}
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
