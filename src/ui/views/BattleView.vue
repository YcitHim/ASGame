<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import { previewEnergyCost, type BattleState } from "@/core/combat";
import type { CardDefinition } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useRunStore } from "@/stores/run";
import { useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";
import { isDebugEnabled } from "@/systems/debug";
import { useStageFit } from "@/ui/composables/useStageFit";
import { actCopy } from "@/ui/act-copy";
import { tutorialStage } from "@/ui/tutorial";
import { describeEvent, type LogEntry } from "@/ui/log-format";
import BattleLog from "@/ui/components/BattleLog.vue";
import BuffRow from "@/ui/components/BuffRow.vue";
import CardView from "@/ui/components/CardView.vue";
import DamageFloat from "@/ui/components/DamageFloat.vue";
import FirstTip from "@/ui/components/FirstTip.vue";
import DebugConsole from "@/ui/components/DebugConsole.vue";
import EnergyOrb from "@/ui/components/EnergyOrb.vue";
import HpBar from "@/ui/components/HpBar.vue";
import IntentIcon from "@/ui/components/IntentIcon.vue";
import PollutionGauge from "@/ui/components/PollutionGauge.vue";

const router = useRouter();
const store = useBattleStore();
const run = useRunStore();
const settings = useSettingsStore();
const tips = useTipsStore();
const tutorial = useTutorialStore();
const stage = useTemplateRef<HTMLElement>("stage");
const { scale: stageScale } = useStageFit(stage);

const game = loadGameContent();
const showLog = ref(false);
const shaking = ref(false);
const isDev = isDebugEnabled();

/** 教学进行中时，战斗来自脚本（docs/41 §4.3）而不是 run 进度。 */
function startTutorialStage(): void {
  const stage = tutorialStage(tutorial.stageIndex);
  if (!stage) return;
  store.startTutorial({ stageId: stage.id, seed: stage.seed, enemies: stage.enemies });
}

/** ESC 打开设置（玩家习惯：ESC = 菜单）。设置页自 v1.0.3 起可滚动，能看全。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (store.over) return; // 结算界面上 ESC 不抢焦点，免得手滑关掉结果页
  void router.push("/settings");
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  if (tutorial.active) {
    const stage = tutorialStage(tutorial.stageIndex);
    const expected = stage ? `tutorial:${stage.id}` : "";
    if (!store.battle || store.over || store.runKey !== expected) startTutorialStage();
    return;
  }
  // 新战斗 / 上一场已结算 / 换了职业或开了新局（陈旧战斗）时，都按当前局外卡组重开
  const expectedKey = `${run.run?.classId ?? ""}:${run.run?.seed ?? ""}`;
  if (!store.battle || store.over || store.runKey !== expectedKey) store.start();
  // 当前节点不是战斗节点（例如直接访问 /battle）→ 回到地图
  if (!store.battle) void router.replace("/map");
});

const state = computed<BattleState | null>(() => store.battle);
const player = computed(() => state.value?.player ?? null);
const enemies = computed(() => state.value?.enemies ?? []);
const phase = computed(() => state.value?.phase ?? "battleStart");
const canAct = computed(() => phase.value === "playerAction" && !store.playing && !store.over);

const hand = computed(() =>
  (state.value?.piles.hand ?? []).map((instanceId, index) => {
    const instance = state.value!.cardInstances[instanceId];
    const def: CardDefinition | undefined = game.content.cards.get(instance.cardId);
    // 费用可能被强化改写，走 core 的真实费用预览
    const cost = state.value ? previewEnergyCost(state.value, index) : 99;
    return {
      instanceId,
      cardId: instance.cardId,
      def,
      cost,
      keywords: def?.keywords ?? [],
      type: def?.type ?? "skill",
      rarity: def?.rarity ?? "common",
      enhancements: instance.enhancements.length,
      enhancementIds: instance.enhancements,
      upgraded: instance.upgraded,
      playable: cost <= (player.value?.energy ?? 0),
    };
  }),
);

const logEntries = computed<LogEntry[]>(() => store.log.map((e) => describeEvent(e, store.enemyNames)));

/** 蓄力预警：任意存活敌人正在蓄力 → 全屏提示（含"下回合多少点"的读招信息）。 */
const chargingEnemies = computed(() =>
  enemies.value
    .filter((e) => e.hp > 0 && e.intent?.kind === "charge")
    .map((e) => ({
      id: e.id,
      name: intentLabel(e.defId),
      // 直接读 i18n 表：t(key, "") 在缺失时会回退成 key 本身，会把原始 key 渲染到屏幕上
      line: game.i18n[`enemy.${e.defId}.line.charge`] ?? "",
      thenValue: e.intent?.thenValue,
      thenIn: e.intent?.thenIn,
      block: e.intent?.block,
    })),
);

/** 蓄力徽标（docs/19 §4）：蓄力中在敌人状态行显示「蓄力 ×N（M 回合后释放）」。 */
function chargeBadge(enemy: {
  intent: { kind: string; value?: number; thenIn?: number; block?: number } | null;
}): { stacks: number; thenIn: number; block: number } | null {
  const intent = enemy.intent;
  if (!intent || intent.kind !== "charge") return null;
  return { stacks: intent.value ?? 1, thenIn: intent.thenIn ?? 1, block: intent.block ?? 0 };
}

/** Boss 二阶段：首领节点且首领掉到半血以下 → 狂暴反馈（策划 Q13 可感知）。 */
const isBossNode = computed(() => run.current?.kind === "boss");
const bossEnraged = computed(
  () => isBossNode.value && enemies.value.some((e) => e.hp > 0 && e.hp * 2 < e.maxHp),
);
const phaseBanner = ref(false);
watch(bossEnraged, (now) => {
  if (!now) return;
  phaseBanner.value = true;
  setTimeout(() => (phaseBanner.value = false), 1800);
});

/** Boss 台词（docs/27 §五）：蓄力随预警、二阶段随横幅、死亡在结算前独白。 */
const bossOnline = computed(() => enemies.value.some((e) => e.id === "rust_throat"));
const bossPhaseLine = computed(() =>
  bossOnline.value ? (game.i18n["enemy.rust_throat.line.phase2"] ?? "") : "",
);
const bossDeathLine = computed(() =>
  bossOnline.value && store.result === "win" ? (game.i18n["enemy.rust_throat.line.death"] ?? "") : "",
);

/** 结算情境化文案（docs/29 ④）：按节点类型给专属句，战斗胜利两句轮换。 */
const resultCopy = computed(() => {
  if (store.result !== "win") return t("result.expeditionFail");
  const kind = run.current?.kind;
  if (kind === "boss") return actCopy("result.bossWin", run.run?.actIndex ?? 0);
  if (kind === "elite") return t("result.eliteWin");
  const seed = (store.battle?.battleId ?? "").length;
  const act = run.run?.actIndex ?? 0;
  return seed % 2 === 0
    ? t("result.battleWin")
    : actCopy("result.battleWinAlt", act);
});

const floatersFor = computed(() => {
  const map: Record<string, typeof store.floaters> = {};
  for (const f of store.floaters) {
    map[f.targetId] = [...(map[f.targetId] ?? []), f];
  }
  return map;
});

/**
 * 战斗动画三档（docs/41 §3.1）：full 全开 / simple 仅飘字 / off 全关。
 * 飘字是信息层（"挨打看得见"），simple 必须保留；位移与光效是装饰层，simple 关掉。
 */
const showTutHint = computed(() => tutorial.active && tutorial.step !== undefined);
const battleAnim = computed(() => settings.values.battleAnim);
const showFloaters = computed(() => battleAnim.value !== "off");
const showMotion = computed(() => battleAnim.value === "full");

// 首遇提示压后（docs/41 §4.1）：战斗高潮（动画播放中）不弹，等行动结束再出现
watch(
  () => store.playing,
  (playing) => tips.setBusy(playing),
  { immediate: true },
);

watch(
  () => store.shake,
  () => {
    if (!showMotion.value) return;
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

/* ---------- 打击感：出牌飞行（FLIP，docs/08 §6） ---------- */

const lastCardRect = ref<DOMRect | null>(null);
const flyFx = ref<{ cardId: string; x1: number; y1: number; x2: number; y2: number; seq: number } | null>(null);
const flyRef = useTemplateRef<HTMLElement>("flyRef");

function captureCardRect(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement | null;
  if (el) lastCardRect.value = el.getBoundingClientRect();
}

watch(
  () => store.cardPlayed?.seq,
  async () => {
    const info = store.cardPlayed;
    const rect = lastCardRect.value;
    if (!info || !rect) return;
    const targetEl = info.targetId
      ? document.querySelector(`[data-enemy-id="${info.targetId}"]`)
      : document.querySelector(".player-panel");
    const tr = targetEl?.getBoundingClientRect();
    const x1 = rect.left + rect.width / 2;
    const y1 = rect.top + rect.height / 2;
    const x2 = tr ? tr.left + tr.width / 2 : window.innerWidth / 2;
    const y2 = tr ? tr.top + tr.height / 2 : window.innerHeight / 2;
    flyFx.value = { cardId: info.cardId, x1, y1, x2, y2, seq: info.seq };
    await nextTick();
    const el = flyRef.value;
    if (el) {
      el.style.left = `${x1}px`;
      el.style.top = `${y1}px`;
      el.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${x2 - x1}px), calc(-50% + ${y2 - y1}px)) scale(0.7)`,
            opacity: 0.15,
          },
        ],
        { duration: 250, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" },
      );
    }
    setTimeout(() => (flyFx.value = null), 260);
  },
);

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
  captureCardRect(event);
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
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const ghostCard = computed(() => (drag.value ? hand.value[drag.value.index] : undefined));

/** 拖拽幽灵卡的缩放系数（相对舞台缩放，等比缩小以免遮挡视野）。 */
const DRAG_GHOST_SCALE = 0.55;

function intentLabel(id: string): string {
  return game.content.enemies.get(id)?.name ?? id;
}

/** 效果图基准里敌人名下方的一行称号（docs/15 §2）。 */
function enemyTitle(id: string): string {
  return game.i18n[`enemy.${id}.title`] ?? "";
}

/** 当前幕标题（act2 起不再是锈蚀回廊，docs/40）。 */
const actName = computed(() => t(run.act?.i18n ?? "", "第一幕 · 锈蚀回廊"));

/** 本局职业名（不再写死血械侍僧）。 */
const className = computed(() => {
  const def = run.classDef;
  return def ? t(`${def.i18n}.name`, def.id) : "血械侍僧";
});
/** 失控线是血械侍僧的低血阈值标识：炉心机士不卖血，不显示（docs/29 §二⑥）。 */
const isBloodwright = computed(() => (run.run?.classId ?? "bloodwright") === "bloodwright");

function restartRun(): void {
  if (tutorial.active) {
    startTutorialStage();
    return;
  }
  store.restart();
}

function goReward(): void {
  store.skip();
  // 教学：打完一场直接进下一场，三场走完回教学页收尾（docs/41 §4.3）
  if (tutorial.active) {
    if (tutorial.completeStage() === "next") startTutorialStage();
    else void router.push("/tutorial");
    return;
  }
  void router.push("/reward");
}

/** 教学：随时跳过（不给奖励、不算完成）；已经开了局就继续远征。 */
function skipTutorial(): void {
  tutorial.abort();
  void router.push(run.active ? "/map" : "/");
}

function back(): void {
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage battle-stage" :class="{ shaking, 'tut-on': showTutHint }">
      <!-- 顶栏 -->
      <div class="topbar" :class="{ 'with-tut-hint': showTutHint }">
        <span v-if="tutorial.active">教 学 · {{ tutorial.stage?.title ?? "" }}</span>
        <span v-else>{{ actName }} — 遭遇 {{ store.battle?.battleId ?? "" }}</span>
        <div class="r">
          <span v-if="tutorial.active" @click="skipTutorial">跳过教学</span>
          <span @click="showLog = !showLog">{{ showLog ? "收起日志" : "日志" }}</span>
          <button
            class="skip-btn"
            :disabled="!store.playing"
            :title="store.playing ? '跳过本段动画' : '当前没有动画'"
            @click="store.skip()"
          >
            跳过
          </button>
          <span @click="store.toggleSpeed()">{{ store.speed }}×</span>
          <span @click="router.push('/settings')">设置</span>
        </div>
        <!-- 教学步骤提示（docs/41 §4.3）：占顶栏第二行，敌人区同步下移，不遮意图 -->
        <div v-if="showTutHint && tutorial.step" class="tut-hint">
          <span class="tut-step">{{ tutorial.stageIndex + 1 }}/{{ tutorial.total }} · {{ tutorial.stepIndex + 1 }}/{{ tutorial.stage?.steps.length }}</span>
          <span class="tut-text">{{ tutorial.step.hint }}</span>
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
            enraged: bossEnraged && enemy.hp > 0 && enemy.hp * 2 < enemy.maxHp,
            hit: store.hitUnits.includes(enemy.id),
            dying: store.dyingUnits.includes(enemy.id),
            charging: enemy.intent?.kind === 'charge' && enemy.hp > 0,
            lunge: showMotion && store.lungeUnits.includes(enemy.id),
            guard: showMotion && store.guardUnits.includes(enemy.id),
          }"
          :data-enemy-id="enemy.id"
          @click="pickEnemy(enemy.id)"
        >
          <div
            class="intent-slot"
            :class="{ flip: store.flipUnits.includes(enemy.id), broken: store.brokenUnits.includes(enemy.id) }"
          >
            <IntentIcon :intent="enemy.intent" />
            <span v-if="store.brokenUnits.includes(enemy.id)" class="broken-tag">断链</span>
          </div>
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
          <div class="enemy-name">
            {{ intentLabel(enemy.defId) }}
            <span v-if="bossEnraged && enemy.hp > 0 && enemy.hp * 2 < enemy.maxHp" class="rage-tag">狂暴</span>
          </div>
          <div v-if="enemyTitle(enemy.defId)" class="enemy-title">{{ enemyTitle(enemy.defId) }}</div>
          <HpBar
            :hp="enemy.hp"
            :max-hp="enemy.maxHp"
            :block="enemy.block"
            :block-hint="enemy.intent?.kind === 'charge' ? '蓄力架盾' : undefined"
          />
          <BuffRow :buffs="enemy.buffs" compact :charge="chargeBadge(enemy)" />
          <template v-if="showFloaters">
            <DamageFloat v-for="f in floatersFor[enemy.id] ?? []" :key="f.id" :floater="f" />
          </template>
        </div>
      </div>

      <!-- 战场带 -->
      <div class="field-band">
        <div
          class="player-panel"
          :class="{ hit: store.hitUnits.includes('player'), dying: store.dyingUnits.includes('player') }"
        >
          <div class="pp-name">
            {{ className }}
            <small v-if="isBloodwright && player && player.hp * 2 < player.maxHp">失控线已激活</small>
          </div>
          <HpBar
            v-if="player"
            :hp="player.hp"
            :max-hp="player.maxHp"
            :block="player.block"
            :height="18"
            :show-limit="isBloodwright"
          />
          <div v-if="player && player.buffs.length > 0" class="pp-status">
            <span class="pp-status-label">状态</span>
            <BuffRow :buffs="player.buffs" align="start" />
          </div>
          <template v-if="showFloaters">
            <DamageFloat v-for="f in floatersFor['player'] ?? []" :key="f.id" :floater="f" />
          </template>
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
            :enhancement-ids="card.enhancementIds"
            :upgraded="card.upgraded"
            :rarity="card.rarity"
            :highlight="tutorial.highlightType !== null && card.type === tutorial.highlightType"
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

      <!-- 拖拽幽灵卡：Teleport 到 body，避免被 .stage 的 transform 影响 fixed 坐标 -->
      <Teleport to="body">
        <div
          v-if="drag && drag.moved && ghostCard"
          class="drag-ghost"
          :style="{
            left: drag.x + 'px',
            top: drag.y + 'px',
            transform: `translate(-50%, -30%) rotate(-3deg) scale(${stageScale * DRAG_GHOST_SCALE})`,
          }"
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
      </Teleport>

      <!-- Boss 蓄力大招：全屏预警（带上后续伤害，读招才成立） -->
      <div v-if="chargingEnemies.length > 0" class="telegraph">
        <div class="telegraph-line" />
        <p v-for="charge in chargingEnemies" :key="charge.name" class="telegraph-charge">
          {{ charge.name }}<template v-if="charge.block"> 蓄力并架起 <b>{{ charge.block }}</b> 点格挡</template><template v-else> 正在蓄力</template> ——
          <template v-if="charge.thenValue !== undefined">
            {{ charge.thenIn && charge.thenIn > 1 ? charge.thenIn + " 回合后" : "下回合" }}
            <b>{{ charge.thenValue }}</b> 点重击
          </template>
          <template v-else>准备迎接重击</template>
        </p>
        <p v-for="charge in chargingEnemies.filter((c) => c.line)" :key="charge.name + '-line'" class="telegraph-line-quote">
          「{{ charge.line }}」
        </p>
        <div class="telegraph-line" />
      </div>

      <!-- 二阶段横幅 -->
      <div v-if="phaseBanner" class="phase-banner">
        <span class="phase-banner-title">锈 喉 · 第 二 阶 段</span>
        <span v-if="bossPhaseLine" class="phase-banner-line">{{ bossPhaseLine }}</span>
      </div>

      <!-- HP 低于 50%：屏幕边缘血色渐晕（docs/08 §6） -->
      <div v-if="player && player.hp * 2 < player.maxHp" class="vignette" />

      <!-- 出牌飞行 -->
      <Teleport to="body">
        <div v-if="flyFx" ref="flyRef" class="fly-card">
          {{ t(`card.${flyFx.cardId}.name`, flyFx.cardId) }}
        </div>
      </Teleport>

      <div v-if="store.message" class="message" :class="store.messageKind">{{ store.message }}</div>

      <!-- 首遇提示（docs/41 §4.1）：同屏至多 1 条 -->
      <FirstTip />



      <!-- 日志抽屉 -->
      <div v-if="showLog" class="log-drawer">
        <BattleLog :entries="logEntries" />
        <DebugConsole
        v-if="isDev || settings.values.developerMode"
        :feedback="store.message"
        @command="store.debug($event)"
      />
      </div>

      <!-- 结算 -->
      <div v-if="store.over" class="result">
        <p v-if="bossDeathLine" class="boss-last">「{{ bossDeathLine }}」</p>
        <h2 :class="store.result">{{ store.result === "win" ? "胜 利" : "死 亡" }}</h2>
        <p>{{ resultCopy }}</p>
        <div class="result-actions">
          <button v-if="store.result === 'win'" class="etch-btn" @click="goReward">继续</button>
          <button v-else class="etch-btn" @click="restartRun">重新远征</button>
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
  filter: drop-shadow(0 0 18px var(--act-glow)) brightness(1.15);
}

.drag-ghost {
  position: fixed;
  z-index: 60;
  pointer-events: none;
  opacity: 0.92;
  filter: drop-shadow(0 14px 22px rgba(0, 0, 0, 0.85));
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
/* 跳过：原来只有一个 17×10px 的文字，点不中就像"按了没用"（玩家反馈） */
.skip-btn {
  padding: 4px 10px; margin: -4px 0;
  font-size: 12px; letter-spacing: 0.24em; color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.45); border-radius: var(--radius-sm);
  background: rgba(18, 16, 14, 0.7);
}
.skip-btn:hover:not(:disabled) { color: var(--gold); border-color: var(--gold); }
.skip-btn:disabled { opacity: 0.4; cursor: default; }

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
.enemy-name { font-family: var(--serif-title); font-size: 15px; letter-spacing: 0.3em; margin: 5px 0 1px; color: var(--ink-bone); }
.enemy-title { font-size: 10px; letter-spacing: 0.18em; color: var(--ink-dim); margin-bottom: 4px; }

.field-band {
  position: absolute; left: 0; right: 0; bottom: 212px; height: 128px; z-index: 10;
  display: flex; align-items: center; justify-content: space-between; padding: 0 42px;
}
.player-panel {
  position: relative; width: 340px; background: rgba(18, 16, 14, 0.82);
  border: 1px solid rgba(176, 141, 74, 0.4);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.65), 0 8px 24px rgba(0, 0, 0, 0.5);
  padding: 12px 16px; border-radius: var(--radius-sm);
  display: flex; flex-direction: column; gap: 8px;
}
.pp-name { font-size: 13px; letter-spacing: 0.28em; color: var(--ink-bone); }
/* 状态区独占一行，与血条之间留分隔线，避免角标压在血条上 */
.pp-status {
  display: flex; align-items: flex-start; gap: 8px;
  padding-top: 7px; border-top: 1px solid rgba(110, 88, 54, 0.28);
}
.pp-status-label { flex: none; padding-top: 7px; font-size: 10px; letter-spacing: 0.24em; color: var(--ink-dim); }
.pp-status .buffrow { margin-top: 0; }
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
  font-size: 12px; letter-spacing: 0.2em;
}
/* 报错（打牌失败）血色；操作引导（选择目标）金色，不抢眼也不吓人（docs/41 §2.1） */
.message.error { color: var(--blood-hi); }
.message.info { color: var(--gold); }

/* Boss 蓄力全屏预警 */
.telegraph {
  position: absolute; inset: 0; z-index: 45; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: radial-gradient(ellipse 80% 70% at 50% 50%, transparent 45%, var(--act-warn) 100%);
  animation: telegraph-pulse 1.1s ease-in-out infinite;
}
.telegraph p {
  font-family: var(--serif-title); font-size: 17px; letter-spacing: 0.34em;
  color: #f0b4a8; text-shadow: 0 0 18px rgba(192, 57, 43, 0.9), 0 2px 3px #000;
}
/* 预警文字压在敌人血条上会看不清：加暗色底衬（玩家反馈） */
.telegraph-charge {
  padding: 5px 22px;
  border: 1px solid rgba(192, 57, 43, 0.4);
  border-radius: 2px;
  background: rgba(8, 5, 4, 0.78);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
}
.telegraph b {
  color: #fff;
  font-family: var(--serif-num);
  font-size: 20px;
}
.telegraph-line { width: 460px; height: 1px; background: linear-gradient(90deg, transparent, var(--blood-hi), transparent); }

/* 二阶段：狂暴反馈 */
.enemy.enraged .enemy-fig {
  filter: drop-shadow(0 0 22px rgba(192, 57, 43, 0.9)) brightness(1.1);
}
.rage-tag {
  margin-left: 8px;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: #f0b4a8;
  border: 1px solid rgba(192, 57, 43, 0.7);
  border-radius: 2px;
  padding: 1px 5px;
  background: rgba(60, 16, 10, 0.6);
}
.phase-banner-title { display: block; }
.phase-banner-line {
  display: block;
  margin-top: 10px;
  font-family: var(--serif-body);
  font-size: 15px;
  letter-spacing: 0.28em;
  color: var(--ink-bone);
  text-shadow: 0 0 14px rgba(192, 57, 43, 0.6);
}
.boss-last {
  font-family: var(--serif-body);
  font-size: 15px;
  font-style: italic;
  letter-spacing: 0.2em;
  color: #d8c6a8 !important;
}
.telegraph-line-quote {
  font-family: var(--serif-body) !important;
  font-size: 13px !important;
  font-style: italic;
  letter-spacing: 0.22em !important;
  color: #d8b6ac !important;
}
.phase-banner {
  position: absolute;
  top: 44%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 48;
  padding: 14px 42px;
  font-family: var(--serif-title);
  font-size: 26px;
  letter-spacing: 0.5em;
  color: #f0b4a8;
  background: rgba(10, 6, 5, 0.86);
  border-top: 1px solid var(--blood-hi);
  border-bottom: 1px solid var(--blood-hi);
  text-shadow: 0 0 22px rgba(192, 57, 43, 0.9);
  pointer-events: none;
  animation: banner-in 1.8s ease-out forwards;
}
@keyframes banner-in {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
  15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes telegraph-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
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
/* 打击感：命中闪白 80ms / 死亡下沉 500ms / 意图翻入 200ms / 出牌飞行 250ms / 低血渐晕 */
.enemy.hit .enemy-fig,
.player-panel.hit {
  animation: hit-flash 80ms linear;
}
@keyframes hit-flash {
  0% { filter: brightness(2.4) saturate(0.3); }
  100% { filter: brightness(1); }
}
/* 敌人攻击前扑（docs/41 §3.1）：向玩家方向位移 14px 后归位，0.25s ease-out；
   多段攻击由 store 逐段重播（pulseUnit），段间隔 0.12s。 */
.enemy.lunge .enemy-fig {
  animation: enemy-lunge 250ms ease-out;
}
@keyframes enemy-lunge {
  0% { transform: translateY(0); }
  35% { transform: translateY(14px); }
  100% { transform: translateY(0); }
}
/* 敌人架盾：护盾微光 */
.enemy.guard .enemy-fig {
  animation: enemy-guard 420ms ease-out;
}
@keyframes enemy-guard {
  0% { filter: drop-shadow(0 18px 14px rgba(0, 0, 0, 0.75)); }
  35% { filter: drop-shadow(0 0 18px rgba(143, 182, 216, 0.95)) brightness(1.15); }
  100% { filter: drop-shadow(0 18px 14px rgba(0, 0, 0, 0.75)); }
}
/* 蓄力：本体呼吸缩放，与预警文案形成视听双通道 */
.enemy.charging .enemy-fig {
  animation: enemy-breathe 1.6s ease-in-out infinite;
}
@keyframes enemy-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
/* 同一元素上的复合动画（后定义者生效，必须显式列出组合） */
.enemy.hit.lunge .enemy-fig {
  animation: enemy-lunge 250ms ease-out, hit-flash 80ms linear;
}
.enemy.charging.hit .enemy-fig {
  animation: enemy-breathe 1.6s ease-in-out infinite, hit-flash 80ms linear;
}
.enemy.charging.lunge .enemy-fig {
  animation: enemy-lunge 250ms ease-out, enemy-breathe 1.6s ease-in-out infinite;
}

/* 玩家飘字位置（docs/41 §3.2）：伤害 / 格挡浮在面板上沿（血条上方），
   减益浮名落在状态栏那一行——都不遮血条数字 */
/* 教学步骤提示带（docs/41 §4.3）：占顶栏第二行。
   原先浮在 top:42px，正好压住敌人意图（intent-slot 在 56~87px）——玩家看不清它要干什么。 */
.topbar.with-tut-hint {
  height: auto;
  min-height: 78px;
  padding: 8px 18px 10px;
  flex-wrap: wrap;
  align-content: center;
  row-gap: 8px;
}
.tut-hint {
  flex: none; width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 14px;
  padding: 7px 18px;
  background: rgba(12, 10, 8, 0.9);
  border: 1px solid var(--edge-gold); border-radius: var(--radius-sm);
}
.tut-step {
  flex: none; font-family: var(--serif-title); font-size: 11px; letter-spacing: 0.14em; color: var(--gold-dim);
}
.tut-text { font-size: 13px; letter-spacing: 0.1em; color: var(--ink-bone); }
/* 顶栏加高后，敌人区整体下移同样高度，意图图标重新露出来 */
.battle-stage.tut-on .enemy-zone { top: 96px; }

.player-panel .dmgfloat { top: -26px; }
.player-panel .dmgfloat.debuff { top: 74px; }

.enemy.dying {
  animation: unit-die 500ms ease-in forwards;
}
@keyframes unit-die {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0.25; transform: translateY(18px) scale(0.88); filter: grayscale(1) brightness(0.6); }
}
.intent-slot.flip {
  animation: intent-in 200ms ease-out;
}
.intent-slot.broken {
  filter: grayscale(0.4);
}
.intent-slot.broken::after {
  content: "";
  position: absolute;
  inset: 6% 14%;
  background: linear-gradient(45deg, transparent 46%, var(--blood-hi) 47%, var(--blood-hi) 53%, transparent 54%),
    linear-gradient(-45deg, transparent 46%, var(--blood-hi) 47%, var(--blood-hi) 53%, transparent 54%);
  opacity: 0.85;
  pointer-events: none;
}
.broken-tag {
  position: absolute;
  bottom: -14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 8px;
  font-size: 10px;
  letter-spacing: 0.24em;
  color: var(--blood-hi);
  background: rgba(10, 7, 5, 0.85);
  border: 1px solid rgba(192, 57, 43, 0.5);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
@keyframes intent-in {
  0% { transform: rotateX(90deg) scale(0.82); opacity: 0; }
  100% { transform: rotateX(0) scale(1); opacity: 1; }
}
.vignette {
  position: absolute;
  inset: 0;
  z-index: 38;
  pointer-events: none;
  background: radial-gradient(ellipse 78% 72% at 50% 50%, transparent 58%, var(--act-vignette) 100%);
  animation: vignette-pulse 2.6s ease-in-out infinite;
}
@keyframes vignette-pulse {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}
.fly-card {
  position: fixed;
  z-index: 70;
  width: 110px;
  height: 156px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-family: var(--serif-title);
  font-size: 13px;
  letter-spacing: 0.16em;
  color: var(--ink-bone);
  background: linear-gradient(165deg, #1c1915, #12100e);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-md);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.75);
}

/* 手机横屏（ADR-007）H2 走查：短视口把手牌整体上抬，避免卡牌底部被屏幕裁掉。
   必须放在样式表末尾——否则会被后面的基础 .hand 规则（同特异性）覆盖。 */
@media (max-height: 520px) {
  .hand-zone { height: 200px; }
  /* 扇形手牌带 translateY(lift) 下沉，边缘牌会探出底边；短视口整体上抬补偿 */
  .hand { bottom: 40px; height: 214px; }
  .message { bottom: 246px; }
}
</style>