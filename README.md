# WebSideChat，用你喜欢的AI与网页对话。

WebSideChat，浏览器扩展，一键提取网页、视频内容，利用AI让网页活起来，与网页对话。

WebSideChat，利用AI帮你总结网页、视频内容，快速获取知识并免去广告。

WebSideChat，利用AI知识回答你网页上、视频中小小的疑问。

## 功能

- **简单配置**：兼容Claude Code、Codex、OpenCode等工具配置。一份配置、多处使用，支持DeepSeek， 智谱等多供应商。
- **YouTube，bilibili 视频对话**：
- **多轮追问**：网页正文作为常驻上下文，针对本页内容连续提问
- **提示词自定义**：可编辑摘要指令，支持恢复内置默认
- **多标签页并行**：每个标签页是独立会话与独立流——可同时在多个标签页生成摘要/追问，互不打断，关闭后重开即见。

## 手动安装


Chrome 打开 `chrome://extensions` → 开发者模式 → "加载已解压的扩展程序" → 选择 `.output/chrome-mv3`。Edge 同理（`edge://extensions`）。

## 开发

```bash
npm install
npm run dev        # 起 WXT dev server，自动打开 Chrome 加载扩展
npm test           # vitest 单测（SSE 解析、会话 LRU、URL 规范化）
npm run compile    # tsc 类型检查
npm run build      # 产物 .output/chrome-mv3/
npm run zip        # 打包 .output/*.zip（可上架/分发）
```

手动加载：Chrome 打开 `chrome://extensions` → 开发者模式 → "加载已解压的扩展程序" → 选择 `.output/chrome-mv3`。Edge 同理（`edge://extensions`）。


## 已知限制（v2 规划）

- 超长正文为字符截断，未做分层摘要（map-reduce）
- 供应商表单暂无 JSON 直接编辑视图
- 商店化前需将 `<all_urls>` 降级为 `optional_host_permissions` 按需申请

## TODO:

1. 兼容grok cli、gemini cli配置文件
2. 支持Edge、firefox浏览器