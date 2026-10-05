# registry/ · 注册表总装

## 职责
五类注册表的统一入口（ADR-004 / docs/04）：`condition / target / keyword / cardHandler / enhancementHandler`。

## 待做清单
- [ ] 注册接口：`register(kind, id, impl)`，重复注册报错
- [ ] 内置项登记：docs/04 示例中的全部 condition / target；0.1 的 cardHandler（至少 `multihit`）与 enhancementHandler（`bloodboil`）
- [ ] 查询接口：给 pipeline / 校验器 / 调试控制台用
- [ ] 与 tools/content-validator 的契约：导出"已注册 id 全集"供构建期比对

## 约束
- handler 是纯 TS 函数，可单测、有类型；禁止在 handler 里写 DOM / 异步 / 随机（随机从 rng 流取）
- 新机制才加 handler；新卡优先复用已有 handler（团队公约）
