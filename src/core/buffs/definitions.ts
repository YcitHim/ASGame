import type { BuffId } from "../registry/ids";
import type { BuffDefinition } from "./types";

/** 0.1 六个基础 Buff（docs/03 §2 / buffs README）。 */
export const BUFF_DEFINITIONS: Readonly<Record<BuffId, BuffDefinition>> = {
  strength: { id: "strength", stacking: "stack", decayAt: "none", potency: true },
  vulnerable: { id: "vulnerable", stacking: "refreshOnly", decayAt: "turnStart", potency: false },
  weak: { id: "weak", stacking: "refreshOnly", decayAt: "turnStart", potency: false },
  regeneration: { id: "regeneration", stacking: "stackAndRefresh", decayAt: "turnStart", potency: false },
  pollution: { id: "pollution", stacking: "stack", decayAt: "none", potency: true, maxStacks: 100 },
  block: { id: "block", stacking: "stack", decayAt: "none", potency: true, resource: true },
};

export function buffDefinition(id: BuffId): BuffDefinition {
  return BUFF_DEFINITIONS[id];
}
