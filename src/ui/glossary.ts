/**
 * ui/glossary · 关键词注解表
 *
 * 只收录"字面看不出效果"的机制词（如虚弱 = 造成伤害 ×0.75，而非受伤增加）。
 * 「卖血」这类字面即懂的词不收录。
 *
 * 注解不再内嵌在卡面文字上，而是由 CardView 在卡牌右侧弹出一个独立注解窗，
 * 因此同一词条在描述与关键词行重复出现时也只解释一次。
 */
export const GLOSSARY: Record<string, string> = {
  力量: "每层使你造成的攻击伤害 +1。",
  易伤: "受到攻击伤害 ×1.5；回合开始 -1 层。",
  虚弱: "造成的攻击伤害 ×0.75；回合开始 -1 层。",
  再生: "回合开始时按层数回复 HP。",
  格挡: "抵消等量伤害；回合开始时清零。",
  污染: "双刃剑资源。满 100 立即反噬 10 点并清零；≥80 时每回合开始受 2 点伤害。",
  充能: "每点使你所有攻击的各段伤害 +1；上限 10。超过 10 触发过载：立即受 5 点伤害并清零。",
  蓄力: "蓄力层数会叠进最终一击；蓄力期间敌人会架起格挡——顶住格挡抢伤害，还是收手备战，由你判断。",
  反伤: "受到攻击时，对攻击者造成固定伤害（不受力量 / 充能 / 易伤影响，也不吃「所有攻击 +1」类全局增幅，且不会被反伤再反弹）。",
  过载: "充能超限时的反噬：受 5 点伤害并清零。",
  消耗: "打出后本场不再回到牌堆。",
  保留: "回合结束时不弃置。",
  虚无: "回合结束时若仍在手牌，则被消耗。",
  固有: "战斗开始时必定在起手牌中。",
  血契: "打出时以自身 HP 为代价。",
};

/** 长词优先，避免"易伤/伤"这类包含关系误匹配。 */
const KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERN = new RegExp(KEYS.map(escapeRegex).join("|"), "g");

/** 把描述里需要解释的机制词包成蓝字 span（单次扫描，不嵌套）。 */
export function highlightText(text: string): string {
  return escapeHtml(text).replace(PATTERN, (match) => `<span class="kw">${match}</span>`);
}

/** 文本里出现过的注解词（按首次出现顺序、去重）。 */
export function termsIn(text: string): string[] {
  const found = text.match(PATTERN) ?? [];
  return [...new Set(found)];
}

export function keywordTip(term: string): string {
  return GLOSSARY[term] ?? "";
}

export function hasTip(term: string): boolean {
  return term in GLOSSARY;
}
