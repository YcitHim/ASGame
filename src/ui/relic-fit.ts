/**
 * ui/relic-fit · 随身遗物的「机制相性」判定（docs/43 §2.4）
 *
 * 压力表（充能）、血泵（卖血）这类件跨职业就是白板——玩家点进去才发现白带了一件。
 * 这里按**效果文本静态扫描**给出相性，选择页据此置灰 + 一行标注；
 * 不隐藏、不禁止（头铁玩家自由），只是不许"踩坑不知情"。
 *
 * 口径（只认"需要什么资源"，不认"给什么资源"）：
 * - timing onSell      → 需要卖血机制（血械侍僧）
 * - clampCharge / spendCharge → 需要已有的充能（炉心机士）
 * - spendPollution / transferPollution / consumeCorroding → 需要污染/蚀锈机制（锈语者）
 * - gainCharge / gainPollution 属于"给资源"（谁拿都能用），不算不合。
 */
import type { ContentDb, RelicDefinition } from "@/core/registry/content";

export type ResourceKey = "charge" | "blood" | "pollution";

/** 资源 → 拥有它的职业 + 显示名。 */
export const RESOURCE_OWNERS: Record<ResourceKey, { label: string; classId: string }> = {
  charge: { label: "充能", classId: "engineer" },
  blood: { label: "卖血", classId: "bloodwright" },
  pollution: { label: "污染", classId: "rustspeaker" },
};

/** 这件遗物**需要**哪个职业资源；通用件返回 null。 */
export function requiredResource(def: RelicDefinition): ResourceKey | null {
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
}

/** 遗物 id × 职业 → 相性；扫不出来的（新效果类型）按相性 OK 处理，由人工标注兜底。 */
export function relicResourceFit(relicId: string, classId: string, content: ContentDb): RelicFit {
  const def = content.relics.get(relicId);
  if (!def) return { ok: true };
  const need = requiredResource(def);
  if (!need) return { ok: true };
  const owner = RESOURCE_OWNERS[need];
  if (owner.classId === classId) return { ok: true };
  return { ok: false, resource: owner.label, ownerClassId: owner.classId };
}
