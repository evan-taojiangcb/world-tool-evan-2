# Word Tool Evan 2

一个为英语阅读场景设计的 Chrome 插件。  
在网页中划词/双击即可查词，支持收藏高亮复习、短语回退解析、发音、中文释义与上下文解释。

## Why This Tool

大多数词典工具只能“查一次”，不能把学习过程沉淀在阅读里。  
Word Tool Evan 2 的核心目标是：

- 查询快：划词结束即可触发，无需离开当前网页
- 记得住：收藏词条后，后续浏览自动高亮复习
- 看得懂：不仅有释义，还有中文例句和上下文解释说明

## Core Features

- 划词 / 双击查询单词与短语
- 悬浮查询按钮 + 详情弹窗
- 英式/美式发音播放
- 中文释义 + 词性
- 例句 + 例句中文翻译
- 上下文解释说明（结合当前句子）
- 词根词缀拆解
- 词根音标展示（默认 UK/US 可切换）
- 收藏与页面自动高亮
- 收藏管理与导出（JSON / CSV）

## Highlights

- 短语查询失败时自动回退关键词解析，避免“直接查不到”
- 本地优先缓存，重复查询更快
- 动态页面高亮（支持内容变化后增量处理）
- 交互细节针对真实阅读场景持续优化（划词、弹窗、点击行为）

## Demo

![Word Tool Demo](./assets/demo-1.gif)

1. 划词 -> 出现悬浮按钮 -> 打开弹窗
2. 收藏词条 -> 页面同词高亮
3. 点击高亮词再次打开弹窗
4. 切换词根音标 UK/US

## Tech Stack

- Chrome Extension: Manifest V3, React 18, TypeScript, Vite
- UI: Ant Design + Tailwind CSS
- State/Data: Jotai, localForage, chrome.storage
- API: Next.js API Routes
- Infra: AWS Lambda + DynamoDB（可选部署）

## Monorepo Structure

- `apps/extension`: 浏览器插件端（content/background/popup/options）
- `apps/api`: 词典与收藏同步 API
- `packages/shared`: 共享类型定义
- `docs`: PRD 与架构文档

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Build Extension

```bash
npm run build:extension
```

### 3. (Optional) Run API

```bash
npm run dev:api
```

## Load in Chrome (Developer Mode)

1. 打开 `chrome://extensions`
2. 开启右上角 Developer mode
3. 点击 `Load unpacked`
4. 选择 `apps/extension/dist`

## Product Notes

- 首次点击插件图标需要输入用户名（用于跨设备同步标识）
- 设置与收藏保存在本地存储
- 仅查词/翻译等能力需要联网请求

## Testing

```bash
npm run test
```

- Unit: Vitest
- E2E: Playwright

## Roadmap

- 更强固定搭配与短语识别
- 复习模式（间隔重复）
- 导入第三方词库
- 多语言释义扩展

## License

MIT
