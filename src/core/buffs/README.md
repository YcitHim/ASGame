# buffs/ · Buff / Debuff 系统

## 职责
Buff 结构、层数规则、tick 结算。规则依据 docs/03 §2（冻结规范）。

## 0.1 必做六个

| Buff | 类型 | 规则 |
|---|---|---|
| 力量 Strength | 强度型 | 每层 +1 攻击修饰，无 duration |
| 胆怯 Timid（旧易伤） | 层级型 | 每层受伤 +10%，上限 5（docs/46 §2.2） |
| 虚弱 Weak | 层级型 | 每层造伤 −10%，上限 5（docs/46 §2.1） |
| 荆棘 Bramble（旧反伤） | 层级型 | 每层受击反弹 3 点，上限 5（docs/46 §2.3） |
| 坚韧 Tenacity | 层级型 | 每层回合开始 +3 维续格挡，上限 3 层 / 池 25（docs/46 §3.4） |
| 格挡 Block | 数值型 | 非 Buff 本体，但走同一修饰管线 |
| 再生 Regen | 计时型 | 回合开始回复 stacks 点 HP |
| 污染 Pollution | 强度型 | 玩家侧双刃剑资源，满值反噬（结算点见 docs/03 §4 待拍板） |

## 待做清单
- [x] Buff 结构 `{ id, stacks, duration }` + `BuffDefinition`（stacking / decayAt / potency / maxStacks）
- [x] 叠加规则：默认 stacks 累加 + duration 刷新；易伤/虚弱 refreshOnly、污染 maxStacks 均显式声明
- [x] tick 按 docs/03 §3 实现（turnStart 衰减计时型、强度型不受影响），有单测锚定
- [ ] Buff 图标与文案 key 约定（S3 随战斗 UI 接入）

## 约束
- Buff 对数值的影响只通过修饰符管线表达，不改任何基础字段
