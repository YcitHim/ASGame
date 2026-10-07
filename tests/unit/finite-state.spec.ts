import { describe, expect, it } from "vitest";
import { loadGameContent } from "@/data/load";
import { createBattleState, reduce, type BattleState } from "@/core/combat";

/**
 * 回归哨兵：战斗状态里**永远不能出现非有限数**。
 *
 * 由来（2026-10-07 实机事故）：铁皮王八的荆棘曾走一份「格挡快照」影子字段，
 * 该字段一旦缺失（热更新残留 / 旧状态对象），`Math.max(0, undefined)` 直接产出 NaN →
 * 反弹伤害把敌人 HP 打成 NaN → `livingEnemies()` 的 `hp > 0` 判假 → 整场战斗当场判空、
 * 怪物「直接被秒杀」。现在荆棘是真 buff（层数恒为有限数），这条测试守住不再复发。
 */

const content = loadGameContent().content;
const ALL_RELICS = [...content.relics.keys()];

/** 甲方的实机配置：炉心机士 + 铁皮王八 + 起始卡组 + 荆棘血痂 */
const DECK = [
  "pistonjab", "pistonjab", "pistonjab", "pistonjab",
  "brassguard", "brassguard", "brassguard", "brassguard",
  "thornscab", "thornscab",
];

function firstNonFinite(value: unknown, path = ""): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : `${path}=${value}`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = firstNonFinite(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "content") continue; // 静态内容目录，不属于战斗状态
      const hit = firstNonFinite(child, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return null;
}

function playGreedy(state: BattleState, tag: string): BattleState {
  let current = state;
  for (let turn = 0; turn < 6; turn += 1) {
    for (let guard = 0; guard < 12; guard += 1) {
      const index = current.piles.hand.findIndex((id) => {
        const instance = current.cardInstances[id];
        const def = instance ? content.cards.get(instance.cardId) : undefined;
        return !!def && def.cost <= current.player.energy;
      });
      if (index < 0) break;
      const targetId = current.enemies.find((e) => e.hp > 0)?.id ?? "rust_sentinel";
      current = reduce(current, {
        type: "PlayCard",
        actionId: `${tag}-p${turn}-${guard}`,
        handIndex: index,
        targetId,
      }).state;
      const bad = firstNonFinite(current);
      expect(bad, `${tag} 出牌第 ${turn}/${guard} 张后出现非有限数`).toBeNull();
      if (current.phase === "battleEnd") return current;
    }
    current = reduce(current, { type: "EndTurn", actionId: `${tag}-e${turn}` }).state;
    const bad = firstNonFinite(current);
    expect(bad, `${tag} 第 ${turn} 回合结束后出现非有限数`).toBeNull();
    if (current.phase === "battleEnd") return current;
  }
  return current;
}

describe("战斗状态有限性回归（铁皮王八 / 荆棘反弹）", () => {
  it("铁皮王八 × 铁锈傀儡（自带荆棘）× 多 seed：全程无非有限数，也不会秒杀收场", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const start = createBattleState({
        battleId: `finite-${seed}`,
        seed,
        player: { maxHp: 50, energy: 3, pollution: 20 },
        enemies: [{ id: "rust_sentinel" }, { id: "corroded_swarm" }],
        deck: DECK,
        handSize: 5,
        relics: ALL_RELICS,
        content,
        traitId: "ironhide_turtle",
      });
      const state = playGreedy(reduce(start, { type: "Noop", actionId: "s" }).state, `ironhide-${seed}`);
      // 秒杀症状的外显：开战就 battleEnd，且玩家一点伤害都没吃到
      if (state.phase === "battleEnd") {
        expect(state.turn, `seed ${seed} 第 0 回合就结束，疑似 NaN 秒杀`).toBeGreaterThan(0);
      }
      for (const enemy of state.enemies) {
        expect(Number.isFinite(enemy.hp), `seed ${seed} 敌人 hp 非有限`).toBe(true);
      }
    }
  });
});
