# actions/ · 指令定义

## 职责
所有能改变核心状态的输入统一建模为 Action。**Action 必须可 JSON 序列化**（回放输入流直接落盘）。

## 待做清单
- [ ] Action 联合类型：`PlayCard / EndTurn / SelectReward / ChooseMapNode / ApplyEnhancement / RestChoice / DebugCommand`（详见 docs/02 §3）
- [ ] 每个 Action 的合法性校验（费用够不够、目标合法吗、当前相位允许吗）
- [ ] 输入流日志格式：`{ seed, actions: [...] }` 即一份完整回放

## 约束
- 只定义与校验，**不含执行逻辑**——执行在 `combat/` 与 `pipeline/`
- 载荷里只允许 id 和原始值，不允许塞对象引用
