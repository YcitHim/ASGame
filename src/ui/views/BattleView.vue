<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import { eyeAvailable, previewEnergyCost, type BattleState } from "@/core/combat";
import type { CardDefinition } from "@/core/registry";
import { loadGameContent, t } from "@/data/load";
import { useBattleStore } from "@/stores/battle";
import { useRunStore } from "@/stores/run";
import { useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";
import { useTutorialStore } from "@/stores/tutorial";
import { useStageFit } from "@/ui/composables/useStageFit";
import { actCopy } from "@/ui/act-copy";
import { TUTORIAL_TITLE } from "@/ui/tutorial";
import { stepDebugCommands } from "@/ui/tutorial-script";
import { describeEvent, type LogEntry } from "@/ui/log-format";
import BattleLog from "@/ui/components/BattleLog.vue";
import BuffRow from "@/ui/components/BuffRow.vue";
import CardView from "@/ui/components/CardView.vue";
import DamageFloat from "@/ui/components/DamageFloat.vue";
import DebugConsole from "@/ui/components/DebugConsole.vue";
import EnergyOrb from "@/ui/components/EnergyOrb.vue";
import HpBar from "@/ui/components/HpBar.vue";
import IntentIcon from "@/ui/components/IntentIcon.vue";
import LibraryPicker from "@/ui/components/LibraryPicker.vue";
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
/** 神眼取牌浮层开合（docs/58 §七.2）；只做表现，可用性由 core 判定 */
const eyeOpen = ref(false);

/** 教学每场开打前的 HP 下限：够付最高的一张血契（调血 5 血），保证机制课不会"没血可付"。 */
const TUTORIAL_MIN_HP = 25;

/** 教学进行中时，战斗来自脚本（docs/42）而不是 run 进度；卡组与 HP 由教学局带着走。 */
function startTutorialBattle(): void {
  const chapter = tutorial.chapter;
  if (!chapter || chapter.kind !== "battle" || !tutorial.run) return;
  // 教学不是真远征：上场前把 HP 垫到能付得起血契（调血 5 血），避免"机制课没血可付"卡死
  const hp = Math.max(TUTORIAL_MIN_HP, Math.min(tutorial.run.maxHp, tutorial.run.hp));
  tutorial.run.hp = hp;
  store.startTutorial({
    chapterId: chapter.id,
    seed: chapter.seed,
    enemies: chapter.enemies,
    ...(chapter.enemyHp !== undefined ? { enemyHp: chapter.enemyHp } : {}),
    deck: tutorial.run.deck,
    hp,
    maxHp: tutorial.run.maxHp,
    // 职业身份件按教学局记下的职业取——从标题页续做时并没有在跑的远征
    relics: game.content.classes.get(tutorial.run.classId)?.startRelics ?? [],
  });
  // 战斗建好之后再发样例牌 / 钉敌人意图（否则会打空）
  applyStepScript();
}

/**
 * 教学章走完 → 回教学页看下一章的「课时卡 / 幕间」。
 * 不在这里直接开下一场战斗：否则玩家看不到课时卡，只会看到一闪而过的兜底页（玩家反馈）。
 */
function advanceTutorialChapter(): void {
  tutorial.nextChapter();
  void router.push("/tutorial");
}

/**
 * 教学步骤的脚本化动作（走 core 的 DebugCommand，完全确定性）：
 * - grant / classGrant → 把样例牌塞进手牌
 * - intent → 把敌人下一步钉死（不用靠种子碰运气，见 TutorialIntentScript）
 * 必须在战斗已经建好之后调用——immediate 的 watcher 跑在 onMounted 之前，那时还没有战斗。
 */
function applyStepScript(): void {
  if (!tutorial.active || !store.battle) return;
  const commands = stepDebugCommands({
    grant: tutorial.stepGrant,
    intent: tutorial.stepIntent,
    enemyId: store.battle.enemies[0]?.id ?? "",
  });
  for (const command of commands) store.debug(command);
}

watch(() => [tutorial.chapterIndex, tutorial.stepIndex] as const, () => applyStepScript());

/** Boss 首战的意图标签：玩家动过一手（进入第 2 回合）就收起，只留一次。 */
watch(
  () => store.battle?.turn,
  (turn) => {
    if ((turn ?? 1) > 1) bossIntentTag.value = false;
  },
);

/** ESC 打开设置（玩家习惯：ESC = 菜单）。设置页自 v1.0.3 起可滚动，能看全。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  // 拖动中 ESC = 取消这次出牌（docs/51 §三），交给拖拽自己的监听处理，不抢去开设置
  if (drag.value) return;
  // 神眼浮层 ESC = 收起浮层，不落到设置页
  if (eyeOpen.value) {
    eyeOpen.value = false;
    return;
  }
  // 瞄准态 ESC = 取消瞄准（与拖拽口径一致）
  if (store.targeting !== null) {
    store.selectTargetNoop();
    return;
  }
  if (store.over) return; // 结算界面上 ESC 不抢焦点，免得手滑关掉结果页
  void router.push("/settings");
}

/**
 * docs/45 Q4：Boss 首战给「敌人意图」破例挂一次金色胶囊标签（一局一次）。
 * 正式玩法不加常驻标签，这是唯一例外——Boss 的意图信息密度陡增，值得。
 */
const bossIntentTag = ref(false);

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  if (tutorial.active) {
    if (tutorial.chapter?.kind !== "battle") {
      void router.replace("/tutorial");
      return;
    }
    const expected = `tutorial:${tutorial.chapter.id}`;
    if (!store.battle || store.over || store.runKey !== expected) startTutorialBattle();
    return;
  }
  // 没有「进行中的一局」（直接访问 /battle、旧标签页、刷新）→ 先读档；
  // 读不到就回标题，**绝不在这里开新局**（甲方反馈：会用新游戏盖掉进度）。
  if (!run.ensureActive()) {
    void router.replace("/");
    return;
  }
  // Boss 首战：意图标签破例一次（一局只一次），第一次行动后自动收起
  if (run.current?.kind === "boss" && !run.bossIntentHintShown) {
    run.bossIntentHintShown = true;
    bossIntentTag.value = true;
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
/**
 * 眩晕（docs/46 §3.5）：被眩晕的整回合不可出牌——但**结束回合必须仍然可用**，
 * 否则玩家会被永久锁死在自己的回合里。所以这里单独给一个 canPlay。
 */
const stunned = computed(() => (player.value?.buffs ?? []).some((b) => b.id === "stun"));
const canPlay = computed(() => canAct.value && !stunned.value);

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

/**
 * 神眼（docs/58 §七.2）：超级大畸变·神眼档（开局污染快照 ≥400）解锁，每回合一次从**牌库**取一张。
 * 可用性走 core 的 eyeAvailable（与结算同源），UI 只负责开合浮层与转发选择。
 */
const eyeReady = computed(() => (state.value ? eyeAvailable(state.value) : false));
/** 牌库可选实例（核心抽牌堆顺序），传给选牌浮层。 */
const drawPile = computed(() => state.value?.piles.draw ?? []);

function openEye(): void {
  if (!eyeReady.value || !canAct.value) return;
  eyeOpen.value = true;
}

function chooseFromDraw(instanceId: string): void {
  eyeOpen.value = false;
  store.pickFromDraw(instanceId);
}

/**
 * 祭血狂热「销毁」（甲方 2026-10-08）：打出后必须从手牌选一张，本场战斗移出牌组（战后归还）。
 * 待选额度在 core（`destroyPending`），UI 只在 >0 时弹出强制浮层；选完额度归零自动收起。
 */
const destroyPending = computed(() => state.value?.destroyPending ?? 0);
const handPile = computed(() => state.value?.piles.hand ?? []);
function chooseDestroy(instanceId: string): void {
  store.destroyFromHand(instanceId);
}

// 用掉本回合名额 / 回合切换后，浮层必须收起——否则会停在「已不可选」的旧状态上
watch(eyeReady, (ready) => {
  if (!ready) eyeOpen.value = false;
});

/**
 * 蓄力释放红屏（甲方 2026-10-07）：**释放这一下**才泛红。
 *
 * 之前是「蓄力中且 thenIn ≤ 1 就常亮全屏红」，结果是蓄力的时候一直在紧张、
 * 真打下来那一下反而不亮——本末倒置。现在红屏只在 ChargeResolved(released) 那一帧出现
 * （store.releaseFlash），蓄力期间的信息交给敌人意图条与蓄力徽标。
 */
const releaseName = computed(() => {
  const flash = store.releaseFlash;
  if (!flash) return "";
  const enemy = enemies.value.find((e) => e.id === flash.enemyId);
  return enemy ? intentLabel(enemy.defId) : "";
});
/** Boss 蓄力台词：跟着释放那一下一起出（docs/27 §五 的「蓄力预警」台词位不变）。 */
const releaseLine = computed(() => {
  const flash = store.releaseFlash;
  if (!flash) return "";
  const enemy = enemies.value.find((e) => e.id === flash.enemyId);
  return enemy ? (game.i18n[`enemy.${enemy.defId}.line.charge`] ?? "") : "";
});

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
/**
 * 幕规则提示条（docs/67 §一 ⑧）：规则再好玩，玩家看不见就等于没有。
 * 只显示当前幕的**第一条**规则（当下每幕最多一条）；锻炉高温额外报「还差几回合生效」——
 * 软计时器必须让玩家数得出来。
 */
const actRule = computed(() => (store.battle?.actRules ?? [])[0] ?? null);
const actRuleName = computed(() => (actRule.value ? t(`actRule.${actRule.value.id}.name`, actRule.value.id) : ""));
const actRuleActive = computed(() => {
  const r = actRule.value;
  if (!r || r.id !== "forgeHeat") return true;
  const from = r.params?.["fromTurn"] ?? 5;
  return (store.battle?.turn ?? 0) >= from;
});
const actRuleNote = computed(() => {
  const r = actRule.value;
  if (!r) return "";
  if (r.id === "forgeHeat") {
    const from = r.params?.["fromTurn"] ?? 5;
    return (store.battle?.turn ?? 0) >= from
      ? t("actRule.forgeHeat.active", "已生效")
      : t("actRule.forgeHeat.pending", "第 {n} 回合起").replace("{n}", String(from));
  }
  return t(`actRule.${r.id}.desc`, "");
});

const showTutHint = computed(() => tutorial.active && tutorial.step !== undefined);
const battleAnim = computed(() => settings.values.battleAnim);
const showFloaters = computed(() => battleAnim.value !== "off");
/** 重读数（docs/51 §一）跟着动画档位走：off 档关闭，simple 档保留文字（震屏本来就只在 full 档） */
const showBigFloater = computed(() => battleAnim.value !== "off");
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
  /** 当前位置是否是合法落点（docs/51 §三）：幽灵卡据此在 50% 透明 / 实色之间切换 */
  legal: boolean;
  /** 指针悬在手牌区（= 松手即取消）：手牌区描边高亮 */
  overHand: boolean;
  /** 正在回弹归位（0.2s），此帧不接收输入 */
  returning: boolean;
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

/** 手牌区（拖动落点判定：落回这里 = 取消）。 */
const handZoneRef = useTemplateRef<HTMLElement>("handZone");

/** 落在这些 UI 面板上不算"出牌区"（docs/51 §三：日志/顶栏/结算/弹窗都要排除）。 */
const UI_BLOCKERS = ".hand-zone, .topbar, .log-drawer, .result, .menu-confirm";

function overUi(x: number, y: number): boolean {
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  return Boolean(el?.closest?.(UI_BLOCKERS));
}

function overHandZone(x: number, y: number): boolean {
  const el = handZoneRef.value;
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/**
 * 落点是否合法（docs/51 §三）：
 * - 目标卡：松手时命中存活敌人才结算；
 * - 无目标卡：落回手牌区 / 落在 UI 面板上 -> 取消；落在战场（舞台内）才结算。
 */
function dropIsLegal(index: number, x: number, y: number): boolean {
  if (overHandZone(x, y)) return false;
  const needsTarget = store.needsTarget(index);
  const enemyId = enemyAt(x, y);
  if (needsTarget) return enemyId !== null;
  if (overUi(x, y)) return false;
  const el = stage.value;
  if (!el) return false;
  const r = el.getBoundingClientRect();
  // 布局未就绪（jsdom / 首帧）时矩形为零：退回「不在 UI 面板上」的判定，别把正常落点判死
  if (r.width <= 0 || r.height <= 0) return true;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

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

/**
 * 取消这次拖拽（docs/51 §三）：0.2s 回弹到手牌原位，无消耗、无日志——
 * 取消不是事件，不该留痕。
 */
function cancelDrag(d: DragState): void {
  endDrag();
  const rect = lastCardRect.value;
  if (!rect) {
    drag.value = null;
    return;
  }
  drag.value = {
    ...d,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    hoverEnemy: null,
    overHand: false,
    legal: true,
    returning: true,
  };
  window.setTimeout(() => {
    if (drag.value?.returning) drag.value = null;
  }, 200);
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
    legal: false,
    overHand: false,
    returning: false,
  };

  const move = (e: PointerEvent) => {
    const d = drag.value;
    if (!d || d.returning) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    d.hoverEnemy = d.moved ? enemyAt(e.clientX, e.clientY) : null;
    d.overHand = d.moved && overHandZone(e.clientX, e.clientY);
    d.legal = d.moved && dropIsLegal(d.index, e.clientX, e.clientY);
  };

  const up = (e: PointerEvent) => {
    const d = drag.value;
    if (!d || d.returning) return;
    if (!d.moved) {
      // 轻点 = 选中手牌（需目标的卡进入瞄准模式）
      endDrag();
      drag.value = null;
      store.selectCard(d.index);
      return;
    }
    // 没拖到合法落点 = 取消（绝不替玩家做决定）
    if (!dropIsLegal(d.index, e.clientX, e.clientY)) {
      cancelDrag(d);
      return;
    }
    endDrag();
    drag.value = null;
    store.playCard(d.index, enemyAt(e.clientX, e.clientY));
  };

  // 拖动中按 ESC 或右键 = 立即取消
  const key = (e: KeyboardEvent) => {
    const d = drag.value;
    if (e.key !== "Escape" || !d || d.returning) return;
    e.preventDefault();
    cancelDrag(d);
  };
  const ctx = (e: MouseEvent) => {
    const d = drag.value;
    if (!d || d.returning) return;
    e.preventDefault();
    cancelDrag(d);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key);
  window.addEventListener("contextmenu", ctx);
  dragCleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key);
    window.removeEventListener("contextmenu", ctx);
  };
}

/** 瞄准态（轻点选中的目标卡）的取消路径：ESC / 右键 / 点空白（docs/51 §三）。 */
watch(
  () => store.targeting,
  (targeting, _prev, onCleanup) => {
    if (targeting === null) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-enemy-id], .card")) return;
      store.selectTargetNoop();
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      store.selectTargetNoop();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("contextmenu", onCtx);
    onCleanup(() => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("contextmenu", onCtx);
    });
  },
);

onBeforeUnmount(endDrag);
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const ghostCard = computed(() => (drag.value ? hand.value[drag.value.index] : undefined));

/** 拖拽幽灵卡的缩放系数（相对舞台缩放，等比缩小以免遮挡视野）。 */
const DRAG_GHOST_SCALE = 0.55;

function intentLabel(id: string): string {
  return game.content.enemies.get(id)?.name ?? id;
}

/**
 * 状态提示框要避让的「计量条区域」（docs/52 §3.2）。
 * 我方 = 失控线/HP 条 + 污染条；敌方 = 它自己的 HP 条。只在同一面板内查找。
 */
const PLAYER_TIP_AVOID = [".hpbar", ".gauge-wrap", ".limit-line"] as const;
const ENEMY_TIP_AVOID = [".hpbar"] as const;

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

/**
 * 阵亡后直接回主菜单（甲方反馈：不要"重新远征"，死了就回标题）。
 * 顺手清掉进度档，否则标题页会拿一具尸体去喂"继续远征"。
 */
function quitToTitle(): void {
  run.clearSave();
  store.skip();
  void router.push("/");
}

function goReward(): void {
  store.skip();
  // 教学：打完一场直接进下一章，走完回教学页收尾（docs/42）
  if (tutorial.active) {
    // 把本场结束时的 HP 带回教学局（下一场从这里开始；幕间篝火才有意义）
    if (store.battle && tutorial.run) tutorial.run.hp = Math.max(1, store.battle.player.hp);
    advanceTutorialChapter();
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
  // 回标题前先把进度写实（甲方 2026-10-08）：结算页退出不能丢这一局的推进
  run.persist();
  void router.push("/");
}

/**
 * 战斗中途回主菜单（甲方验收 2026-10-07）：原来只有「阵亡结算页」能回主菜单。
 * **保留远征进度**——标题页的「继续远征」还能回来，本场战斗从头再打。
 */
const menuOpen = ref(false);

function quitToTitleKeepRun(): void {
  menuOpen.value = false;
  run.persist();
  store.skip();
  void router.push("/");
}
</script>

<template>
  <div class="viewport">
    <div ref="stage" class="stage battle-stage" :class="{ shaking, 'tut-on': showTutHint }">
      <!-- 幕规则提示条（docs/67 §一 ⑧） -->
      <div v-if="actRule" class="act-rule" :class="{ active: actRuleActive }">
        <b>{{ actRuleName }}</b>
        <span>{{ actRuleNote }}</span>
      </div>
      <!-- 顶栏 -->
      <div class="topbar" :class="{ 'with-tut-hint': showTutHint }">
        <span v-if="tutorial.active">{{ TUTORIAL_TITLE }} · {{ tutorial.chapter?.title ?? "" }}</span>
        <span v-else>{{ actName }} — 遭遇 {{ store.battle?.battleId ?? "" }}</span>
        <div class="r">
          <span v-if="tutorial.active" @click="skipTutorial">跳过教学</span>
          <span @click="showLog = !showLog">{{ showLog ? "收起日志" : "日志" }}</span>
          <span @click="store.toggleSpeed()">{{ store.speed }}×</span>
          <span class="deck-entry" @click="router.push('/deck')">卡组</span>
          <span @click="router.push('/settings')">设置</span>
          <span class="menu-entry" @click="menuOpen = true">主菜单</span>
        </div>
        <!-- 教学旁白（docs/42 速成版）：第一行"这是什么 / 做什么"，第二行"为什么" -->
        <div v-if="showTutHint" class="tut-hint" :class="{ step: tutorial.needsAcknowledge }">
          <span class="tut-step">{{ tutorial.stepIndex + 1 }}/{{ tutorial.stepCount }}</span>
          <div class="tut-copy">
            <p v-if="tutorial.correction" class="tut-correct">{{ tutorial.correction }}</p>
            <p v-else>
              <b class="tut-why">{{ tutorial.step?.why }}</b>
              <span class="tut-how">{{ tutorial.step?.how }}</span>
            </p>
            <!-- 判定做到、这一步要求玩家点「知道了」才翻页（docs/43 甲方反馈） -->
            <p v-if="tutorial.stepDone && !tutorial.correction" class="tut-done">
              ✔ 做对了——点「知道了」继续。
            </p>
          </div>
          <button v-if="tutorial.needsAcknowledge" class="tut-ack" @click="tutorial.noteAcknowledge()">
            知 道 了
          </button>
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
            :class="{
              flip: store.flipUnits.includes(enemy.id),
              broken: store.brokenUnits.includes(enemy.id),
              'tut-focus': tutorial.focus === 'intent' || bossIntentTag,
            }"
            data-tut-label="敌人意图"
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
          <!-- 敌人状态：包一层滚动兜底 + 抬高 z（见 .enemy-buffs 注释）。
               玩家反馈：Boss / 多敌同屏时状态栏会被下方玩家面板或手牌盖住，等于没有这块信息 -->
          <div class="enemy-buffs">
            <BuffRow :buffs="enemy.buffs" compact :charge="chargeBadge(enemy)" :avoid="ENEMY_TIP_AVOID" />
          </div>
          <template v-if="showFloaters">
            <DamageFloat v-for="f in floatersFor[enemy.id] ?? []" :key="f.id" :floater="f" />
          </template>
        </div>
      </div>

      <!-- 战场带 -->
      <div class="field-band">
        <div
          class="player-panel"
          :class="{
            hit: store.hitUnits.includes('player'),
            dying: store.dyingUnits.includes('player'),
            'tut-focus': tutorial.focus === 'status',
          }"
          data-tut-label="状态栏"
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
          <!-- 教学「异常」那一课要先把这块指给玩家看：即使还没吃到减益也留一个空行 -->
          <div
            v-if="(player && player.buffs.length > 0) || tutorial.focus === 'debuff'"
            class="pp-status"
            :class="{ 'tut-focus': tutorial.focus === 'debuff' }"
            data-tut-label="异常挂在这"
          >
            <span class="pp-status-label">状态</span>
            <div class="pp-buffs">
              <!-- 状态多到超过一排时切紧凑芯片，保证 3 排以内装得下 -->
              <BuffRow
                v-if="player && player.buffs.length > 0"
                :buffs="player.buffs"
                align="start"
                :compact="player.buffs.length > 4"
                :avoid="PLAYER_TIP_AVOID"
              />
              <span v-else class="pp-empty">暂无异常</span>
            </div>
          </div>
          <template v-if="showFloaters">
            <DamageFloat v-for="f in floatersFor['player'] ?? []" :key="f.id" :floater="f" />
          </template>
        </div>
        <PollutionGauge :value="player?.pollution ?? 0" />
      </div>

      <!-- 手牌区 -->
      <div
        ref="handZone"
        class="hand-zone"
        :class="{
          'tut-focus': tutorial.focus === 'hand',
          'drop-cancel': drag?.moved && drag?.overHand,
        }"
        data-tut-label="手牌区"
      >
        <div v-if="stunned" class="stun-banner">眩 晕 · 本回合不可出牌，可以直接结束回合</div>
        <div class="hand" :class="{ targeting: store.targeting !== null }">
          <CardView
            v-for="(card, index) in hand"
            :key="card.instanceId"
            :card-id="card.cardId"
            :cost="card.cost"
            :charge-cost="card.def?.chargeCost ?? 0"
            :keywords="card.keywords"
            :type="card.type"
            :playable="card.playable && canPlay"
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

        <div class="left-corner" :class="{ 'tut-focus': tutorial.focus === 'energy' }" data-tut-label="能量">
          <EnergyOrb
            v-if="player"
            :energy="player.energy"
            :max-energy="player.maxEnergy"
            :charge="player.charge"
            :blood-hp="player.hp"
            :max-hp="player.maxHp"
            :trait-id="state?.traitId ?? ''"
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
          <button
            v-if="eyeReady"
            class="eye-btn"
            :disabled="!canAct"
            title="神眼：从牌库任选一张入手（每回合一次）"
            @click="openEye"
          >
            神 眼
          </button>
          <button class="endturn" :disabled="!canAct" @click="store.endTurn()">结束回合</button>
        </div>
      </div>

      <!-- 拖拽幽灵卡：Teleport 到 body，避免被 .stage 的 transform 影响 fixed 坐标 -->
      <Teleport to="body">
        <div
          v-if="drag && drag.moved && ghostCard"
          class="drag-ghost"
          :class="{ returning: drag.returning, illegal: !drag.returning && !drag.legal }"
          :style="{
            left: drag.x + 'px',
            top: drag.y + 'px',
            transform: `translate(-50%, -30%) rotate(-3deg) scale(${stageScale * DRAG_GHOST_SCALE})`,
          }"
        >
          <CardView
            :card-id="ghostCard.cardId"
            :cost="ghostCard.cost"
            :charge-cost="ghostCard.def?.chargeCost ?? 0"
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

      <!-- 蓄力释放：全屏泛红压在这一击上（甲方：蓄力时不亮，砸下来才亮） -->
      <div v-if="store.releaseFlash" :key="store.releaseFlash.id" class="release-flash">
        <div class="telegraph-line" />
        <p class="telegraph-charge">
          {{ releaseName }} 蓄力释放
          <template v-if="store.releaseFlash.value > 0"> —— <b>{{ store.releaseFlash.value }}</b> 点重击</template>
        </p>
        <p v-if="releaseLine" class="telegraph-line-quote">「{{ releaseLine }}」</p>
        <div class="telegraph-line" />
      </div>

      <!-- 重读数（docs/51 §一）：事件级大字，舞台中轴偏上（敌人区与手牌区之间） -->
      <div
        v-if="showBigFloater && store.bigFloater"
        :key="store.bigFloater.id"
        class="bigfloat"
        :class="store.bigFloater.tier"
      >
        {{ store.bigFloater.text }}
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



      <!-- 日志抽屉 -->
      <div v-if="showLog" class="log-drawer">
        <BattleLog :entries="logEntries" />
        <!-- 调试指令台（甲方 2026-10-08）：日志抽屉里常驻，输入 help 看全部指令 -->
        <DebugConsole
          :feedback="store.debugFeedback || store.message"
          @command="store.debug($event)"
        />
      </div>

      <!-- 神眼取牌（docs/58 §七.2）：从牌库任选一张入手 -->
      <LibraryPicker
        v-if="eyeOpen && state"
        :instance-ids="drawPile"
        :instances="state.cardInstances"
        @pick="chooseFromDraw"
        @close="eyeOpen = false"
      />

      <!-- 祭血狂热「销毁」（甲方 2026-10-08）：从手牌选一张，本场战斗移出牌组、战斗结束归还 -->
      <LibraryPicker
        v-if="state && destroyPending > 0 && state.phase === 'playerAction'"
        :instance-ids="handPile"
        :instances="state.cardInstances"
        title="销 毁 · 选 牌"
        sub="从手牌里选一张，本场战斗移出牌组 —— 战斗结束归还。"
        empty-text="手牌已空 —— 没有可销毁之牌。"
        :dismissable="false"
        @pick="chooseDestroy"
        @close="() => {}"
      />

      <!-- 战斗中途回主菜单的确认（避免手滑丢掉这一局的战场） -->
      <div v-if="menuOpen" class="menu-confirm" @click.self="menuOpen = false">
        <div class="menu-box">
          <p class="menu-title">回 到 主 菜 单 ？</p>
          <p class="menu-note">远征进度会保留——标题页点「继续远征」能回来，本场战斗从头再打。</p>
          <div class="menu-actions">
            <button class="etch-btn" @click="quitToTitleKeepRun">返回标题</button>
            <button class="etch-btn ghost" @click="menuOpen = false">取消</button>
          </div>
        </div>
      </div>

      <!-- 结算 -->
      <div v-if="store.over" class="result">
        <p v-if="bossDeathLine" class="boss-last">「{{ bossDeathLine }}」</p>
        <h2 :class="store.result">{{ store.result === "win" ? "胜 利" : "死 亡" }}</h2>
        <p>{{ resultCopy }}</p>
        <div class="result-actions">
          <button v-if="store.result === 'win'" class="etch-btn" @click="goReward">继续</button>
          <button v-else class="etch-btn" @click="quitToTitle">返回主菜单</button>
          <button v-if="store.result === 'win'" class="etch-btn" @click="back">返回标题</button>
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
/* 不可结算的位置：幽灵卡降到 50% 透明（取消权是看得见的，docs/51 §三） */
.drag-ghost.illegal {
  opacity: 0.5;
  filter: none;
}
/* 回弹归位：0.2s 回到手牌原位，无消耗、无日志 */
.drag-ghost.returning {
  opacity: 0.5;
  transition: left 0.2s ease-out, top 0.2s ease-out, opacity 0.2s ease-out;
}
/* 悬在手牌区 = 松手即取消：给手牌区描边提示 */
.hand-zone.drop-cancel::before {
  content: "松手取消";
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 3px 14px;
  font-size: 11px;
  letter-spacing: 0.24em;
  color: var(--gold);
  background: rgba(12, 10, 8, 0.9);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-sm);
}
.hand-zone.drop-cancel {
  outline: 1px dashed rgba(176, 141, 74, 0.6);
  outline-offset: -4px;
}

.topbar {
  position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 30;
  display: flex; align-items: center; justify-content: space-between; padding: 0 18px;
  font-size: 12px; letter-spacing: 0.18em; color: var(--ink-dim);
  background: linear-gradient(180deg, rgba(10, 8, 6, 0.9), transparent);
  border-bottom: 1px solid rgba(110, 88, 54, 0.25);
}
/* 幕规则提示条（docs/67 §一 ⑧）：挂在顶栏下方居中，未生效时压暗、生效时亮起来 */
.act-rule {
  position: absolute;
  top: 34px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 14px;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--ink-dim);
  border: 1px solid rgba(110, 88, 54, 0.28);
  border-bottom-left-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
  background: rgba(14, 12, 10, 0.62);
  pointer-events: none;
}
.act-rule b {
  font-weight: 400;
  color: var(--gold-dim);
  letter-spacing: 0.2em;
}
.act-rule.active {
  color: var(--blood-hi);
  border-color: rgba(138, 43, 31, 0.45);
}
.act-rule.active b { color: var(--blood-hi); }

.topbar .r { display: flex; gap: 16px; }
.topbar .r span { cursor: pointer; }
.topbar .r span:hover { color: var(--gold); }
/* 回主菜单：战斗中途唯一出口，给一点可见度，但不喧宾夺主 */
.topbar .r .menu-entry { color: var(--ink-bone); opacity: 0.9; }
/* z-index 12：必须高过 .field-band（10）——两者矩形重叠，
   同层级时"后出现的赢"，敌人状态栏会被玩家面板整块盖住（玩家反馈的 Boss 状态栏看不见）。 */
.enemy-zone {
  position: absolute; top: 56px; left: 0; right: 0; height: 290px;
  display: flex; justify-content: center; gap: 40px; z-index: 12;
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
/*
 * 敌人状态区：116px = 恰好三排芯片（38 × 3 + 2），超出在这里内部滚动。
 *
 * 三排是实测出来的上限：敌人内容顶在 y≈386（舞台坐标），三排到 500，
 * 手牌区从 508 起（z 20）——再多一排就会被卡面盖住。长局 Boss 能堆到
 * 灼烧/冰缓/眩晕/颠倒/蚀锈/污染/坚韧/荆棘 十几条，必须留兜底；
 * 但也不该比原来更少（原来无上限时三排刚好可见），所以卡在三排而不是两排。
 */
.enemy-buffs {
  position: relative;
  max-height: 116px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.field-band {
  /* height 168（原 128）：状态行满 3 排也装得下（甲方验收 2026-10-07） */
  position: absolute; left: 0; right: 0; bottom: 212px; height: 168px; z-index: 10;
  display: flex; align-items: center; justify-content: space-between; padding: 0 42px;
}
.player-panel {
  /* width 420（原 340）：带名字的状态芯片一行放得下 4 枚，8 个状态只占 2 排 */
  position: relative; width: 420px; background: rgba(18, 16, 14, 0.82);
  /* 底边贴住手牌区上沿（bottom:212）：面板只会往上长，绝不会被手牌压住看不见 */
  align-self: flex-end; max-height: 100%;
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
  /* 允许被压缩：面板高度封顶时，先压状态行，而不是让内容溢到面板外面 */
  min-height: 0;
}
/* 状态芯片的滚动兜底放在内层：.pp-status 本身不能变成滚动容器，
   否则教学导览贴在它右边的那枚标签会被 overflow-x 裁掉。 */
.pp-buffs {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  /* 74px = 恰好两排芯片（34 + 6 + 34，docs/52 §3.1 放大了条目高度），不露半排。
     超出就在这里内部滚动——绝不允许外溢到面板外面被手牌盖住。 */
  max-height: 74px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.pp-status-label { flex: none; padding-top: 7px; font-size: 10px; letter-spacing: 0.24em; color: var(--ink-dim); }
.pp-status .buffrow { margin-top: 0; }
.pp-empty { padding-top: 7px; font-size: 11px; letter-spacing: 0.16em; color: var(--ink-dim); opacity: 0.7; }
.pp-name small { font-size: 10px; color: var(--blood-hi); letter-spacing: 0.12em; margin-left: 8px; }

/* 眩晕（docs/46 §3.5）：不可出牌但可结束回合，横幅把规则说清楚 */
        .stun-banner {
          position: absolute; top: -4px; left: 50%; transform: translateX(-50%); z-index: 6;
          padding: 4px 14px;
          font-family: var(--serif-title); font-size: 12px; letter-spacing: 0.24em;
          color: #d9c2ff; background: rgba(40, 24, 60, 0.92);
          border: 1px solid rgba(158, 106, 194, 0.75); border-radius: 999px;
          box-shadow: 0 0 16px rgba(158, 106, 194, 0.4);
          animation: stun-pulse 1.6s ease-in-out infinite;
        }
        @keyframes stun-pulse {
          0%, 100% { box-shadow: 0 0 12px rgba(158, 106, 194, 0.35); }
          50% { box-shadow: 0 0 22px rgba(158, 106, 194, 0.65); }
        }
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
/* 神眼（docs/58 §七.2）：畸变专属出口，压在「结束回合」左侧。污染紫，区别于常规金色操作 */
.eye-btn {
  margin-left: 10px; padding: 12px 18px; font-family: var(--serif-title); font-size: 13px; letter-spacing: 0.24em;
  color: #e6d4ff; background: linear-gradient(180deg, #35204a, #1c1030);
  border: 1px solid #9e6ac2; border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 18px rgba(158, 106, 194, 0.4);
}
.eye-btn:hover:not(:disabled) { background: linear-gradient(180deg, #46295f, #25143c); color: #fff; }
.eye-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.message {
  position: absolute; left: 50%; bottom: 220px; transform: translateX(-50%); z-index: 35;
  font-size: 12px; letter-spacing: 0.2em;
}
/* 报错（打牌失败）血色；操作引导（选择目标）金色，不抢眼也不吓人（docs/41 §2.1） */
.message.error { color: var(--blood-hi); }
.message.info { color: var(--gold); }

/* 重读数（docs/51 §一）：中央偏上、64~96px 按档分级的弹性缩放入场 + 1.2s 停留。
   常规飘字是信息层，这一级是情绪层——位置离开单位头顶，余光必达。 */
.bigfloat {
  position: absolute;
  left: 50%;
  top: 356px;
  transform: translateX(-50%);
  z-index: 46;
  pointer-events: none;
  white-space: nowrap;
  font-family: var(--serif-num);
  font-size: 80px;
  line-height: 1;
  letter-spacing: 0.06em;
  color: var(--blood-hi);
  text-shadow: 0 0 26px rgba(192, 57, 43, 0.85), 0 4px 6px rgba(0, 0, 0, 0.9);
  animation: bigfloat-pop 1.2s ease-out forwards;
}
/* ① 重创：血红，最大档 */
.bigfloat.wound {
  font-size: 88px;
  color: #f0b4a8;
  text-shadow: 0 0 30px rgba(192, 57, 43, 0.95), 0 4px 6px rgba(0, 0, 0, 0.9);
}
/* ② 完全格挡：冰蓝 */
.bigfloat.guard {
  font-size: 72px;
  letter-spacing: 0.16em;
  color: #bfe0f5;
  text-shadow: 0 0 26px rgba(143, 182, 216, 0.95), 0 4px 6px rgba(0, 0, 0, 0.9);
}
/* ③ 重击：锈金 */
.bigfloat.heavy {
  font-size: 80px;
  color: #dcb86e;
  text-shadow: 0 0 30px rgba(176, 141, 74, 0.95), 0 4px 6px rgba(0, 0, 0, 0.9);
}
/* ④ 致命：描金「击溃」 */
.bigfloat.finish {
  font-size: 96px;
  letter-spacing: 0.3em;
  color: var(--gold);
  text-shadow: 0 0 34px rgba(176, 141, 74, 1), 0 0 8px rgba(0, 0, 0, 0.95);
}
@keyframes bigfloat-pop {
  0% { opacity: 0; transform: translateX(-50%) scale(0.5); }
  14% { opacity: 1; transform: translateX(-50%) scale(1.18); }
  26% { transform: translateX(-50%) scale(1); }
  78% { opacity: 1; transform: translateX(-50%) translateY(-6px) scale(1); }
  100% { opacity: 0; transform: translateX(-50%) translateY(-18px) scale(1); }
}

/* 蓄力释放全屏泛红（甲方）：一次性脉冲，0.8s 收干净——常亮会把「紧张」变成「背景」 */
.release-flash {
  position: absolute; inset: 0; z-index: 45; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: radial-gradient(ellipse 80% 70% at 50% 50%, transparent 38%, var(--act-warn) 100%);
  animation: release-flash 0.8s ease-out forwards;
}
.release-flash p {
  font-family: var(--serif-title); font-size: 17px; letter-spacing: 0.34em;
  color: #f0b4a8; text-shadow: 0 0 18px rgba(192, 57, 43, 0.9), 0 2px 3px #000;
}
/* 预警文字压在敌人血条上会看不清：加暗色底衬（玩家反馈） */
.release-flash .telegraph-charge {
  padding: 5px 22px;
  border: 1px solid rgba(192, 57, 43, 0.4);
  border-radius: 2px;
  background: rgba(8, 5, 4, 0.78);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
}
.release-flash b {
  color: #fff;
  font-family: var(--serif-num);
  font-size: 20px;
}
.release-flash .telegraph-line { width: 460px; height: 1px; background: linear-gradient(90deg, transparent, var(--blood-hi), transparent); }

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
/* 起手一记重击感：瞬间亮起 + 轻微放大，然后收干净 */
@keyframes release-flash {
  0% { opacity: 0; transform: scale(1.04); }
  12% { opacity: 1; transform: scale(1); }
  55% { opacity: 0.7; }
  100% { opacity: 0; }
}

.log-drawer {
  position: absolute; top: 34px; right: 0; bottom: 0; width: 380px; z-index: 40;
  background: rgba(12, 10, 8, 0.96);
  border-left: 1px solid rgba(176, 141, 74, 0.4);
  display: flex; flex-direction: column;
}
.log-drawer :deep(.log) { flex: 1; }

/* 战斗中途回主菜单：轻量确认（甲方验收 2026-10-07）。
   不弹 window.confirm——那会跳出游戏画面，和整套自制 UI 割裂。 */
.menu-confirm {
  position: absolute; inset: 0; z-index: 55;
  display: flex; align-items: center; justify-content: center;
  background: rgba(6, 4, 3, 0.72);
}
.menu-box {
  width: 430px; padding: 22px 26px;
  text-align: center;
  background: linear-gradient(165deg, #1c1915, #100d0a);
  border: 1px solid var(--edge-gold);
  border-radius: var(--radius-md);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.7), 0 18px 44px rgba(0, 0, 0, 0.8);
}
.menu-title { font-family: var(--serif-title); font-size: 20px; letter-spacing: 0.34em; color: var(--ink-bone); }
.menu-note { margin-top: 12px; font-size: 11px; line-height: 1.9; letter-spacing: 0.12em; color: var(--ink-dim); }
.menu-actions { display: flex; justify-content: center; gap: 14px; margin-top: 20px; }
.menu-actions .etch-btn { padding: 9px 22px; font-size: 12px; }
.menu-actions .etch-btn.ghost {
  background: none; border-color: rgba(110, 88, 54, 0.5); color: var(--ink-dim);
}
.menu-actions .etch-btn.ghost:hover { color: var(--gold); border-color: var(--gold); }

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
  display: flex; align-items: flex-start; justify-content: center; gap: 14px;
  padding: 7px 18px;
  background: rgba(12, 10, 8, 0.9);
  border: 1px solid var(--edge-gold); border-radius: var(--radius-sm);
}
.tut-step {
  flex: none; padding-top: 2px;
  font-family: var(--serif-title); font-size: 11px; letter-spacing: 0.14em; color: var(--gold-dim);
}
.tut-copy { max-width: 860px; text-align: left; }
.tut-why { margin-right: 10px; font-size: 12px; font-weight: 400; color: var(--gold); letter-spacing: 0.06em; }
.tut-how { font-size: 12px; letter-spacing: 0.06em; color: var(--ink-bone); }
/* 纠错（docs/42 §四）：做错了不推进，但也不惩罚——只说一句该怎么改 */
.tut-correct { font-size: 12px; letter-spacing: 0.06em; color: var(--blood-hi); }
.tut-done { margin-top: 2px; font-size: 12px; letter-spacing: 0.06em; color: var(--gold); }
/* 导览步的「知道了」：玩家读完自己翻页 */
.tut-ack {
  flex: none; padding: 4px 12px;
  font-family: var(--serif-title); font-size: 12px; letter-spacing: 0.2em;
  color: #1c1408;
  background: linear-gradient(180deg, #dcb86e, #a8803d);
  border: 1px solid #ecd8a4; border-radius: var(--radius-sm);
}
.tut-ack:hover { filter: brightness(1.08); }

/* UI 导览：说到哪，哪一块就亮（金框 + 呼吸），其余保持原样不干扰 */
.tut-focus {
  outline: 2px solid var(--gold);
  outline-offset: 4px;
  border-radius: var(--radius-sm);
  animation: tut-focus-pulse 1.5s ease-in-out infinite;
}
@keyframes tut-focus-pulse {
  0%, 100% { outline-color: rgba(176, 141, 74, 0.55); }
  50% { outline-color: rgba(216, 180, 106, 1); }
}
/*
 * 指引标签（甲方要求：能量 / 卡牌 / 异常的指引区做清楚一点；docs/45 Q1 统一叫「异常」）：
 * 光有金框新手还是不知道"这是干嘛的"——把区域名直接钉在被高亮的那一块上。
 * 标签锚在自己的区块上，随舞台缩放一起走，不写死在屏幕坐标里。
 */
/* 只给"本来没定位"的区块补定位；手牌区 / 能量球本身是 absolute，不能被覆盖成 relative */
.intent-slot.tut-focus[data-tut-label],
.pp-status.tut-focus[data-tut-label] { position: relative; }
.tut-focus[data-tut-label]::after {
  content: attr(data-tut-label);
  position: absolute; top: -26px; left: 50%; transform: translateX(-50%);
  z-index: 40;
  padding: 2px 12px; white-space: nowrap;
  font-size: 11px; letter-spacing: 0.18em;
  color: #1c1408;
  background: linear-gradient(180deg, #dcb86e, #a8803d);
  border: 1px solid #ecd8a4; border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.65);
  pointer-events: none;
  animation: tut-focus-pulse 1.5s ease-in-out infinite;
}
/* 意图图标在屏幕最上方：标签放它下面，免得顶到顶栏 */
.intent-slot.tut-focus[data-tut-label]::after { top: 100%; margin-top: 6px; }
/* 手牌区是通栏：标签贴在手牌上方一点 */
.hand-zone.tut-focus[data-tut-label]::after { top: 6px; }
/* 状态行矮且窄：标签挂到它右边，别压住血条 */
.pp-status.tut-focus[data-tut-label]::after {
  top: 50%; left: calc(100% + 10px); transform: translateY(-50%);
}
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