/**
 * headless-sim · 场景直开（docs/19 §3.2）
 *
 * 跳过地图，以「第 4 节点典型卡组状态」直开精英（铁锈看守）战：
 * 起始卡组 + 2 张抓牌（走真实奖励流程）+ 1 次升级，HP 45，起始遗物。
 * 验收区间：胜率 70%~90%、平均承伤 25~40。
 */
import { createRunState, relicPool, rollCardRewards, type RunDifficulty } from "../../../src/core/map";
import type { ActDefinition, ContentDb } from "../../../src/core/registry";
import { bestReward, runBattle, type SimCard } from "./sim";

export const ELITE_SCENARIO_ENEMY = "rust_warden";
export const ELITE_SCENARIO_HP = 45;
export const SCENARIO_TARGET = { minRate: 0.7, maxRate: 0.9, minTaken: 25, maxTaken: 40 } as const;

export interface ScenarioResult {
  seed: number;
  win: boolean;
  hpLeft: number;
  damageTaken: number;
  turns: number;
}

export function simulateEliteScenario(
  content: ContentDb,
  act: ActDefinition,
  seed: number,
  classId = "bloodwright",
  difficulty: RunDifficulty = "normal",
  /** 职业特性（docs/58 §二）；缺省空串 = 无特性 */
  traitId = "",
): ScenarioResult {
  const cls = content.classes.get(classId) ?? [...content.classes.values()][0];
  if (!cls) throw new Error("内容里没有任何职业定义");
  const unlocked = [...[...content.cards.keys()], ...[...content.relics.keys()]];
  const t1 = relicPool(content, 1, unlocked);
  const preferred = classId === "engineer" ? "pressuregauge" : classId === "rustspeaker" ? "whetstone" : "blood_pump";
  const companion = t1.includes(preferred) ? preferred : (t1[0] ?? "");
  const run = createRunState(act, cls, seed, { unlocked, difficulty, companionRelic: companion, traitId });
  const deck: SimCard[] = cls.startDeck.map((cardId) => ({ cardId, upgraded: false, enhancements: [] }));

  // 2 张抓牌：走真实奖励流程，避免凭空造卡
  for (let i = 0; i < 2; i += 1) {
    const rewards = rollCardRewards(content, act, run, i);
    const pick = bestReward(rewards, content);
    if (pick) deck.push({ cardId: pick, upgraded: false, enhancements: [] });
  }

  // 1 次升级
  const upgradeIndex = deck.findIndex((c) => !c.upgraded);
  if (upgradeIndex >= 0) deck[upgradeIndex] = { ...deck[upgradeIndex], upgraded: true };

  const battle = runBattle(content, {
    battleId: `${act.id}-${ELITE_SCENARIO_ENEMY}-scenario`,
    seed: (seed ^ 0x9e3779b9) >>> 0,
    maxHp: cls.player.maxHp,
    energy: cls.player.energy,
    hp: ELITE_SCENARIO_HP,
    enemies: [ELITE_SCENARIO_ENEMY],
    deck,
    relics: [...(cls.startRelics ?? []), ...(companion ? [companion] : [])],
    difficulty,
    traitId,
  });

  return {
    seed,
    win: battle.state.phase === "battleEnd" && battle.state.player.hp > 0,
    hpLeft: battle.state.player.hp,
    damageTaken: battle.damageTaken,
    turns: battle.turns,
  };
}
