<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import type { MapLayer } from "@/core/map";
import type { MapNode } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { actCopy } from "@/ui/act-copy";
import { useMetaStore } from "@/stores/meta";
import { useRunStore } from "@/stores/run";
import { useSettingsStore } from "@/stores/settings";
import { useStageFit } from "@/ui/composables/useStageFit";

const router = useRouter();
const run = useRunStore();
const meta = useMetaStore();
const settings = useSettingsStore();
const devMode = computed(() => settings.values.developerMode);

/** 开发者模式：跳过当前层（不结算），用于快速抵达后续内容。 */
function devSkipLayer(): void {
  if (run.finished) return;
  run.advance();
}
/** 开发者模式：一路推进到 Boss 层。 */
function devToBoss(): void {
  for (let i = 0; i < 12 && !run.finished; i += 1) {
    const node = run.current;
    if (node?.kind === "boss") break;
    run.advance();
  }
}
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

const layers = computed<readonly MapLayer[]>(() => run.view?.layers ?? []);
const currentIndex = computed(() => run.view?.currentIndex ?? -1);
const picked = computed<readonly number[]>(() => run.run?.picked ?? []);
const finished = computed(() => run.finished);
const interNeeded = computed(() => run.needsIntermission);
const isBranch = computed(() => (layers.value[currentIndex.value]?.nodes.length ?? 0) > 1);

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

function nodeState(layerIndex: number, nodeIndex: number): "current" | "done" | "skipped" | "locked" {
  if (layerIndex < currentIndex.value || finished.value) {
    return picked.value[layerIndex] === nodeIndex ? "done" : "skipped";
  }
  if (layerIndex === currentIndex.value) return "current";
  return "locked";
}

function enter(layerIndex: number, nodeIndex: number): void {
  if (layerIndex !== currentIndex.value || finished.value) return;
  const node = layers.value[layerIndex]?.nodes[nodeIndex];
  if (!node) return;
  run.pickNode(nodeIndex);
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
        <span>{{ t(run.act?.i18n ?? "", "远征") }} · 分支路线</span>
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
      <p v-if="isBranch" class="hint">前方分岔 —— 选择一条路</p>

      <div class="track">
        <div
          v-for="(layer, layerIndex) in layers"
          :key="layer.id"
          class="layer"
          :class="{ current: layerIndex === currentIndex && !finished, branch: layer.nodes.length > 1 }"
        >
          <div class="rail" />
          <div class="layer-nodes">
            <div
              v-for="(node, nodeIndex) in layer.nodes"
              :key="node.id"
              class="node"
              :class="[nodeState(layerIndex, nodeIndex), { boss: node.kind === 'boss' }]"
            >
              <div class="glyph">{{ KIND_GLYPH[node.kind] ?? "?" }}</div>
              <div class="info">
                <b>{{ nodeTitle(node) }}</b>
                <small>{{ KIND_LABEL[node.kind] ?? node.kind }}</small>
              </div>
              <button
                v-if="layerIndex === currentIndex && !finished"
                class="etch-btn go"
                @click="enter(layerIndex, nodeIndex)"
              >
                进入
              </button>
              <span v-else class="state">
                {{ nodeState(layerIndex, nodeIndex) === "done" ? "已通过" : nodeState(layerIndex, nodeIndex) === "skipped" ? "未选择" : "未抵达" }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 一幕已尽：还有下一幕 → 进幕间 -->
      <div v-if="interNeeded" class="victory-overlay">
        <div class="victory">
          <h2>回 廊 已 尽</h2>
          <p>地板裂开了，下面是水声——还有歌声。</p>
          <div class="victory-actions">
            <button class="etch-btn" @click="router.push('/intermission')">继 续 下 潜</button>
          </div>
        </div>
      </div>

      <!-- 远征胜利：居中弹窗 -->
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
.map-stage { display: flex; flex-direction: column; align-items: center; padding: 40px 60px 20px; }
.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r { display: flex; gap: 18px; }
.topbar .r span { cursor: pointer; }
.topbar .hp { color: var(--blood-hi); font-family: var(--serif-num); }
.head { font-family: var(--serif-title); font-size: 24px; letter-spacing: 0.5em; color: var(--ink-bone); }
.hint { margin-top: 6px; font-size: 11px; letter-spacing: 0.24em; color: var(--gold-dim); }
.dev-panel { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 5px 12px; border: 1px dashed rgba(192,57,43,.5); border-radius: var(--radius-sm); background: rgba(30,12,10,.35); }
.dev-tag { font-size: 10px; letter-spacing: .2em; color: var(--blood-hi); border: 1px solid rgba(192,57,43,.6); padding: 1px 6px; border-radius: 999px; }
.dev-btn { padding: 4px 10px; font-size: 11px; color: var(--ink-dim); background: rgba(18,16,14,.7); border: 1px solid rgba(110,88,54,.4); border-radius: var(--radius-sm); cursor: pointer; }
.dev-btn:hover { color: var(--gold); border-color: var(--gold); }
.dev-hint { font-size: 10px; color: var(--ink-dim); }
.track { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; width: 760px; max-height: 470px; overflow-y: auto; padding: 2px 6px 8px; }
.layer { display: flex; align-items: stretch; gap: 10px; }
.layer-nodes { flex: 1; display: flex; gap: 10px; }
.layer.branch .layer-nodes { justify-content: center; }
.layer:not(.branch) .layer-nodes { justify-content: center; }
.rail { width: 2px; flex: none; background: linear-gradient(180deg, transparent, rgba(176, 141, 74, 0.35), transparent); }
.node {
  flex: 1;
  min-width: 0;
  max-width: 240px;
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border: 1px solid rgba(110, 88, 54, 0.4); border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7); box-shadow: var(--edge-inner);
  transition: border-color var(--dur-hover), box-shadow var(--dur-hover);
}
.node.current {
  border-color: var(--gold);
  border-left: 3px solid var(--gold);
  box-shadow: 0 0 16px rgba(176, 141, 74, 0.28);
}
.layer.current .rail { background: linear-gradient(180deg, transparent, var(--gold), transparent); opacity: 0.85; }
.node.done { opacity: 0.62; }
.node.skipped { opacity: 0.28; }
.node.locked { opacity: 0.35; }
.node.boss.current { border-color: var(--blood-hi); box-shadow: 0 0 22px rgba(192, 57, 43, 0.45); }
.glyph {
  width: 26px; height: 26px; flex: none; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--gold-dim); transform: rotate(45deg); color: var(--gold); font-family: var(--serif-title); font-size: 12px;
}
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.info b { font-family: var(--serif-title); font-size: 12px; letter-spacing: 0.16em; color: var(--ink-bone); font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.info small { font-size: 9px; letter-spacing: 0.2em; color: var(--ink-dim); }
.go { padding: 5px 14px; font-size: 11px; flex: none; }
.state { font-size: 10px; color: var(--ink-dim); letter-spacing: 0.12em; flex: none; }
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
@keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }
.victory {
  text-align: center;
  padding: 34px 64px 28px;
  background: rgba(18, 16, 14, 0.9);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
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
