/**
 * 封版戳（标题页页脚）· 单一来源。
 *
 * 版本号直接读 package.json，页脚的「<主次版本> 封版」与版本总结文档名由它推导——
 * 避免每次封版漏改硬编码（v1.1 前这里一直是写死的「0.5 封版 · 2026-10-06」）。
 */
import { version } from "../../package.json";

/** 本版封版日期（人工维护，封版当日更新）。 */
export const SEAL_DATE = "2026-10-07";

/** 完整语义版本，如 1.1.0。 */
export const APP_VERSION = version;

/** 主次版本，如 1.1——页脚封版戳与版本总结文档名用它。 */
export const APP_RELEASE = version.split(".").slice(0, 2).join(".");
