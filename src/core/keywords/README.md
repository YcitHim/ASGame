# keywords/ · 关键词系统

## 职责
关键词是注册制的机制单元：统一钩子接口，新职业加机制 = 注册新关键词。

## v0 关键词清单（0.1）

| 关键词 | 语义 | 钩子 |
|---|---|---|
| 消耗 Exhaust | 打出后进入消耗堆 | afterPlay |
| 保留 Retain | 回合结束不弃掉 | onTurnEnd |
| 虚无 Ethereal | 回合结束若在手则消耗 | onTurnEnd |
| 固有 Innate | 首回合必在起手 | onBattleStart |
| 血契 Bloodpact | 打出时支付 HP 代价 | modifyCost / beforePlay |
| 充能 Charge | 累积充能点 | onPlay |
| 污染 Pollution | 改变污染值 | onPlay / onTurnStart |
| 过载 Overload | 充能超限反噬 | onCharge |
| 再生 Regen | 回合开始回血 | onTurnStart |

## 待做清单
- [x] 关键词统一接口：`KEYWORD_HOOKS`（afterPlay / inHandAtTurnEnd / innate / pactCost）+ 查询函数
- [x] 每个生效关键词都有单测（消耗/保留/虚无/固有/血契 × 钩子）
- [x] 关键词在卡牌 JSON 中的参数化（`bloodCost` + `keywords[]`，validator 校验已注册）

## 约束
- 关键词之间不直接互相调用，交互通过触发器与管线完成
