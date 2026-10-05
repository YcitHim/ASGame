/**
 * ui/glossary · 关键词注解表
 *
 * 卡牌描述里的机制词用蓝字高亮，并用 data-tip 给出解释——玩家不需要外部说明。
 */
export const GLOSSARY: Record<string, string> = {
  力量: "力量：每层使你造成的攻击伤害 +1。",
  易伤: "易伤：受到攻击伤害 ×1.5；回合开始 -1 层。",
  虚弱: "虚弱：造成的攻击伤害 ×0.75；回合开始 -1 层。",
  再生: "再生：回合开始时按层数回复 HP。",
  格挡: "格挡：抵消等量伤害，回合开始时清零。",
  污染: "污染：双刃剑资源。满 100 立即反噬 10 点并清零；≥80 时每回合开始受 2 点伤害。",
  充能: "充能：每点使你的攻击伤害 +1；超过 10 触发过载。",
  过载: "过载：充能超限时的反噬（受 5 点伤害并清零）。",
  消耗: "消耗：打出后本场不再回到牌堆。",
  保留: "保留：回合结束时不弃置。",
  虚无: "虚无：回合结束时若仍在手牌，则被消耗。",
  固有: "固有：战斗开始时必定在起手牌中。",
  血契: "血契：打出时以自身 HP 为代价。",
  卖: "卖血：以自身 HP 为代价打出。",
};

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

/** 把描述里的机制词包成带 data-tip 的蓝字 span（单次扫描，不会嵌套替换）。 */
export function highlightText(text: string): string {
  return escapeHtml(text).replace(PATTERN, (match) => {
    return `<span class="kw" data-tip="${escapeHtml(GLOSSARY[match])}">${match}</span>`;
  });
}

export function keywordTip(label: string): string {
  return GLOSSARY[label] ?? "";
}
