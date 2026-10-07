/**
 * core/actions · 一切输入的可序列化指令（docs/02 §3）
 *
 * 只定义与描述，不含执行逻辑；执行在 combat/ 与 pipeline/。
 * 载荷只允许 id 与原始值，不得塞对象引用——回放输入流直接落盘。
 */

export type Action =
  | { readonly type: "PlayCard"; readonly actionId: string; readonly handIndex: number; readonly targetId?: string }
  | { readonly type: "EndTurn"; readonly actionId: string }
  /** 畸变神眼（docs/58 §七.2）：从牌库中任选一张牌加入手牌（每回合一次） */
  | { readonly type: "PickFromDraw"; readonly actionId: string; readonly instanceId: string }
  | { readonly type: "SelectReward"; readonly actionId: string; readonly optionIndex: number }
  | { readonly type: "ChooseMapNode"; readonly actionId: string; readonly nodeId: string }
  | { readonly type: "ApplyEnhancement"; readonly actionId: string; readonly deckIndex: number; readonly enhancementId: string }
  | { readonly type: "RestChoice"; readonly actionId: string; readonly optionId: string }
  | { readonly type: "DebugCommand"; readonly actionId: string; readonly command: string }
  | { readonly type: "Noop"; readonly actionId: string };

export type ActionType = Action["type"];

/** 回放输入流格式：一份完整回放 = 种子 + 输入流。 */
export interface ActionLog {
  readonly seed: number;
  readonly actions: readonly Action[];
}

/** 深拷贝后的 JSON 视图，用于序列化测试与落盘。 */
export function toJsonAction(action: Action): unknown {
  return JSON.parse(JSON.stringify(action));
}

/** Action 必须可无损 JSON 往返（回放的正确性依赖）。 */
export function isRoundTrippable(action: Action): boolean {
  return JSON.stringify(toJsonAction(action)) === JSON.stringify(action);
}
