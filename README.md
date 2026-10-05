<h1 align="center">
<sub>
<img src="https://github.com/Zhang1933/WebSideChat/blob/main/assets/icon.svg" height="38" width="38">
</sub>
WebSideChat
</h1>

WebSideChat，一个简单的浏览器扩展，一键提取网页、视频内容，用你喜欢的AI与网页对话。。

WebSideChat，帮你总结网页、视频内容，快速获取知识并免去广告。

WebSideChat，回答你网页上、视频中小小的疑问。

## 功能

- **简单配置**：兼容Claude Code、Codex、OpenCode等工具配置。一份配置、多处使用，支持DeepSeek， 智谱等多供应商。
- **视频Chat**：支持 YouTube 与 B站视频，快速提炼视频要点，免看广告，直接针对视频里的疑问进行提问。
- **多轮追问**：网页正文作为常驻上下文，针对本页内容连续提问
- **提示词自定义**：可编辑摘要指令，支持恢复内置默认
- **多标签页并行**：每个标签页是独立会话与独立流——可同时在多个标签页对话，互不打断。

## 手动安装

1. 从 [Releases](https://github.com/Zhang1933/WebSideChat/releases) 页面下载最新版的 `websidechat-vX.Y.Z-chrome.zip`
2. 解压 zip 到任意文件夹
3. Chrome 打开 `chrome://extensions` → 打开右上角"开发者模式" → "加载已解压的扩展程序" → 选择**解压后的文件夹**

## 插件配置

安装好后，点击插件图标，打开插件侧边栏，按照引导添加配置即可，就像在配置cc switch或各种agent工具一样。

## 开发

```bash
npm install
npm run dev        # 起 WXT dev server，自动打开 Chrome 加载扩展
npm test           # vitest 单测（SSE 解析、会话 LRU、URL 规范化）
npm run compile    # tsc 类型检查
npm run build      # 产物 .output/chrome-mv3/
npm run zip        # 打包 .output/*.zip（可上架/分发）
```

## TODO:

1. 兼容grok cli、gemini cli配置文件
2. 支持Edge、firefox浏览器