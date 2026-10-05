/**
 * core/registry/target · 目标选择器注册表（ADR-004）
 */
import type { Rng } from "../rng";
import type { TargetId } from "./ids";

export interface TargetableUnit {
  readonly id: string;
  readonly hp: number;
}

export interface TargetContext {
  readonly actorId: string;
  readonly chosenTargetId: string | null;
  readonly enemies: readonly TargetableUnit[];
  readonly rng: Rng;
}

export type TargetFn = (ctx: TargetContext) => string[];

const registry = new Map<TargetId, TargetFn>();

export function registerTarget(id: TargetId, fn: TargetFn): void {
  if (registry.has(id)) throw new Error(`target "${id}" 重复注册`);
  registry.set(id, fn);
}

export function getTarget(id: string): TargetFn {
  const fn = registry.get(id as TargetId);
  if (!fn) throw new Error(`未注册的 target "${id}"`);
  return fn;
}

export function hasTarget(id: string): boolean {
  return registry.has(id as TargetId);
}

export function registeredTargets(): readonly string[] {
  return [...registry.keys()];
}

const living = (ctx: TargetContext): TargetableUnit[] => ctx.enemies.filter((e) => e.hp > 0);

registerTarget("self", (ctx) => [ctx.actorId]);
registerTarget("chosenEnemy", (ctx) => {
  const alive = living(ctx);
  if (ctx.chosenTargetId && alive.some((e) => e.id === ctx.chosenTargetId)) return [ctx.chosenTargetId];
  return alive.length > 0 ? [alive[0].id] : [];
});
registerTarget("randomEnemy", (ctx) => {
  const alive = living(ctx);
  return alive.length > 0 ? [ctx.rng.stream("combat").pick(alive).id] : [];
});
registerTarget("allEnemies", (ctx) => living(ctx).map((e) => e.id));
registerTarget("lowestHpEnemy", (ctx) => {
  const alive = living(ctx);
  if (alive.length === 0) return [];
  return [alive.reduce((a, b) => (b.hp < a.hp ? b : a)).id];
});
registerTarget("highestHpEnemy", (ctx) => {
  const alive = living(ctx);
  if (alive.length === 0) return [];
  return [alive.reduce((a, b) => (b.hp > a.hp ? b : a)).id];
});
