/**
 * ui/tutorial · 「第一班岗」脚本（docs/42）
 *
 * 形态：一段 10~12 分钟、被全程旁白的**引导式微型远征**——序章 → 课1 → 幕间A（奖励）
 * → 课2 → 幕间B（地图/篝火）→ 课3 → 结业清单 → 无缝进正式远征第一层。
 *
 * 三条原则（docs/42 §二）：
 *  1. 在真实循环里教，不在隔离沙盘里教；
 *  2. 先建心智模型（why），再教操作（how）；
 *  3. 允许犯错（correct 话术），绝不允许迷茫（免死 + 常驻跳过）。
 *
 * 每个知识点写两句：why = 为什么（模型），how = 怎么做（操作）。
 */

/** 步骤完成判定（docs/42 §六-2：由 2 种扩为 6 种）。 */
export type TutorialGoal =
  | { kind: "playType"; cardType: string }
  | { kind: "playCardId"; cardId: string }
  /** 能量花光（打牌后 energy === 0） */
  | { kind: "energyEmpty" }
  /** 结束回合时能量为 0，或手里已无可打的牌 */
  | { kind: "spendAll" }
  /** 结束回合 */
  | { kind: "endTurn" }
  /** 带着格挡结束回合：格挡就是临时的血，要在挨打前叠 */
  | { kind: "blockEndTurn"; min: number }
  /** 敌人的蓄力重击落地后仍活着 */
  | { kind: "survivedRelease" }
  /** 挨了这一下，且格挡真的替玩家吃掉了一部分（docs/42 §三.5 step 3） */
  | { kind: "blockedHit" }
  /** 清场（自由行动，教完就放手） */
  | { kind: "killAll" };

export interface TutorialStep {
  /** 为什么（心智模型） */
  readonly why: string;
  /** 怎么做（操作） */
  readonly how: string;
  /** 高亮这类手牌 */
  readonly highlightType?: string;
  /** 高亮这张牌 */
  readonly highlightCardId?: string;
  /** 这一步开始时把这几张牌塞进手牌（机制课用；走 core 的 DebugCommand，确定性） */
  readonly grant?: readonly string[];
  /** 同上，但按职业给（防御课要用本职业的格挡牌，否则手里可能一张都没有 → 卡死） */
  readonly classGrant?: Readonly<Record<string, readonly string[]>>;
  readonly goal: TutorialGoal;
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
  readonly seed: number;
  readonly steps: readonly TutorialStep[];
  /** 按职业替换/追加的后半段（职业机制课，docs/42 §三.7） */
  readonly classSteps?: Readonly<Record<string, readonly TutorialStep[]>>;
}

export interface TutorialScreenChapter {
  readonly kind: "screen";
  readonly id: string;
  readonly title: string;
  /** 2~4 行台词 */
  readonly lines: readonly string[];
  readonly cta: string;
}

export interface TutorialRewardChapter {
  readonly kind: "reward";
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
  /** 三选一的固定候选（1 攻 1 防 1 花活），按职业给，固定不随机 */
  readonly offers: Readonly<Record<string, readonly string[]>>;
  /** 逐张点评：教选牌思路，不替玩家选 */
  readonly comments: Readonly<Record<string, string>>;
  readonly cta: string;
}

export interface TutorialMapNode {
  readonly id: string;
  readonly kind: "battle" | "rest";
  readonly label: string;
  readonly note: string;
}

export interface TutorialMapChapter {
  readonly kind: "map";
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
  readonly nodes: readonly TutorialMapNode[];
  /** 选了篝火之后的二选一 */
  readonly restLines: readonly string[];
  readonly restHeal: string;
  readonly restUpgrade: string;
}

export interface TutorialGraduationChapter {
  readonly kind: "graduation";
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
  /** 结业清单：八条（docs/42 §三.8） */
  readonly checklist: readonly string[];
  readonly cta: string;
}

export type TutorialChapter =
  | TutorialScreenChapter
  | TutorialBattle
  | TutorialRewardChapter
  | TutorialMapChapter
  | TutorialGraduationChapter;

export const TUTORIAL_TITLE = "第一班岗";

/** 第三课最后的收尾步（每个职业机制段之后共用）。 */
const FINISH_STEP: TutorialStep = {
  why: "它这一记已经交掉了，接下来只能一拳一拳还你——趁空窗把伤害砸回去。",
  how: "打掉它，这一课就完了。",
  goal: { kind: "killAll" },
};

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  {
    kind: "screen",
    id: "prologue",
    title: "你要干什么",
    lines: [
      "你要从这一层爬到顶，干掉守顶的那个大家伙。",
      "路上会死。死了就从头再来——但图鉴、解锁和你的记性，会留下来。",
      "这一班，我陪你走。",
    ],
    cta: "上 岗",
  },
  {
    kind: "battle",
    id: "lesson1",
    title: "第一课 · 出牌与回合循环",
    theme: "手牌是你的动作，能量是你的力气。",
    enemies: ["rust_hound"],
    seed: 7,
    steps: [
      {
        why: "手牌是你的动作，能量是你的力气。",
        how: "左上角数字是这张牌的费用——先打一张攻击牌试试。",
        highlightType: "attack",
        goal: { kind: "playType", cardType: "attack" },
      },
      {
        why: "能量不隔夜：这一回合用不完，下回合也不会补给你。",
        how: "把剩下的力气花完，别省。",
        highlightType: "attack",
        // 宽口径（docs/42 §三.3 step 2 原文）：能量花光，**或者**手里已经没有打得起的牌。
        // 只用「能量恰好 = 0」会卡死：比如剩 1 点能量、手里只剩 2 费牌时永远满足不了。
        goal: { kind: "spendAll" },
        strict: true,
        correct: "还有力气没用完——再打一张能打得起牌，或者手牌都太贵时点「结束回合」也算过关。",
      },
      {
        why: "没打出去的牌不会留在手里。每个回合结束时，它们都会飞进弃牌堆。",
        how: "点右下角「结束回合」，看着手里的牌飞走。",
        goal: { kind: "endTurn" },
      },
      {
        why: "牌堆抽空了，弃牌堆会洗回牌堆——好牌烂牌都会再见，出牌不用心疼。",
        how: "把这只锈犬打掉，你就出师第一步了。",
        goal: { kind: "killAll" },
      },
    ],
  },
  {
    kind: "reward",
    id: "interludeA",
    title: "幕间 · 第一次奖励",
    lines: [
      "打赢一场，挑一张牌进卡组。卡组是你这一局的资产，会一直跟着你。",
      "新手口诀：不知道选什么，就选能马上用的——费用低、效果直白的牌。",
    ],
    offers: {
      bloodwright: ["strike", "defend", "bloodbolt"],
      engineer: ["pistonjab", "brassguard", "gearspin"],
      rustspeaker: ["rustspit", "scrapguard", "toxsip"],
    },
    comments: {
      strike: "1 费打 6。最不花脑子的一张，什么时候都不亏。",
      defend: "1 费 5 格挡。挨打的时候，它就是你的另一条命。",
      bloodbolt: "卖 2 血打 9。伤害高，但要先付血——先想清楚你这条命还剩多少。",
      pistonjab: "1 费打 3，充能到位时再补 2 点。炉心的基本拳。",
      brassguard: "1 费 5 格挡。攻击牌够多了？那就补一张保命的。",
      gearspin: "0 费：拿 1 点充能还抽 1 张。不占能量，等于白拿。",
      rustspit: "1 费打 5，再往敌人身上种 2 层蚀锈——它每回合自己掉血。",
      scrapguard: "1 费 7 格挡。锈语者的防御效率比别家高一点。",
      toxsip: "0 费：吃 8 点污染，抽 1 张。毒也是弹药，但别吃满 100。",
    },
    cta: "拿 走 它",
  },
  {
    kind: "battle",
    id: "lesson2",
    title: "第二课 · 意图与生存",
    theme: "敌人头顶的图标，是它下回合的预告。",
    enemies: ["corroded_swarm"],
    seed: 1,
    steps: [
      {
        why: "敌人头顶的图标是它下回合要干的事：剑就是要揍你，数字就是揍多狠。",
        how: "先看一眼再出牌，然后结束回合，让它动手。",
        goal: { kind: "endTurn" },
      },
      {
        why: "格挡就是临时的血：它先替你挨，挨完就没了。",
        how: "它预告了攻击——打防御牌把格挡叠起来，再结束回合。",
        highlightType: "skill",
        // 保底给一张本职业的格挡牌：起手 5 张里有没有防御是发牌运气，不能拿运气卡住严判定
        classGrant: {
          bloodwright: ["defend"],
          engineer: ["brassguard"],
          rustspeaker: ["scrapguard"],
        },
        goal: { kind: "blockEndTurn", min: 1 },
        strict: true,
        correct: "这一下会打在你身上——先打一张高亮的防御牌叠格挡，再结束回合。",
      },
      {
        why: "看，格挡替你吃掉了伤害。但格挡每回合开始会清零。",
        how: "所以要在挨打前叠，别提前浪费。",
        goal: { kind: "blockedHit" },
      },
      {
        why: "能打就打，别舍不得——这游戏不奖励收藏家。",
        how: "把它打掉，我们就去地图上看看。",
        goal: { kind: "killAll" },
      },
    ],
  },
  {
    kind: "map",
    id: "interludeB",
    title: "幕间 · 地图与篝火",
    lines: [
      "远征是在地图上选路往上爬。地图上的字是这样念的：剑 = 战斗，角 = 精英（难打但赏好），火 = 休息，砧 = 祭坛，匣 = 奖励，？ = 撞运气，颅 = 首领——它在顶上。",
      "两条路都能走，没有对错——选一条我告诉你后果。",
    ],
    nodes: [
      { id: "fight", kind: "battle", label: "剑 · 小怪", note: "再来一场，多一张牌进卡组。" },
      { id: "rest", kind: "rest", label: "篝火 · 休息", note: "回血或升级一张牌，把状态养起来。" },
    ],
    restLines: [
      "篝火能回血，也能把一张牌永久升级。",
      "活着到 Boss 面前，比什么流派都重要。",
    ],
    restHeal: "回 血（+30% 上限）",
    restUpgrade: "升 级 一 张 牌",
  },
  {
    kind: "battle",
    id: "lesson3",
    title: "第三课 · 蓄力与你的职业",
    theme: "它攒了一记狠的——先活着，再还手。",
    enemies: ["riveted_heavy"],
    seed: 10,
    steps: [
      {
        why: "这个大家伙在蓄力：它架起格挡，头顶写着「几回合后释放多少伤害」。",
        how: "先别急，结束回合看它表演。",
        goal: { kind: "endTurn" },
      },
      {
        why: "红框里的「即将承受 X 伤害」就是那一下。这一回合，先活着。",
        how: "把格挡叠够，再结束回合硬吃它。",
        highlightType: "skill",
        goal: { kind: "survivedRelease" },
      },
    ],
    classSteps: {
      bloodwright: [
        {
          why: "你的职业是血械侍僧：先付血，再收货。卖血是你的战斗方式，不是自残。",
          how: "打这张「调血」——先付 5 血，下回合开始回 7 血。这笔账要等一个回合，别急着算。",
          grant: ["transfusion"],
          highlightCardId: "transfusion",
          goal: { kind: "playCardId", cardId: "transfusion" },
        },
        FINISH_STEP,
      ],
      engineer: [
        {
          why: "你的职业是炉心机士：充能给你所有攻击加码，攒着放大的。",
          how: "先打「火花塞」拿 1 点充能。",
          grant: ["sparkplug", "chargedhammer"],
          highlightCardId: "sparkplug",
          goal: { kind: "playCardId", cardId: "sparkplug" },
        },
        {
          why: "但别贪——充能超过 10 会过载，炸自己 5 点。",
          how: "再打「充能锤」：充能越高，它砸得越狠。",
          // 保底再发一次：玩家可能在上一步就把锤子打了，那这一步就没牌可打（死结）
          grant: ["chargedhammer"],
          highlightCardId: "chargedhammer",
          goal: { kind: "playCardId", cardId: "chargedhammer" },
        },
        FINISH_STEP,
      ],
      rustspeaker: [
        {
          why: "你的职业是锈语者：污染是毒药，也是弹药。满 100 会反噬 10 点。",
          how: "打「毒啜」——用 8 点污染换一张牌。",
          grant: ["toxsip", "rustspit"],
          highlightCardId: "toxsip",
          goal: { kind: "playCardId", cardId: "toxsip" },
        },
        {
          why: "蚀锈是锈语者的看家本事：种进敌人身体里，它每回合自己掉血。",
          how: "打一张「锈唾」，把锈种上去。",
          grant: ["rustspit"],
          highlightCardId: "rustspit",
          goal: { kind: "playCardId", cardId: "rustspit" },
        },
        FINISH_STEP,
      ],
    },
  },
  {
    kind: "graduation",
    id: "graduation",
    title: "结 业",
    lines: ["这班你值完了。往后的岗，自己站——忘了就回标题页翻「图鉴」，或者从设置里再叫我。"],
    checklist: [
      "出牌花能量，能量不隔夜",
      "没打的牌进弃牌堆，会洗回来",
      "敌人头顶是预告，先看再动",
      "格挡是临时的血，挨打前叠",
      "打赢挑牌，卡组跟着你走",
      "地图选路，篝火续命",
      "红框「即将承受」＝ 先保命",
      "你的职业绝活（血契 / 充能 / 污染）",
    ],
    cta: "开 始 远 征",
  },
];

export function tutorialChapter(index: number): TutorialChapter | undefined {
  return TUTORIAL_CHAPTERS[index];
}

/** 取本章（含职业追加段）的完整步骤表。 */
export function chapterSteps(chapter: TutorialChapter | undefined, classId: string): readonly TutorialStep[] {
  if (!chapter || chapter.kind !== "battle") return [];
  const extra = chapter.classSteps?.[classId] ?? [];
  return [...chapter.steps, ...extra];
}
