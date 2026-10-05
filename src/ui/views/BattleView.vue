<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import { cardEnergyCost, type BattleState } from "@/core/combat";
import type { CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useSettingsStore } from "@/stores/settings";
import { isDebugEnabled } from "@/systems/debug";
import { useStageFit } from "@/ui/composables/useStageFit";
import { describeEvent, type LogEntry } from "@/ui/log-format";
import BattleLog from "@/ui/components/BattleLog.vue";
import BuffRow from "@/ui/components/BuffRow.vue";
import CardView from "@/ui/components/CardView.vue";
import DamageFloat from "@/ui/components/DamageFloat.vue";
import DebugConsole from "@/ui/components/DebugConsole.vue";
import EnergyOrb from "@/ui/components/EnergyOrb.vue";
import HpBar from "@/ui/components/HpBar.vue";
import IntentIcon from "@/ui/components/IntentIcon.vue";
import PollutionGauge from "@/ui/components/PollutionGauge.vue";

const router = useRouter();
const store = useBattleStore();
const settings = useSettingsStore();
const stage = useTemplateRef<HTMLElement>("stage");
useStageFit(stage);

const game = loadGameContent();
const showLog = ref(false);
const shaking = ref(false);
const isDev = isDebugEnabled();

onMounted(() => {
  if (!store.battle) store.start();
});

const state = computed<BattleState | null>(() => store.battle);
const player = computed(() => state.value?.player ?? null);
const enemies = computed(() => state.value?.enemies ?? []);
const phase = computed(() => state.value?.phase ?? "battleStart");
const canAct = computed(() => phase.value === "playerAction" && !store.playing && !store.over);

const hand = computed(() =>
  (state.value?.piles.hand ?? []).map((instanceId) => {
    const instance = state.value!.cardInstances[instanceId];
    const def: CardDefinition | undefined = game.content.cards.get(instance.cardId);
    const cost = def ? cardEnergyCost(def, instance) : 99;
    return {
      instanceId,
      cardId: instance.cardId,
      def,
      cost,
      keywords: def?.keywords ?? [],
      type: def?.type ?? "skill",
      enhancements: instance.enhancements.length,
      playable: cost <= (player.value?.energy ?? 0),
    };
  }),
);

const logEntries = computed<LogEntry[]>(() => store.log.map((e) => describeEvent(e, store.enemyNames)));

const floatersFor = computed(() => {
  const map: Record<string, typeof store.floaters> = {};
  for (const f of store.floaters) {
    map[f.targetId] = [...(map[f.targetId] ?? []), f];
  }
  return map;
});

watch(
  () => store.shake,
  () => {
    if (!settings.values.screenShake) return;
    shaking.value = true;
    setTimeout(() => (shaking.value = false), 200);
  },
);

function pickEnemy(enemyId: string): void {
  store.selectTarget(enemyId);
}

/* ---------- 拖拽出牌 ---------- */

interface DragState {
  index: number;
  moved: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  hoverEnemy: string | null;
}

const drag = ref<DragState | null>(null);
let dragCleanup: (() => void) | null = null;

/** 命中光标下的存活敌人（拖拽松开时判定）。 */
function enemyAt(x: number, y: number): string | null {
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  const node = el?.closest?.("[data-enemy-id]") as HTMLElement | null;
  const id = node?.dataset?.enemyId ?? null;
  if (!id) return null;
  const enemy = store.battle?.enemies.find((e) => e.id === id);
  return enemy && enemy.hp > 0 ? id : null;
}

function endDrag(): void {
  dragCleanup?.();
  dragCleanup = null;
}

function onGrab(index: number, event: PointerEvent): void {
  if (!canAct.value) return;
  event.preventDefault();
  endDrag();
  drag.value = {
    index,
    moved: false,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    hoverEnemy: null,
  };

  const move = (e: PointerEvent) => {
    const d = drag.value;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    d.hoverEnemy = d.moved ? enemyAt(e.clientX, e.clientY) : null;
  };

  const up = (e: PointerEvent) => {
    const d = drag.value;
    endDrag();
    drag.value = null;
    if (!d) return;
    if (!d.moved) {
      // 轻点 = 选中手牌（需目标的卡进入瞄准模式）
      store.selectCard(d.index);
      return;
    }
    const enemyId = enemyAt(e.clientX, e.clientY);
    // 拖到敌人身上 = 直接对该目标出牌；否则按无目标尝试（非目标卡可直接打出）
    store.playCard(d.index, enemyId);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  dragCleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
}

onBeforeUnmount(endDrag);

const ghostCard = computed(() => (drag.value ? hand.value[drag.value.index] : undefined));

function intentLabel(id: string): string {
  return game.content.enemies.get(id)?.name ?? id;
}

const actName = computed(() => game.i18n["act.rusty_corridor"] ?? "第一幕");

function restart(): void {
  store.start();
}

function back(): void {
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage battle-stage" :class="{ shaking }">
      <!-- 顶栏 -->
      <div class="topbar">
        <span>{{ actName }} — 遭遇 {{ store.battle?.battleId ?? "" }}</span>
        <div class="r">
          <span @click="showLog = !showLog">{{ showLog ? "收起日志" : "日志" }}</span>
          <span @click="store.skip()">跳过</span>
          <span @click="store.toggleSpeed()">{{ store.speed }}×</span>
          <span @click="router.push('/settings')">设置</span>
        </div>
      </div>

      <!-- 敌人区 -->
      <div class="enemy-zone">
        <div
          v-for="enemy in enemies"
          :key="enemy.id"
          class="enemy"
          :class="{
            dead: enemy.hp <= 0,
            targetable: store.targeting !== null || drag?.moved === true,
            'drop-target': drag?.hoverEnemy === enemy.id,
          }"
          :data-enemy-id="enemy.id"
          @click="pickEnemy(enemy.id)"
        >
          <IntentIcon :intent="enemy.intent" />
          <div class="enemy-fig">
            <svg width="150" height="150" viewBox="0 0 170 170" aria-hidden="true">
              <ellipse cx="85" cy="158" rx="52" ry="8" fill="rgba(0,0,0,.6)" />
              <path
                d="M85 18 C66 18 58 34 57 48 C56 60 52 68 46 78 C40 90 36 112 34 158 L136 158 C134 112 130 90 124 78 C118 68 114 60 113 48 C112 34 104 18 85 18 Z"
                fill="url(#cloak)"
                stroke="#3d2b1c"
                stroke-width="1.2"
              />
              <circle cx="78" cy="50" r="2.6" fill="#C0392B" />
              <circle cx="92" cy="50" r="2.6" fill="#C0392B" />
              <defs>
                <linearGradient id="cloak" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#2b1d16" />
                  <stop offset="1" stop-color="#120c08" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div class="enemy-name">{{ intentLabel(enemy.id) }}</div>
          <HpBar :hp="enemy.hp" :max-hp="enemy.maxHp" :block="enemy.block" />
          <BuffRow :buffs="enemy.buffs" />
          <DamageFloat v-for="f in floatersFor[enemy.id] ?? []" :key="f.id" :floater="f" />
        </div>
      </div>

      <!-- 战场带 -->
      <div class="field-band">
        <div class="player-panel">
          <div class="pp-name">血械侍僧 <small v-if="player && player.hp * 2 < player.maxHp">失控线已激活</small></div>
          <HpBar
            v-if="player"
            :hp="player.hp"
            :max-hp="player.maxHp"
            :block="player.block"
            :height="18"
            :show-limit="true"
          />
          <BuffRow v-if="player" :buffs="player.buffs" />
          <DamageFloat v-for="f in floatersFor['player'] ?? []" :key="f.id" :floater="f" />
        </div>
        <PollutionGauge :value="player?.pollution ?? 0" />
      </div>

      <!-- 手牌区 -->
      <div class="hand-zone">
        <div class="hand" :class="{ targeting: store.targeting !== null }">
          <CardView
            v-for="(card, index) in hand"
            :key="card.instanceId"
            :card-id="card.cardId"
            :cost="card.cost"
            :keywords="card.keywords"
            :type="card.type"
            :playable="card.playable && canAct"
            :selected="store.targeting === index"
            :dragging="drag?.index === index && drag?.moved === true"
            :index="index"
            :hand-count="hand.length"
            :enhancements="card.enhancements"
            @grab="onGrab"
          />
        </div>

        <div class="left-corner">
          <EnergyOrb
            v-if="player"
            :energy="player.energy"
            :max-energy="player.maxEnergy"
            :charge="player.charge"
            :blood-hp="player.hp"
            :max-hp="player.maxHp"
          />
        </div>

        <div class="right-corner">
          <div class="pile" :title="'抽牌堆 ' + (state?.piles.draw.length ?? 0) + ' 张'">
            <span>{{ state?.piles.draw.length ?? 0 }}</span><b>抽牌堆</b>
          </div>
          <div class="pile" :title="'弃牌堆 ' + (state?.piles.discard.length ?? 0) + ' 张'">
            <span>{{ state?.piles.discard.length ?? 0 }}</span><b>弃牌堆</b>
          </div>
          <div class="pile" :title="'消耗堆 ' + (state?.piles.exhaust.length ?? 0) + ' 张'">
            <span>{{ state?.piles.exhaust.length ?? 0 }}</span><b>消耗堆</b>
          </div>
          <button class="endturn" :disabled="!canAct" @click="store.endTurn()">结束回合</button>
        </div>
      </div>

      <!-- 拖拽幽灵卡 -->
      <div
        v-if="drag && drag.moved && ghostCard"
        class="drag-ghost"
        :style="{ left: drag.x + 'px', top: drag.y + 'px' }"
      >
        <CardView
          :card-id="ghostCard.cardId"
          :cost="ghostCard.cost"
          :keywords="ghostCard.keywords"
          :type="ghostCard.type"
          :playable="true"
          :selected="false"
          :index="0"
          :hand-count="1"
          :enhancements="ghostCard.enhancements"
        />
      </div>

      <div v-if="store.message" class="message">{{ store.message }}</div>

      <!-- 日志抽屉 -->
      <div v-if="showLog" class="log-drawer">
        <BattleLog :entries="logEntries" />
        <DebugConsole v-if="isDev" :feedback="store.message" @command="store.debug($event)" />
      </div>

      <!-- 结算 -->
      <div v-if="store.over" class="result">
        <h2 :class="store.result">{{ store.result === "win" ? "胜 利" : "死 亡" }}</h2>
        <p>{{ store.result === "win" ? "锈蚀回廊的敌人已被肃清。" : "血肉归还于锈。" }}</p>
        <div class="result-actions">
          <button class="etch-btn" @click="restart">再战</button>
          <button class="etch-btn" @click="back">返回标题</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.battle-stage {
  animation: none;
}
.battle-stage.shaking {
  animation: shake 0.2s ease-out;
}
@keyframes shake {
  0%, 100% { transform: scale(var(--stage-scale, 1)) translate(0, 0); }
  25% { transform: scale(var(--stage-scale, 1)) translate(-6px, 2px); }
  50% { transform: scale(var(--stage-scale, 1)) translate(5px, -2px); }
  75% { transform: scale(var(--stage-scale, 1)) translate(-3px, 1px); }
}

.enemy.drop-target .enemy-fig {
  filter: drop-shadow(0 0 18px rgba(192, 57, 43, 1)) brightness(1.15);
}

.drag-ghost {
  position: fixed;
  z-index: 60;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0.9);
  filter: drop-shadow(0 18px 26px rgba(0, 0, 0, 0.8));
}

.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  background: linear-gradient(180deg, rgba(10, 8, 6, 0.9), transparent);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
.topbar .r { display: flex; gap: 16px; }
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }

.enemy-zone {
  position: absolute; top: 56px; left: 0; right: 0; height: 290px;
  display: flex; justify-content: center; gap: 40px; z-index: 10;
}
.enemy { position: relative; width: 300px; text-align: center; transition: opacity var(--dur-hit); }
.enemy.dead { opacity: 0.25; filter: grayscale(1); }
.enemy.targetable { cursor: crosshair; }
.enemy.targetable:hover .enemy-fig { filter: drop-shadow(0 0 14px rgba(192, 57, 43, 0.9)); }
.enemy-fig {
  margin-top: 26px; height: 170px; display: flex; align-items: flex-end; justify-content: center;
  filter: drop-shadow(0 18px 14px rgba(0, 0, 0, 0.75));
}
.enemy-name { font-family: var(--serif-title); font-size: 15px; letter-spacing: 0.3em; margin: 6px 0; color: var(--ink-bone); }

.field-band {
  position: absolute; left: 0; right: 0; bottom: 212px; height: 110px; z-index: 10;
  display: flex; align-items: center; justify-content: space-between; padding: 0 42px;
}
.player-panel {
  position: relative; width: 340px; background: rgba(18, 16, 14, 0.82);
  border: 1px solid rgba(176, 141, 74, 0.4);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 8px 24px rgba(0, 0, 0, 0.5);
  padding: 12px 16px; border-radius: var(--radius-sm);
}
.pp-name { font-size: 13px; letter-spacing: 0.28em; color: var(--ink-bone); margin-bottom: 8px; }
.pp-name small { font-size: 10px; color: var(--blood-hi); letter-spacing: 0.12em; margin-left: 8px; }

.hand-zone { position: absolute; left: 0; right: 0; bottom: 0; height: 212px; z-index: 20; }
.hand {
  position: absolute; left: 50%; bottom: -16px; transform: translateX(-50%);
  display: flex; align-items: flex-end; height: 230px;
}
.hand.targeting::after {
  content: "选择目标"; position: absolute; top: -6px; left: 50%; transform: translateX(-50%);
  font-size: 11px; letter-spacing: 0.3em; color: var(--blood-hi);
}
.left-corner { position: absolute; left: 34px; bottom: 26px; z-index: 25; }
.right-corner { position: absolute; right: 34px; bottom: 26px; z-index: 25; display: flex; align-items: flex-end; gap: 14px; }
.pile {
  width: 52px; height: 72px; position: relative; cursor: default;
  background: linear-gradient(160deg, #1c1915, #0f0d0a);
  border: 1px solid rgba(176, 141, 74, 0.45); border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 3px 3px 0 rgba(0, 0, 0, 0.4), 6px 6px 0 rgba(0, 0, 0, 0.25);
  display: flex; align-items: center; justify-content: center;
}
.pile span { font-family: var(--serif-num); font-size: 16px; color: var(--gold); }
.pile b { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--ink-dim); font-weight: 400; white-space: nowrap; }
.endturn {
  margin-left: 10px; padding: 12px 22px; font-family: var(--serif-title); font-size: 14px; letter-spacing: 0.3em;
  color: var(--ink-bone); background: linear-gradient(180deg, #2a2116, #171208);
  border: 1px solid var(--gold); border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 6px 18px rgba(0, 0, 0, 0.5);
}
.endturn:hover:not(:disabled) { background: linear-gradient(180deg, #3a2d1a, #1d1509); color: #fff; }
.endturn:disabled { opacity: 0.45; cursor: not-allowed; }

.message {
  position: absolute; left: 50%; bottom: 220px; transform: translateX(-50%); z-index: 35;
  font-size: 12px; letter-spacing: 0.2em; color: var(--blood-hi);
}

.log-drawer {
  position: absolute; top: 34px; right: 0; bottom: 0; width: 380px; z-index: 40;
  background: rgba(12, 10, 8, 0.96);
  border-left: 1px solid rgba(176, 141, 74, 0.4);
  display: flex; flex-direction: column;
}
.log-drawer :deep(.log) { flex: 1; }

.result {
  position: absolute; inset: 0; z-index: 50; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  background: rgba(6, 4, 3, 0.86);
}
.result h2 { font-family: var(--serif-title); font-size: 52px; letter-spacing: 0.4em; font-weight: 600; }
.result h2.win { color: var(--gold); text-shadow: 0 0 30px rgba(176, 141, 74, 0.6); }
.result h2.lose { color: var(--blood-hi); text-shadow: 0 0 30px rgba(192, 57, 43, 0.6); }
.result p { color: var(--ink-dim); font-size: 13px; letter-spacing: 0.2em; }
.result-actions { display: flex; gap: 14px; margin-top: 10px; }
.result-actions .etch-btn { padding: 10px 24px; font-size: 13px; }
</style>
