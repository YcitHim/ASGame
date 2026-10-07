/**
 * ui/tutorial-script · 教学步骤的脚本化调试指令（docs/42 速成版改版）
 *
 * 从 TutorialStep 生成要发给 core 的 DebugCommand 串：
 * - 保底牌（grant / classGrant）→ give card
 * - 敌人意图（intent）→ intent <enemyId> ...
 * 视图只负责把返回的字符串丢给 battle store；测试可以复用同一份逻辑跑通关。
 */
import type { TutorialIntentScript } from "@/ui/tutorial";

export function intentDebugCommand(enemyId: string, script: TutorialIntentScript): string {
  if (script.kind === "charge") {
    return `intent ${enemyId} charge ${script.value ?? 0} ${script.block ?? 0} ${script.release ?? 0}`;
  }
  if (script.kind === "debuff") {
    return `intent ${enemyId} debuff ${script.buffId ?? "weak"} ${script.value ?? 1}`;
  }
  return `intent ${enemyId} attack ${script.value ?? 0}`;
}

export interface StepScriptInput {
  readonly grant: readonly string[];
  readonly intent: TutorialIntentScript | null;
  readonly enemyId: string;
}

/** 一个步骤开始时该执行的全部调试指令（顺序无关）。 */
export function stepDebugCommands(input: StepScriptInput): string[] {
  const commands = input.grant.map((cardId) => `give card ${cardId}`);
  if (input.intent && input.enemyId) commands.push(intentDebugCommand(input.enemyId, input.intent));
  return commands;
}
