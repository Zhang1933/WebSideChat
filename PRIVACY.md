# Privacy Policy | 隐私政策

**Last updated: 2026-10-07**

WebSideChat is a browser extension that lets you summarize and chat with the current page or video using your own AI provider (BYOK — bring your own key). This policy explains what data the extension handles and where it goes.

WebSideChat 是一款浏览器扩展，让你使用自己配置的 AI 服务（BYOK）对当前网页或视频进行摘要与对话。本政策说明扩展处理的数据及其去向。

## 1. Data stored locally | 本地存储的数据

The following data is stored **only on your device** (via `chrome.storage.local`) and never uploaded, synced, or sent to any developer-controlled server:

- **Provider settings** — the LLM provider name, base URL, model, and API key **you** configure.
- **Chat history** — your conversations, per page.
- **UI preferences** — language, theme, and other settings.

以下数据**仅存储在你的设备上**（`chrome.storage.local`），不会上传、同步或发送到任何开发者控制的服务器：

- **供应商设置** —— 你自行配置的 LLM 供应商名称、Base URL、模型与 API key
- **对话历史** —— 各页面的会话记录
- **界面偏好** —— 语言、主题等设置

## 2. Data transmitted | 传输的数据

When you send a message, the extension transmits data **directly from your browser to the LLM provider endpoint you configured**:

- The extracted text of the current page, or the subtitles of the current video.
- Your message and recent conversation history, as needed by the request.

The developer of WebSideChat has no access to this data — it goes only to the provider you chose, and is subject to that provider's own privacy policy.

Video subtitles are fetched from the video platforms themselves (YouTube / Bilibili) only when you use the feature on that video page.

发送消息时，扩展将数据**从你的浏览器直接传输到你自行配置的 LLM 服务端点**：当前页面的正文（或当前视频的字幕）、你的提问及必要的对话历史。开发者无法接触这些数据——它们只发往你选择的供应商，并受该供应商隐私政策约束。

视频字幕仅在你于对应视频页使用该功能时，从视频平台（YouTube / B站）拉取。

## 3. What we don't do | 我们不做的事

- No analytics, no telemetry, no tracking.
- No ads.
- No developer-owned servers; nothing is collected on our side.
- No selling or sharing of data.

无统计埋点、无遥测、无跟踪；无广告；无开发者服务器，开发者侧不收集任何数据；不出售或共享任何数据。

## 4. Data removal | 数据删除

All data can be cleared at any time from the extension's settings page, and is permanently removed when you uninstall the extension or clear the site's extension storage.

所有数据可随时在扩展设置页清除；卸载扩展或清除扩展存储后，数据将被永久删除。

## 5. Contact | 联系方式

Questions about this policy can be raised via the repository's Issues page:
<https://github.com/Zhang1933/WebSideChat/issues>

如对本政策有疑问，请通过仓库 Issues 联系。

## 6. Changes | 政策变更

If this policy changes, the updated version will be published at this URL with a new "Last updated" date.

政策如有变更，将在此页面发布更新版本并修改「Last updated」日期。
