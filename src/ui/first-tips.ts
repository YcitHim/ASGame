/**
 * ui/first-tips · 首遇提示词条（docs/41 §4.1）
 *
 * 每类机制第一次出现时弹一条，玩家点「知道了 / 不再提示」后写入 meta 存档，
 * 跨局不再出现；图鉴页可随时回看全部条目。
 * 原则（策划 §4.1）：同屏至多 1 条；战斗高潮（Boss 释放回合）延后到行动结束。
 */
export interface FirstTipDefinition {
  readonly id: string;
  readonly title: string;
  /** 2~4 行的说明；用 \n 分行 */
  readonly body: string;
}

export const FIRST_TIPS: readonly FirstTipDefinition[] = [
  {
    id: "discard",
    title: "弃牌阶段",
    body: "每个你的回合结束时，没打出的手牌会进入弃牌堆。\n牌堆抽空后，弃牌堆会洗回牌堆——所以不用省着出牌。",
  },
  {
    id: "bloodpact",
    title: "血契（卖血）",
    body: "血械侍僧以自身生命催动卡牌：先付血，再收效果。\n失去的生命是成本，换来的伤害或回复才是收益——先付款，后交货。",
  },
  {
    id: "retain",
    title: "保留",
    body: "「保留」指回合结束时不弃置这张手牌。\n保留的是牌，不是格挡——格挡每回合开始都会清零。",
  },
  {
    id: "charge",
    title: "蓄力与重击",
    body: "敌人蓄力时会架起格挡，并在释放前一回合显示「即将承受 X 伤害」。\n看到红框就是重击回合，先防御再输出。",
  },
  {
    id: "energy",
    title: "能量",
    body: "每回合开始回复固定能量，用不完不会留到下回合。\n卡牌左上角的数字就是它的费用。",
  },
  // ---- docs/42 §五：补循环层（原来的 5 条只管战斗） ----
  {
    id: "map_route",
    title: "选路",
    body: "在节点之间选路往上爬：剑 = 战斗，角 = 精英（难打但赏好），火 = 休息，砧 = 祭坛，匣 = 奖励，？ = 撞运气。\n顶上（颅）就是首领。",
  },
  {
    id: "reward_pick",
    title: "挑一张牌",
    body: "打赢一场就能挑一张牌进卡组，卡组是你这一局的资产。\n不知道选什么，就选马上能用的。",
  },
  {
    id: "elite",
    title: "精英",
    body: "骷髅头是精英：比普通敌人难一截，赢了掉更好的东西。\n量力而行——打不过就绕。",
  },
  {
    id: "rest",
    title: "篝火",
    body: "回血或永久升级一张牌。\n活着到 Boss 面前，比什么流派都重要。",
  },
  {
    id: "upgrade",
    title: "升级",
    body: "升级是永久强化这张牌——费用、伤害、效果都可能变。\n动手前先看升级预览。",
  },
  {
    id: "relic_pick",
    title: "遗物",
    body: "遗物是被动生效的宝贝，拿到就一直工作，不用你操作。\n越攒越多，这是肉鸽的复利。",
  },
  {
    id: "boss_warning",
    title: "Boss 层",
    body: "顶上就是 Boss。\n血不满、牌没整好之前，别急着敲门。",
  },
];

export function firstTip(id: string): FirstTipDefinition | undefined {
  return FIRST_TIPS.find((tip) => tip.id === id);
}
