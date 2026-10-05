# actions/ · 指令定义

## 职责
所有能改变核心状态的输入统一建模为 Action。**Action 必须可 JSON 序列化**（回放输入流直接落盘）。

## 待做清单
- [x] Action 联合类型（另加 `Noop` 供空转/测试）：`PlayCard / EndTurn / SelectReward / ChooseMapNode / ApplyEnhancement / RestChoice / DebugCommand / Noop`
- [~] 每个 Action 的合法性校验 —— S3 随出牌判定一起落到 `combat/`
- [x] 输入流日志格式：`ActionLog { seed, actions }` 即一份完整回放

## 约束
- 只定义与校验，**不含执行逻辑**——执行在 `combat/` 与 `pipeline/`
- 载荷里只允许 id 和原始值，不允许塞对象引用
