/**
 * ui/tutorial · 「第一班岗」脚本（docs/42，2026-10-07 按甲方要求重构为速成版）
 *
 * 目标变了：不是"陪着走完一段微型远征"，而是**几分钟内让新手看懂屏幕、敢出手**。
 * 甲方原话：「进入第一关，告知哪里是状态栏、哪里看剩余能量、哪里是手牌区、哪里是敌人意图；
 * 然后教怎么攻击、怎么防御、对方的异常状态、诅咒效果。就差不多够了，你这个太墨迹了。」
 *
 * 所以这一版只有**一场战斗**，八个步骤：
 *   ① 状态栏 ② 能量 ③ 手牌区 ④ 敌人意图（四个"这是哪儿"）→ ⑤ 攻击 → ⑥ 防御
 *   → ⑦ 敌人给你挂的异常 → ⑧ 打掉它
 * 每条一句话，玩家点「知道了」才翻页；幕间、三课、结业清单全部砍掉。
 */

/** 步骤完成判定（保持少而硬：能靠事件判的绝不让人点）。 */
export type TutorialGoal =
  /** 读完一句，点「知道了」翻页（UI 导览用） */
  | { kind: "acknowledge" }
  /** 打出某类牌（attack / skill） */
  | { kind: "playType"; cardType: string }
  /** 打出指定牌（职业机制课用；当前脚本未使用，保留给后续） */
  | { kind: "playCardId"; cardId: string }
  /** 带着格挡结束回合 */
  | { kind: "blockEndTurn"; min: number }
  /** 敌人给你挂了异常（污染 / 虚弱 / 易伤…） */
  | { kind: "playerDebuffed" }
  /** 清场 */
  | { kind: "killAll" };

/** 这一步要高亮屏幕上的哪一块（UI 导览的核心：说到哪指到哪）。 */
export type TutorialFocus = "status" | "energy" | "hand" | "intent" | "debuff";

/**
 * 教学脚本钉死的敌人意图（docs/42 速成版改版）：
 * 教学不再靠种子碰运气——每一步可以直接指定敌人下一步做什么，保证「一回合蓄力」
 * 「挂异常」这两课一定演得到。走 core 的 DebugCommand（与 give card 同一套）。
 */
export interface TutorialIntentScript {
  readonly kind: "attack" | "debuff" | "charge";
  readonly value?: number;
  readonly block?: number;
  /** charge 的释放段伤害 */
  readonly release?: number;
  readonly buffId?: string;
}

export interface TutorialStep {
  /** 这是什么（第一行，金色） */
  readonly why: string;
  /** 它为什么重要 / 你要做什么（第二行） */
  readonly how: string;
  /** 高亮屏幕上的一块区域 */
  readonly focus?: TutorialFocus;
  /** 高亮这一类手牌 */
  readonly highlightType?: string;
  /** 高亮这张牌 */
  readonly highlightCardId?: string;
  /** 这一步开始时把敌人意图钉成指定值（见 TutorialIntentScript） */
  readonly intent?: TutorialIntentScript;
  /** 这一步开始时把这几张牌塞进手牌 */
  readonly grant?: readonly string[];
  /** 同上，按职业给（防御课要用本职业的格挡牌） */
  readonly classGrant?: Readonly<Record<string, readonly string[]>>;
  readonly goal: TutorialGoal;
  /**
   * 做到之后**不自动翻页**，停在原地等玩家点「知道了」再走（甲方反馈：
   * 吃到异常那一步没有引导，看完状态栏不知道下一步干嘛）。
   */
  readonly ack?: boolean;
  /** 严判定：没做到就不推进，给一句纠正 */
  readonly strict?: boolean;
  readonly correct?: string;
}

export interface TutorialBattle {
  readonly kind: "battle";
  readonly id: string;
  readonly title: string;
  readonly theme: string;
  readonly enemies: readonly string[];
  /** 教学用：统一覆盖敌人 HP，保证机制讲完之前它不会先死 */
  readonly enemyHp?: number;
  readonly seed: number;
  /** 旁白落款（docs/43 §三 #11）：老班长「铆叔」。彩蛋级存在，不展开剧情。 */
  readonly byline?: string;
  readonly steps: readonly TutorialStep[];
}

export interface TutorialGraduationChapter {
  readonly kind: "graduation";
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
  /** 署名（docs/43 §三 #11） */
  readonly byline?: string;
  readonly cta: string;
}

export type TutorialChapter = TutorialBattle | TutorialGraduationChapter;

export const TUTORIAL_TITLE = "第一班岗";

/** 教学旁白 = 老一代守夜人（docs/43 §三 #11 起名「铆叔」）。 */
export const TUTORIAL_NARRATOR = "铆叔";

/**
 * 只教一件事：**看懂屏幕 + 敢出手**。
 * 敌人 = 「污染布道者」，但意图不再看它的随机表——每一步都可以用 intent 钉死。
 *
 * 三回合打完（甲方：「周期太长了」）：
 *   回合1 挂异常 → 回合2 一回合蓄力（这一回合叠挡没用）→ 回合3 重击（这时叠挡才算数）→ 清场。
 */
export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  {
    kind: "battle",
    id: "lesson1",
    title: "第一课 · 看懂屏幕",
    theme: "你不需要记住所有规则，只要先认全这块屏幕。",
    enemies: ["polluting_preacher"],
    // 26 血：三回合内能打完，又够活到把「异常 / 蓄力」两课演完（原来 60 血太磨）
    enemyHp: 26,
    seed: 9,
    byline: "—— 铆叔 · 老一代守夜人",
    steps: [
      {
        why: "这是你的状态栏",
        how: "红条是命，下面是格挡和状态——敌人给你挂的异常全显示在这。",
        focus: "status",
        // 从第一回合就让它盯上你：意图课上正好看到「给你挂异常」的图标
        intent: { kind: "debuff", buffId: "weak", value: 1 },
        goal: { kind: "acknowledge" },
      },
      {
        why: "这是能量",
        how: "每回合回满，打牌就花它；用不完不隔夜。",
        focus: "energy",
        goal: { kind: "acknowledge" },
      },
      {
        why: "这是手牌区",
        how: "动作全在这。左上角数字是费用，变灰就是现在打不起。",
        focus: "hand",
        goal: { kind: "acknowledge" },
      },
      {
        why: "这是敌人意图",
        how: "它头顶的图标预告下回合干什么：剑＝攻击（数字是伤害）、盾＝防御、写「弱」「污」＝给你挂异常、紫＝蓄力。",
        focus: "intent",
        goal: { kind: "acknowledge" },
      },
      {
        why: "先打它一下",
        how: "点一张高亮的攻击牌打出去。",
        highlightType: "attack",
        goal: { kind: "playType", cardType: "attack" },
      },
      {
        why: "小心敌人给你挂的「诅咒」",
        how: "结束回合，它就会给你挂异常（虚弱 / 污染）。挂上之后显示在状态栏这一行。",
        focus: "debuff",
        // 钉一次：断点续做时这一步不会因为敌人随机出招而卡住
        intent: { kind: "debuff", buffId: "weak", value: 1 },
        goal: { kind: "playerDebuffed" },
        // 吃到异常后停一下，让玩家点「知道了」再走（甲方反馈：6/8 没有引导）
        ack: true,
      },
      {
        why: "它在蓄力——这一回合别急着叠挡",
        how: "紫色蓄力＝下回合放重击；而格挡每回合开始就清零，现在叠的挡到重击那回合早就没了。直接结束回合，下回合再叠。",
        focus: "intent",
        // 钉一个「一回合蓄力」：这一课不让玩家等两个回合（甲方要求）
        intent: { kind: "charge", value: 2, block: 4, release: 10 },
        // min 0 = "把回合结束掉"；真正的叠挡判定在下一课
        goal: { kind: "blockEndTurn", min: 0 },
        ack: true,
      },
      {
        why: "重击来了——现在叠格挡才算数",
        how: "打一张防御牌叠格挡，再结束回合。格挡会先替你挨这一下。",
        focus: "intent",
        highlightType: "skill",
        // 起手 5 张里有没有防御是发牌运气，保底发一张本职业的格挡牌
        classGrant: {
          bloodwright: ["defend"],
          engineer: ["brassguard"],
          rustspeaker: ["scrapguard"],
        },
        goal: { kind: "blockEndTurn", min: 1 },
        strict: true,
        correct: "重击这一下真的会打在你身上——先打一张高亮的防御牌，再结束回合。",
      },
      {
        why: "最后，把它打掉。",
        how: "顶不住就继续叠格挡。到这儿你基本会玩了——后面遇到新东西，屏幕会自己提示你。",
        goal: { kind: "killAll" },
      },
    ],
  },
  {
    kind: "graduation",
    id: "graduation",
    title: "上 手 了",
    lines: [
      "三分钟，够你出门了：认屏幕、出牌、防御、看异常。",
      "剩下的（遗物、强化、路线）交给图鉴和屏幕提示——想再听一遍，设置里随时叫铆叔。",
    ],
    byline: "—— 铆叔",
    cta: "开 始 远 征",
  },
];

export function tutorialChapter(index: number): TutorialChapter | undefined {
  return TUTORIAL_CHAPTERS[index];
}

/** 取本章的步骤表（保留函数形态，视图与状态机都走它）。 */
export function chapterSteps(chapter: TutorialChapter | undefined): readonly TutorialStep[] {
  return chapter?.kind === "battle" ? chapter.steps : [];
}
