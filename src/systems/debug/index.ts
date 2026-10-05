/**
 * systems/debug · 调试控制台（G4）
 *
 * 只负责"是否注入"与指令目录；指令的真正执行在 core/combat/debug.ts
 * （保证所有 bug 复现步骤都能用同样的指令描述）。
 */
import type { DomainEvent } from "@/core/events";

export interface DebugCommandSpec {
  readonly command: string;
  readonly description: string;
}

/** 0.1 指令目录（与 core/combat/debug.ts 一一对应）。 */
export const DEBUG_COMMANDS: readonly DebugCommandSpec[] = [
  { command: "noop", description: "空操作" },
  { command: "set hp <n>", description: "设置玩家 HP" },
  { command: "set energy <n>", description: "设置能量" },
  { command: "add buff <id> <stacks> [duration]", description: "施加 Buff" },
  { command: "give card <id>", description: "把卡加入手牌" },
  { command: "draw <n>", description: "抽 N 张" },
  { command: "kill <enemyId>", description: "击杀敌人" },
  { command: "seed <n>", description: "重设随机种子" },
];

/** 进度：菜单/商店等占位（S5 接地图）。 */
export function isDebugEnabled(): boolean {
  return import.meta.env.DEV;
}

/** 调试面板里给玩家看的快捷指令（取目录前若干条 + 常用）。 */
export const DEBUG_QUICK: readonly string[] = [
  "set hp 20",
  "set energy 9",
  "add buff strength 3",
  "give card bloodbolt",
  "kill rust_hound",
  "draw 2",
];

/** 事件 → 单行调试文本（日志面板兜底用）。 */
export function eventLine(event: DomainEvent): string {
  return `#${event.seq} ${event.type}`;
}
