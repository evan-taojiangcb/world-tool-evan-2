# 浏览器单词高亮插件 PRD

已按需求落地在代码结构中：
- 划选/双击触发悬浮按钮
- 详情弹窗（收藏、音标、发音、释义、例句）
- 收藏后当前页与后续页面自动高亮
- 首次用户名录入
- 收藏管理页面与导出入口
- 后端 API 与 DynamoDB 模型

更多实现细节见：
- `apps/extension/src/content/index.tsx`
- `apps/extension/src/shared/highlight.ts`
- `apps/api/app/api/*`
- `apps/api/serverless.yml`
