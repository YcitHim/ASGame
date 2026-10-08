/**
 * ui/relic-fit · 随身遗物的「机制相性」判定（docs/43 §2.4）
 *
 * 压力表（充能）、血泵（卖血）这类件跨职业就是白板——玩家点进去才发现白带了一件。
 * 这里按**效果文本静态扫描**给出相性，选择页据此出一行标注。
 * **甲方 2026-10-08 裁定：只提示、不拦截**——全部遗物都能选（哪怕对本职业毫无作用），
 * docs/50 §三 原先的「置灰 + 不可选」收紧已撤回（"点了没用"比"点不了"更容易接受）。
 *
 * 口径（只认"需要什么资源"，不认"给什么资源"）：
 * - timing onSell      → 需要卖血机制（血械侍僧）
 * - clampCharge / spendCharge → 需要已有的充能（炉心机士）
 * - spendPollution / transferPollution / consumeCorroding → 需要污染/蚀锈机制（锈语者）
 * - gainCharge / gainPollution 属于"给资源"（谁拿都能用），不算不合。
 */
import type { ContentDb, RelicDefinition } from "@/core/registry/content";

export type ResourceKey = "charge" | "blood" | "pollution";

/** 资源 → 拥有它的职业 + 显示名 + 件的俗称（置灰标注用）。 */
export const RESOURCE_OWNERS: Record<ResourceKey, { label: string; classId: string; artifact: string }> = {
  charge: { label: "充能", classId: "engineer", artifact: "炉心充能件" },
  blood: { label: "卖血", classId: "bloodwright", artifact: "血契卖血件" },
  pollution: { label: "污染", classId: "rustspeaker", artifact: "锈蚀污染件" },
};

/**
 * 人工标注（docs/43 §2.4「扫不出来的个案报给我人工标注」）：效果文本里**看不出**资源依赖的件。
 *
 * docs/50 §三：压力表重做后只剩 `gainCharge 2`——静态扫描会把它当成「给资源，谁拿都能用」，
 * 但 +2 充能对没有充能出口的职业就是纯白板。所以这里把它钉成「仅炉心相性」，
 * UI 侧据此置灰，sim:companions 据此对其余职业标 N/A、不进绝对线。
 */
export const MANUAL_CLASS_ONLY: Record<string, string> = {
  pressuregauge: "engineer",
};

/** 这件遗物**需要**哪个职业资源；通用件返回 null。 */
export function requiredResource(def: RelicDefinition): ResourceKey | null {
  const manual = MANUAL_CLASS_ONLY[def.id];
  if (manual === RESOURCE_OWNERS.charge.classId) return "charge";
  if (manual === RESOURCE_OWNERS.blood.classId) return "blood";
  if (manual === RESOURCE_OWNERS.pollution.classId) return "pollution";
  if (def.timing === "onSell") return "blood";
  for (const effect of def.effects) {
    switch (effect.kind) {
      case "clampCharge":
      case "spendCharge":
        return "charge";
      case "spendPollution":
      case "transferPollution":
      case "consumeCorroding":
        return "pollution";
      default:
        break;
    }
  }
  return null;
}

export interface RelicFit {
  /** true = 与本职业机制相性 OK（通用件永远 OK） */
  ok: boolean;
  resource?: string;
  ownerClassId?: string;
  /** 件的俗称（如「炉心充能件」），用于置灰标注 */
  artifact?: string;
}

/** 置灰标注文案（docs/50 §三）：「炉心充能件——本职业无充能机制」。 */
export function relicFitNote(fit: RelicFit): string {
  if (fit.ok || !fit.resource) return "";
  return `${fit.artifact ?? "专属件"}——本职业无${fit.resource}机制`;
}

/** 遗物 id × 职业 → 相性；扫不出来的（新效果类型）按相性 OK 处理，由人工标注兜底。 */
export function relicResourceFit(relicId: string, classId: string, content: ContentDb): RelicFit {
  const def = content.relics.get(relicId);
  if (!def) return { ok: true };
  const need = requiredResource(def);
  if (!need) return { ok: true };
  const owner = RESOURCE_OWNERS[need];
  if (owner.classId === classId) return { ok: true };
  return { ok: false, resource: owner.label, ownerClassId: owner.classId, artifact: owner.artifact };
}
