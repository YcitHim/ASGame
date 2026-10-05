# registry/ · 注册表总装

## 职责
五类注册表的统一入口（ADR-004 / docs/04）：`condition / target / keyword / cardHandler / enhancementHandler`。

## 待做清单
- [x] 注册接口：`registerCondition / registerTarget / registerCardHandler`，重复注册报错
- [x] 内置项登记：全部 condition / target；cardHandler `multihit` / `rampageOnSameTarget`；enhancementHandler `bloodboil` / `empower` / `fortify`
- [x] 查询接口：`getCondition / getTarget / getCardHandler` + `registered*` 全集
- [x] 与 tools/content-validator 的契约：`registry/ids.ts` 为构建期 id 白名单

## 约束
- handler 是纯 TS 函数，可单测、有类型；禁止在 handler 里写 DOM / 异步 / 随机（随机从 rng 流取）
- 新机制才加 handler；新卡优先复用已有 handler（团队公约）
