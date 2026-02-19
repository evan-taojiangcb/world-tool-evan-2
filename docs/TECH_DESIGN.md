# WordGlow 技术设计文档

## 1. 文档目标

本文档描述 WordGlow 当前版本的技术方案与实现细节，用于：

- 对齐产品与研发对功能边界的理解
- 支撑后续迭代时的架构决策
- 为测试、部署与发布提供可追踪依据

## 2. 系统概览

WordGlow 由两部分组成：

1. 浏览器插件（Chrome Manifest V3）
2. API 服务（Next.js API Routes，可部署到 AWS Lambda）

插件端承担主要交互体验：划词触发、弹窗查询、收藏高亮、设置管理。  
API 端提供词典查询与收藏同步能力。

## 3. 技术栈

### 3.1 Extension

- React 18 + TypeScript
- Vite + @crxjs/vite-plugin
- chrome.storage / localForage
- Content Script + Background Service Worker + Popup + Options

### 3.2 API

- Next.js API Routes
- DynamoDB（同步场景）
- 可选部署：Serverless Framework + AWS Lambda

## 4. 目录与模块分层

### 4.1 Monorepo 结构

- `apps/extension`：插件主工程
- `apps/api`：词典与同步 API
- `packages/shared`：共享类型定义
- `docs`：产品与技术文档

### 4.2 Extension 关键模块

- `src/content/index.tsx`：页面交互入口（划词、弹窗、音频、高亮交互）
- `src/background/index.ts`：查词、缓存、同步、设置读写
- `src/shared/highlight.ts`：高亮注入与清理
- `src/shared/settings.ts`：设置模型与归一化
- `src/options/main.tsx`：收藏管理 + 设置界面
- `src/types/messages.ts`：runtime message 协议

## 5. 数据模型

共享类型定义位于 `packages/shared/src/index.ts`。

### 5.1 WordData

关键字段：

- `word`: 查询词或短语
- `phonetic.uk/us`: 主词英/美音标
- `audio.uk/us`: 主词英/美发音 URL
- `definitions[]`: 释义列表
  - `partOfSpeech`
  - `definition`
  - `translation`
  - `example`
  - `exampleTranslation`
- `translationZh`: 主词中文翻译
- `morphology[]`: 词根词缀拆解
- `morphologyPhonetics`: 词根音标映射（`{ [part]: { uk, us } }`）
- `contextSentence/contextSentenceZh/contextExplanationZh`: 上下文解释

### 5.2 本地存储

- `collections`: 收藏词条 map（`chrome.storage.local`）
- `word_lookup_cache`: 本地查词缓存（LRU-like 按 `cachedAt` 裁剪）
- `word_tool_settings`: 插件设置
  - `morphologyAccent: "uk" | "us"`
- `word_tool_username`: 用户名
- `review_queue`: 复习队列

## 6. 关键交互流程

### 6.1 划词/双击查询

1. `mousedown/mouseup` 或 `dblclick` 触发选区采样
2. 文本校验（长度、字母规则）
3. 渲染悬浮查询按钮（拖拽场景延迟显示，降低误触）
4. 点击按钮发送 `LOOKUP_WORD` 消息
5. 返回 `WordData` 后渲染弹窗

### 6.2 查词与缓存策略（Background）

`lookupWord(text, contextSentence)` 流程：

1. `normalizeLookupKey`
2. 本地缓存命中 -> 补全字段 -> 返回
3. API 查询（`/api/word`）
4. API 失败时 fallback 到 `dictionaryapi.dev`
5. 若为短语且 fallback 失败：关键词拆分回退（phrase candidate）
6. 回写缓存（剥离上下文字段，避免跨场景污染）

### 6.3 上下文解释

- Content Script 提取当前句子并传入 `LOOKUP_WORD`
- Background 生成：
  - `contextSentence`
  - `contextSentenceZh`
  - `contextExplanationZh`
- 用于弹窗“上下文解释说明”展示

### 6.4 高亮与收藏

1. 收藏/取消收藏通过 runtime message 更新存储
2. Content Script 调用 `highlightWords`
3. `MutationObserver` 监听 DOM 变化，增量刷新高亮
4. 点击高亮词触发反查弹窗

## 7. UI 策略与规则

### 7.1 单词 vs 短语差异

- 单词：显示词根词缀、词根音标
- 短语：隐藏词根词缀与主词音标区差异项，仅保留短语朗读等必要信息

### 7.2 词根音标展示规则

- 在“词根音标”行提供 UK/US 单选切换
- 每个词根下方只显示当前默认口音音标（不重复显示 UK/US 前缀）

## 8. 消息协议（Runtime Messages）

主要消息：

- `LOOKUP_WORD`
- `GET_COLLECTIONS` / `UPSERT_COLLECTION` / `DELETE_COLLECTION`
- `GET_REVIEW_QUEUE` / `ADD_REVIEW_QUEUE` / `DELETE_REVIEW_QUEUE` / `CLEAR_REVIEW_QUEUE`
- `GET_SETTINGS` / `SET_SETTINGS`
- `GET_USERNAME` / `SET_USERNAME`

协议定义：`apps/extension/src/types/messages.ts`

## 9. 可测试性设计

当前测试分层：

- Unit（Vitest）
  - 文本处理：`text.test.ts`
  - 事件守卫：`event-guards.test.ts`
  - 缓存策略：`lookup-cache.test.ts`
  - 设置归一化：`settings.test.ts`
- E2E（Playwright，占位用例，持续扩展）

建议新增 E2E 场景：

1. 拖拽选区后悬浮按钮与选区保留
2. 短语 fallback 查询
3. 词根音标 UK/US 切换即时生效
4. 收藏高亮与点击回查

## 10. 部署与发布

### 10.1 插件

1. `npm run build:extension`
2. 加载 `apps/extension/dist` 本地验收
3. 打包上传 Chrome Web Store

### 10.2 API

1. `npm run build:api`
2. `serverless deploy --stage prod`（或等价命令）

## 11. 已知风险与后续优化

- 浏览器选区行为在不同页面有差异，需持续 E2E 覆盖
- 第三方词典/翻译服务可用性影响体验，需更多缓存与降级策略
- 短语语义解析当前为关键词回退，后续可引入更强 NLP/LLM 语义层

