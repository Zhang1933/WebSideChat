# AbstractWeb

浏览器扩展（Chrome / Edge，Manifest V3）：一键提取当前网页正文，交给 LLM 生成结构化摘要，并可基于该页面内容持续追问。全程在 Side Panel 侧边栏完成，无 popup。

供应商配置体验参考 [cc-switch](https://github.com/farion1231/cc-switch)：多供应商卡片列表 + "使用中"高亮切换 + 预设网格→表单两步式新增，`apiFormat` 字段区分协议格式。

## 功能

- **正文提取**：按需注入 Readability（非常驻 content script，不拖慢页面），失败时退化 `body.innerText`
- **AI 摘要**：流式 Markdown 渲染（打字机效果），可随时停止并保留已生成部分
- **多轮追问**：网页正文作为常驻上下文，针对本页内容连续提问
- **会话持久化**：按 URL（去 hash/跟踪参数）保存会话，切标签页/重启浏览器后恢复，LRU 保留最近 10 个页面
- **多供应商**：内置 DeepSeek / Kimi / 通义千问 / 智谱 / OpenAI / Anthropic / Ollama 预设，也可添加任意自定义端点
- **双协议**：`openai_chat`（`POST {baseUrl}/chat/completions`）与 `anthropic`（`POST {baseUrl}/v1/messages`），表单里可拉取 `/models` 模型列表

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

## 使用

1. 点击工具栏图标打开侧边栏
2. 首次使用进入 ⚙ 设置 → **新增供应商** → 选预设（如 DeepSeek）→ 填 API Key → 「获取模型列表」选择模型 → 保存
3. 打开任意网页 → 点 **提取并生成摘要**
4. 在底部输入框针对页面内容追问；顶栏下拉可随时切换供应商

## 架构

```
entrypoints/
  background.ts          # 仅 setPanelBehavior：点图标直达侧边栏
  sidepanel/             # React 应用（工作区 + 设置两视图）
  extract.content.ts     # registration:'runtime' 内容脚本（按需注入）
lib/
  llm/                   # 双协议适配器 + SSE 流解析 + 模型列表
  extract.ts / tabs.ts   # 注入编排 / 激活标签页跟踪
  storage.ts             # WXT storage：providers/settings/conversations
  conversation.ts        # 会话纯函数（LRU、消息追加）
  prompts.ts             # system 提示组装（<page> 包裹正文）
config/presets.ts        # 供应商预设
```

要点：

- LLM 请求由 Side Panel 页面直接 `fetch`（MV3 扩展页面对 `host_permissions` 域免 CORS）；SSE 手动分帧解析，因 `EventSource` 无法携带鉴权头
- manifest 权限：`storage` + `scripting` + `sidePanel`，`host_permissions: <all_urls>`（用户可配任意 LLM 域名 + 任意页面注入）
- API Key 明文存 `chrome.storage.local`（仅本机，与 cc-switch 一致）；除 LLM 请求外无任何数据出站

## 故障排查

| 现象 | 处理 |
|---|---|
| 连接本机 Ollama 报网络错误 | Ollama 校验 Origin，需设 `OLLAMA_ORIGINS=chrome-extension://*`（或 `*`）后重启 Ollama |
| 提示"此页面类型不支持提取" | `chrome://` 内置页、商店页、PDF 查看器禁止注入，属预期 |
| 401/403 | 检查 API Key；404 检查 Base URL（预设已带版本段，不要重复加 `/v1`） |
| 正文被截断 | 设置 → 提取上限（默认 48,000 字符，最高 200,000） |

## 已知限制（v2 规划）

- 超长正文为字符截断，未做分层摘要（map-reduce）
- 供应商表单暂无 JSON 直接编辑视图
- 商店化前需将 `<all_urls>` 降级为 `optional_host_permissions` 按需申请
