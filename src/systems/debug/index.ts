/**
 * systems/debug · 调试控制台（G4）
 *
 * 只负责"是否注入"与指令目录；指令的真正执行在 core/combat/debug.ts
 * （保证所有 bug 复现步骤都能用同样的指令描述）。
 */
import type { DomainEvent } from "@/core/events";
import { DEBUG_HELP } from "@/core/combat/debug";

export interface DebugCommandSpec {
  readonly command: string;
  readonly description: string;
}

/**
 * 指令目录：**从 core 的 DEBUG_HELP 派生**，不再手抄一份（甲方 2026-10-08）。
 * 以前两边各写一套，加指令时漏一边就会「执行器认识、控制台不显示」。
 */
export const DEBUG_COMMANDS: readonly DebugCommandSpec[] = DEBUG_HELP.map((h) => ({
  command: h.usage,
  description: h.desc,
}));

/** 进度：菜单/商店等占位（S5 接地图）。 */
export function isDebugEnabled(): boolean {
  return import.meta.env.DEV;
}

/** 调试面板里给玩家看的快捷指令（一键点到底，不用记拼写）。 */
export const DEBUG_QUICK: readonly string[] = [
  "help",
  "cards blood",
  "give card bloodbolt",
  "set energy 9",
  "add buff strength 3",
  "draw 2",
  "kill rust_hound",
];

/** 事件 → 单行调试文本（日志面板兜底用）。 */
export function eventLine(event: DomainEvent): string {
  return `#${event.seq} ${event.type}`;
}
