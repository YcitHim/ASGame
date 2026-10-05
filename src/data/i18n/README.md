# i18n/ · 文案

## 规则
- 内容 JSON 一律引用 key，不写死中文（docs/04 §2）
- 0.1 只有 `zh-CN`，但结构按多语言分文件

## key 命名规范

| 前缀 | 用途 | 示例 |
|---|---|---|
| `card.{id}.` | 卡牌 | `card.bloodbolt.name` / `.desc` / `.flavor` |
| `enh.{id}.` | 强化 | `enh.bloodboil.desc` |
| `relic.{id}.` | 遗物 | |
| `enemy.{id}.` | 敌人名与意图描述 | |
| `event.{id}.` | 事件标题/正文/选项 | |
| `ui.` | 界面通用文案 | `ui.battle.endTurn` |
| `keyword.{id}.` | 关键词说明 | |

## 待做
- [ ] zh-CN 主文件结构（按内容类型分文件还是单文件，W1 定）
- [ ] 文案里的数值插值规范（如 `{value}` 由管线最终值注入）
- [ ] content-validator 增加"key 存在性"校验
