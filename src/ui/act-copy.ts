import { t } from "@/data/load";

/**
 * 幕相关文案（docs/40 §四）：先找 `key.actN`，再回落 `key.act1`，最后回落 key 本身。
 * 加一句幕专属文案只需补 i18n，不动代码；没写 actN 的幕自动沿用 act1 的句子。
 */
export function actCopy(key: string, actIndex: number): string {
  const n = (actIndex ?? 0) + 1;
  return t(`${key}.act${n}`, t(`${key}.act1`, t(key)));
}
