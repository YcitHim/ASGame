# src/ · 源码分区总览

## 依赖方向（只允许单向）

```
ui / stores  →  core  →  data
     ↓
  systems（存档/音频/资源/调试，被 ui 调用，不反向依赖）
```

- `core/` 纯 TS，禁 DOM、禁 UI import、禁 Math.random / Date.now（G3 lint 保证）
- `data/` 纯 JSON/文案，不含逻辑
- `ui/` 只做展示与输入转发；`stores/` 是核心状态投影，不写数值逻辑

## 各分区

| 目录 | 一句话职责 | 清单位置 |
|---|---|---|
| `core/` | 玩法规则唯一住所 | 本目录及 10 个子目录 README |
| `data/` | 加内容=改这里 | `data/README.md` |
| `systems/` | 基础服务 | `systems/README.md` |
| `ui/` | Vue 表现层 | `ui/README.md` |
| `stores/` | Pinia 投影 | `stores/README.md` |
