# Stitch 集成与下载结果

已完成通过 Stitch MCP 获取 `Project 8016649895208235419` 的 screen 列表，并用 `curl -L` 下载对应的图片与 HTML 代码。

## 已下载文件

- `assets/stitch/in-page-word-definition-popover.png`
- `assets/stitch/in-page-word-definition-popover.html`
- `assets/stitch/extension-toolbar-popup-menu.png`
- `assets/stitch/extension-toolbar-popup-menu.html`
- `assets/stitch/word-collection-management-dashboard.png`
- `assets/stitch/word-collection-management-dashboard.html`
- `assets/stitch/screens.json`

## Screen 映射

- `1a70572b72024901bb4dd6c06819ba53` -> In-Page Word Definition Popover
- `4f08322f404f4c6e9119b50fb84f367a` -> Extension Toolbar Popup Menu
- `5ab98d9dcafa441890dd7a0dcde343e0` -> Word Collection Management Dashboard

## 可复现流程

1. 调 `tools/list` 获取 Stitch MCP 工具。
2. 调 `tools/call` + `list_screens`，参数：`projectId=8016649895208235419`。
3. 从返回里的 `screenshot.downloadUrl`、`htmlCode.downloadUrl` 使用 `curl -L` 下载。

