import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { APP_RELEASE, APP_VERSION, SEAL_DATE } from "@/ui/build-info";

/** 标题页封版戳：单一来源 = package.json，防止再次出现写死的「0.5 封版」漂移。 */
describe("标题页封版戳（build-info）", () => {
  it("版本号来自 package.json，主次版本用于封版戳与版本总结文档名", () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_RELEASE).toBe(pkg.version.split(".").slice(0, 2).join("."));
    expect(APP_RELEASE).toMatch(/^\d+\.\d+$/);
  });

  it("封版日期是合法的 ISO 日期", () => {
    expect(SEAL_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
