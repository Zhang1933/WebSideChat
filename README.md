# WebSideChat

浏览器扩展（Chrome / Edge，Manifest V3）：一键提取当前网页正文，交给 LLM 生成结构化摘要，并可基于该页面内容持续追问。全程在 Side Panel 侧边栏完成，无 popup。

供应商配置体验参考 [cc-switch](https://github.com/farion1231/cc-switch)：多供应商卡片列表 + "使用中"高亮切换 + 预设网格→表单两步式新增，`apiFormat` 字段区分协议格式。

## 功能

- **正文提取**：按需注入（非常驻 content script，不拖慢页面）——Readability 定位正文容器后 **DOM→Markdown 转换**（turndown + GFM），保留标题层级/列表/表格/链接；非文章页退化为整页清洗转换，最终兜底 `innerText`
- **YouTube 视频总结/对话**：识别到 youtube.com 观看页（watch/shorts）时以**字幕**替代网页正文作为上下文——参考 youtube-transcript-api 方案：页面内提取 `INNERTUBE_API_KEY` 调 **Innertube player（ANDROID 客户端）** 拿字幕轨道（免 pot），页面内嵌 `ytInitialPlayerResponse` 兜底；轨道选择中文 > 手动上传，`timedtext` 拉取（json3 → XML 降级），生成 `[时:分:秒]` 时间戳稿，可问"第 X 分钟讲了什么"；风控/年龄限制/无字幕均有明确提示
- **AI 摘要**：流式 Markdown 渲染（打字机效果），可随时停止并保留已生成部分
- **多轮追问**：网页正文作为常驻上下文，针对本页内容连续提问
- **会话持久化**：按 URL（去 hash/跟踪参数）保存会话，切标签页/重启浏览器后恢复，LRU 保留最近 10 个页面
- **多供应商**：内置 DeepSeek / Kimi / 通义千问 / 智谱 / OpenAI / Anthropic / Ollama 预设，也可添加任意自定义端点
- **配置文件导入**（新增第一步选配置类型，对齐 cc-switch）：**Claude** → `settings.json`（`env.ANTHROPIC_*`）；**OpenAI** → `auth.json`（`OPENAI_API_KEY`）+ `config.toml`（`model` / `model_providers.*.base_url`，TOML 解析）；**OpenCode** → `opencode.json`（`provider.*` 表：`options.baseURL`/`apiKey`/模型与 `limit.context`，`npm` 决定协议）。粘贴或选文件，自动识别回填表单（含上下文上限）并拉取模型列表
- **三协议 LLM 客户端**：`openai_chat`（chat/completions）、`anthropic`（v1/messages）、`openai_responses`（v1/responses，ChatGPT 登录与 `wire_api="responses"` 的端点）
- **ChatGPT OAuth 网页登录**：OpenAI 类型表单的「网页登录」按钮复刻 `codex login` 的 PKCE 流程（跳转授权页 → 自动捕获回调 → 换取令牌，全程不接触密码）；也可导入 Codex 的 `auth.json`。OAuth 自动指向 `chatgpt.com/backend-api/codex` 后端并携带 Codex 标识头，令牌约 10 天有效，到期重新登录
- **提示词自定义**：设置页（左侧导航）可编辑系统提示词（角色设定）与摘要指令，支持恢复内置默认
- **上下文管理**：每个供应商可配置**上下文上限（token）**（模型名带长度后缀如 `[1m]`/`[128k]` 自动取对应值，默认 128k）；正文提取预算 = 上下文 × 0.8；多轮对话超过阈值时**自动调用模型压缩历史**为纪要，仍超则逐步缩减正文
- **标签独立抽屉**：content script 注入 shadow DOM + iframe 承载完整应用，可见性按 tabId 存 session（导航自动恢复），工具栏图标切换；chrome:// 等不可注入页回退原生侧边栏
- **多标签页并行**：每个标签页是独立会话与独立流——可同时在多个标签页生成摘要/追问，互不打断；关闭抽屉/切页/导航后流在 Offscreen 后台继续完成并写入该页会话，重开即见（同一页面同时只有一条流，重新发起会中止该页旧流）
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

1. **点击工具栏图标**：切换当前标签页的注入式抽屉侧边栏（**每个标签页独立开关**，默认新标签页不展开）
2. 抽屉头部 **📌 pin**：开启后新建标签页自动展开抽屉；**×** 关闭本页抽屉
3. 在 `chrome://` 等不可注入页面点图标 → 回退为原生侧边栏（同一应用）
4. 首次使用点"去添加供应商"（或 ⚙）——在新标签页打开设置：选配置类型（Claude/OpenAI，支持粘贴配置文件导入或 ChatGPT 网页登录）→ 保存即生效
5. 打开任意网页 → 点「帮我总结网页内容」气泡或直接提问；YouTube 视频页以字幕为上下文

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

- LLM 回合引擎（流式请求、上下文压缩、结果落库）跑在 **Offscreen Document**（MV3 常驻后台页，不受 Service Worker idle 回收影响）；侧边栏只是视图——**关闭面板/切换标签页生成不中断**，重开面板自动接上在途流；SSE 手动分帧解析（`EventSource` 无法携带鉴权头）；offscreen 文档空闲 2 分钟自动关闭省内存
- manifest 权限：`storage` + `scripting` + `sidePanel`，`host_permissions: <all_urls>`（用户可配任意 LLM 域名 + 任意页面注入）
- API Key 明文存 `chrome.storage.local`（仅本机，与 cc-switch 一致）；除 LLM 请求外无任何数据出站

## 故障排查

| 现象 | 处理 |
|---|---|
| 连接本机 Ollama 报网络错误 | Ollama 校验 Origin，需设 `OLLAMA_ORIGINS=chrome-extension://*`（或 `*`）后重启 Ollama |
| 提示"此页面类型不支持提取" | `chrome://` 内置页、商店页、PDF 查看器禁止注入，属预期 |
| 401/403 | 检查 API Key；404 检查 Base URL（预设已带版本段，不要重复加 `/v1`） |
| 正文被截断 | 提取预算由供应商「上下文上限」推导（上下文/5 折算字符；`[1m]` 模型自动 1M，默认 128k，可手动配置） |
| 对话中出现"上文已压缩" | 上下文接近上限时自动把早期对话摘要为纪要，属正常行为；不想压缩可在供应商配置里调大上下文上限 |

## 已知限制（v2 规划）

- 超长正文为字符截断，未做分层摘要（map-reduce）
- 供应商表单暂无 JSON 直接编辑视图
- 商店化前需将 `<all_urls>` 降级为 `optional_host_permissions` 按需申请
