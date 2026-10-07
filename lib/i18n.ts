import { useEffect, useState } from 'react';

/**
 * 轻量 i18n：模块级语言状态 + 订阅重渲染（无第三方依赖）。
 * - t(key, ...args)：按当前语言取词条，{0}/{1}… 为参数占位；组件外（lib 错误文案）也能用
 * - useT()：组件内取 t 的 hook，语言切换时订阅重渲染
 * - setUiLang()：由设置（settings.uiLang）驱动，sidepanel 与 options 启动时各调一次
 */
export type UiLang = 'zh' | 'en';

/** 浏览器语言推断初始语言：zh* → 中文，其余 → English（用户显式选择后以存储值为准） */
export function defaultUiLang(): UiLang {
  return /^zh/i.test(navigator.language ?? '') ? 'zh' : 'en';
}

let currentLang: UiLang = defaultUiLang();
const listeners = new Set<() => void>();

export function setUiLang(lang: UiLang) {
  if (lang === currentLang) return;
  currentLang = lang;
  listeners.forEach((fn) => fn());
}

export function getUiLang(): UiLang {
  return currentLang;
}

/** 词条表：key → [中文, English] */
const DICT: Record<string, [string, string]> = {
  // ---- 通用 ----
  'common.cancel': ['取消', 'Cancel'],
  'common.save': ['保存', 'Save'],
  'common.saved': ['已保存', 'Saved'],
  'common.close': ['关闭', 'Close'],
  'common.copy': ['复制', 'Copy'],
  'common.copied': ['已复制', 'Copied'],
  'common.edit': ['编辑', 'Edit'],
  'common.delete': ['删除', 'Delete'],
  'common.use': ['使用', 'Use'],
  'common.inUse': ['使用中', 'Active'],
  'common.settings': ['设置', 'Settings'],
  'common.back': ['返回', 'Back'],

  // ---- 顶栏 ----
  'header.noProvider': ['未配置供应商', 'No provider'],
  'header.switchProvider': ['切换供应商', 'Switch provider'],
  'header.emptyHint': ['暂无供应商，去设置里添加', 'No providers yet — add one in settings'],
  'header.manage': ['管理供应商…', 'Manage providers…'],
  'header.pinOn': ['已固定：新标签页自动展开侧边栏（点击取消）', 'Pinned: auto-open on new tabs (click to unpin)'],
  'header.pinOff': ['固定：新标签页自动展开侧边栏', 'Pin: auto-open sidebar on new tabs'],
  'header.pinOnAria': ['取消自动展开：新标签页不再默认打开侧边栏', 'Disable auto-open on new tabs'],
  'header.pinOffAria': ['新标签页自动展开侧边栏', 'Auto-open sidebar on new tabs'],
  'header.closeDrawer': ['关闭本页抽屉', 'Close drawer on this tab'],
  'header.closeDrawerAria': ['关闭抽屉', 'Close drawer'],

  // ---- 页面信息条 ----
  'pagebar.noTab': ['无活动标签页', 'No active tab'],
  'pagebar.viewContent': ['查看提取内容（调试）', 'View extracted content (debug)'],
  'pagebar.extracted': ['已提取 {0} 字符', '{0} chars extracted'],
  'pagebar.truncated': ['（截断）', ' (truncated)'],
  'pagebar.reextractAria': ['重新提取并生成摘要', 'Re-extract and summarize'],
  'pagebar.reextract': ['重新提取正文并重新生成摘要', 'Re-extract content and regenerate summary'],

  // ---- 对话区 ----
  'chat.summarizeVideo': ['帮我总结视频内容', 'Summarize this video'],
  'chat.summarizePage': ['帮我总结网页内容', 'Summarize this page'],
  'chat.extracting': ['正在提取页面正文…', 'Extracting page content…'],
  'chat.compressed': ['上文已压缩：早期对话已摘要为下方纪要，可继续追问', 'Context compressed: earlier turns summarized below, keep asking'],
  'chat.editing': ['正在编辑此消息，Enter 重新发送（之后的对话将被移除）', 'Editing this message — press Enter to resend (later turns will be removed)'],
  'chat.placeholder': ['针对本页内容提问，Enter 发送', 'Ask about this page, Enter to send'],
  'chat.stop': ['停止', 'Stop'],
  'chat.send': ['发送', 'Send'],
  'bubble.editTitle': ['编辑并重新发送', 'Edit and resend'],
  'bubble.copyTitle': ['复制', 'Copy'],

  // ---- 提取内容查看器 ----
  'viewer.title': ['提取内容（送入模型的正文）', 'Extracted content (sent to the model)'],
  'viewer.chars': ['字符', 'chars'],
  'viewer.truncated': ['（已截断）', ' (truncated)'],
  'viewer.extractedAt': ['提取于', 'Extracted at'],
  'viewer.empty': ['（无内容）', '(no content)'],
  'viewer.download': ['下载 .md', 'Download .md'],

  // ---- 面板状态（App）----
  'app.noProviderTitle': ['还没有配置 LLM 供应商', 'No LLM provider configured yet'],
  'app.noProviderHint': ['去添加供应商', 'Add a provider'],
  'app.noProviderErr': ['请先在设置中配置并启用一个供应商', 'Configure and enable a provider in settings first'],
  'app.noPageErr': ['没有可提取的页面', 'No page to extract'],
  'app.extractFail': ['提取失败：{0}', 'Extraction failed: {0}'],
  'app.turnFail': ['发起生成失败：{0}', 'Failed to start generation: {0}'],
  'app.confirmRegen': ['重新生成摘要将清空后续追问对话，继续？', 'Regenerating will clear follow-up messages. Continue?'],
  'app.pinPermErr': [
    '开启固定抽屉需要「所有网站」访问权限（用于在新标签页自动展开），请重试并在弹窗中允许',
    'Pinning requires "all sites" access (to auto-open on new tabs). Retry and allow the prompt',
  ],
  'app.needPermTitle': ['需要授权访问 {0}', 'Permission needed for {0}'],
  'app.needPermHint': [
    '点一次上方工具栏的扩展图标也可临时授权（当前标签页有效）；或为本站永久授权：',
    'Click the toolbar icon once for a temporary grant (this tab only); or grant permanently:',
  ],
  'app.grantSite': ['授权本站（{0}）', 'Grant access ({0})'],

  // ---- 供应商页 ----
  'providers.title': ['供应商设置', 'Providers'],
  'providers.choosePreset': ['选择预设', 'Choose a preset'],
  'providers.editing': ['编辑：{0}', 'Edit: {0}'],
  'providers.adding': ['新增：{0}', 'Add: {0}'],
  'providers.add': ['新增供应商', 'Add provider'],
  'providers.emptyHint': [
    '还没有供应商——选择 Claude Code / Codex / OpenCode，或粘贴配置文件导入',
    'No providers yet — pick Claude Code / Codex / OpenCode, or paste a config file',
  ],
  'providers.deleteConfirm': ['删除供应商「{0}」？', 'Delete provider "{0}"?'],
  'providers.general': ['通用设置', 'General'],
  'providers.summaryLang': ['摘要语言', 'Summary language'],
  'providers.summaryLangAuto': ['跟随页面语言', 'Follow page language'],
  'providers.uiLang': ['显示语言', 'Display language'],
  'providers.debugMode': ['显示提取的 Web 内容', 'Show extracted web content'],
  'providers.debugHint': [
    '顶栏"已提取 N 字符"可点击，查看实际送入模型的提取内容',
    'Click the "N chars extracted" badge to view what is actually sent to the model',
  ],
  'providers.migrateTitle': ['{0} 个供应商域名需要重新授权网络访问', '{0} provider domain(s) need re-authorization'],
  'providers.migrateHint': [
    '升级为按域授权后，已有供应商需要补一次权限，否则对话请求无法发出',
    'After switching to per-origin permissions, existing providers need a one-time grant, otherwise requests will fail',
  ],
  'providers.migrateBtn': ['一键授权', 'Grant all'],

  'form.oauthOk': ['登录成功{0}，已生成 auth.json 与默认 config.toml', 'Signed in{0} — auth.json and default config.toml generated'],
  'form.oauthAccount': ['（账号 {0}…）', ' (account {0}…)'],
  'form.oauthFail': ['登录失败：{0}', 'Sign-in failed: {0}'],
  'form.fmtChat': ['OpenAI 兼容（chat/completions）', 'OpenAI-compatible (chat/completions)'],
  'form.fmtAnthropic': ['Anthropic（v1/messages）', 'Anthropic (v1/messages)'],
  'form.fmtResponses': ['OpenAI Responses（v1/responses）', 'OpenAI Responses (v1/responses)'],

  // ---- 配置类型网格 ----
  'preset.title': ['选择配置类型（支持配置文件导入）', 'Choose a config type (file import supported)'],
  'preset.anyEndpoint': ['任意兼容端点', 'Any compatible endpoint'],
  'preset.sub.claude-settings': ['settings.json 配置', 'settings.json config'],
  'preset.sub.codex': ['auth.json + config.toml 配置', 'auth.json + config.toml config'],
  'preset.sub.opencode-json': ['opencode.json 配置', 'opencode.json config'],

  // ---- 供应商表单 ----
  'form.oauthTitle': ['ChatGPT 账号登录（OAuth）', 'ChatGPT sign-in (OAuth)'],
  'form.oauthHint': ['跳转网页授权，成功后自动生成 auth.json 与默认 config.toml', 'Opens the web authorization page and automatically populates auth.json and default config.toml.'],
  'form.codexProviderName': ['OpenAI (ChatGPT 登录)', 'OpenAI (ChatGPT sign-in)'],
  'form.oauthBtn': ['网页登录', 'Sign in on web'],
  'form.oauthWaiting': ['等待登录…', 'Waiting for sign-in…'],
  'form.oauthPermErr': ['登录需要访问 chatgpt.com 的权限，请重试并允许', 'Sign-in needs access to chatgpt.com — retry and allow'],
  'form.name': ['名称', 'Name'],
  'form.namePh': ['供应商显示名', 'Provider display name'],
  'form.apiFormat': ['接口协议', 'API protocol'],
  'form.apiKey': ['API Key', 'API Key'],
  'form.apiKeyPh': ['sk-…（Ollama 等本机服务可留空）', 'sk-… (leave empty for local services like Ollama)'],
  'form.showKey': ['显示 API Key', 'Show API Key'],
  'form.hideKey': ['隐藏 API Key', 'Hide API Key'],
  'form.baseUrl': ['Base URL', 'Base URL'],
  'form.baseUrlPh.chat': ['如 https://api.deepseek.com（自带版本段，无需自动补 /v1）', 'e.g. https://api.deepseek.com (versioned, no /v1 needed)'],
  'form.baseUrlPh.anthropic': ['如 https://api.anthropic.com', 'e.g. https://api.anthropic.com'],
  'form.baseUrlPh.responses': ['如 https://api.x.ai/v1', 'e.g. https://api.x.ai/v1'],
  'form.model': ['模型选择', 'Model'],
  'form.fetchModels': ['获取模型列表', 'Fetch models'],
  'form.fetching': ['获取中…', 'Fetching…'],
  'form.modelPh': ['选择模型', 'Select a model'],
  'form.manualInput': ['手动输入', 'Enter manually'],
  'form.modelIdPh': ['模型 ID', 'Model ID'],
  'form.modelFromConfig': ['（配置值）', ' (from config)'],
  'form.contextLimit': ['上下文上限（token）', 'Context limit (tokens)'],
  'form.contextAuto': ['自动：{0}', 'Auto: {0}'],
  'form.contextHint': [
    '留空 = 自动：模型名带长度后缀（如 [1m]、[128k]）自动取对应 token 数，否则 1,000,000；也可直接填 1m、128k',
    'Empty = auto: uses the suffix in the model name (e.g. [1m], [128k]), otherwise 1,000,000; you can also type 1m, 128k',
  ],
  'form.keyRequired': [
    'API Key 不能为空：粘贴配置文件（失焦自动填充），或手动填写',
    'API Key is required: paste a config file (auto-filled on blur) or type it manually',
  ],
  'form.baseUrlPermErr': [
    '未授予该域名访问权限，无法连接 API——重试保存并在弹窗中允许',
    'Domain access not granted — save again and allow the prompt',
  ],
  'form.modelsEmpty': ['接口返回空列表', 'API returned an empty list'],
  'form.modelsFail': ['获取失败：{0}', 'Fetch failed: {0}'],
  'form.modelsPermHint': [
    '尚未授权访问该 API 域名——点击「获取模型列表」并在弹窗中允许',
    'No access to this API domain yet — click "Fetch models" and allow the prompt',
  ],

  // ---- 配置导入区 ----
  'import.title.claude-settings': ['从 Claude Code settings.json 导入', 'Import from Claude Code settings.json'],
  'import.title.codex': ['从 Codex auth.json + config.toml 导入', 'Import from Codex auth.json + config.toml'],
  'import.title.opencode-json': ['从 OpenCode opencode.json 导入', 'Import from OpenCode opencode.json'],
  'import.pickFile': ['选择文件…', 'Choose file…'],
  'import.notToml': ['不是有效的 TOML 格式', 'Not valid TOML'],
  'import.tomlParseFail': ['TOML 解析失败', 'TOML parse failed'],
  'import.jsonErrPos': ['JSON 语法错误（第 {0} 行第 {1} 列）: {2}', 'JSON syntax error (line {0}, col {1}): {2}'],
  'import.jsonErr': ['JSON 语法错误: {0}', 'JSON syntax error: {0}'],
  'import.unrecognized': ['配置未识别', 'Config not recognized'],
  'import.readFail': ['读取文件失败：{0}', 'Failed to read file: {0}'],
  'import.applied': [
    '已识别 {0}，填入：{1}{2}',
    'Parsed {0}, filled: {1}{2}',
  ],
  'import.noNewFields': ['（无新字段）', '(no new fields)'],
  'import.f.baseUrl': ['Base URL', 'Base URL'],
  'import.f.apiKey': ['API Key', 'API Key'],
  'import.f.apiKeyOauth': ['API Key（ChatGPT OAuth）', 'API Key (ChatGPT OAuth)'],
  'import.f.model': ['模型', 'Model'],
  'import.f.apiFormat': ['协议', 'Protocol'],
  'import.f.context': ['上下文上限', 'Context limit'],

  // ---- 提示词设置 ----
  'prompts.web': ['📄 网页', '📄 Web'],
  'prompts.video': ['▶️ 视频', '▶️ Video'],
  'prompts.instruction': ['摘要指令', 'Summary instruction'],
  'prompts.restore': ['恢复默认', 'Restore default'],

  // ---- options 整页 ----
  'options.nav.general': ['语言', 'Language'],
  'options.nav.providers': ['供应商设置', 'Providers'],
  'options.nav.prompts': ['提示词设置', 'Prompts'],
  'options.subtitle': ['设置', 'Settings'],

  // ---- 提取错误（lib）----
  'err.extract.pageType': [
    '此页面类型不支持提取（浏览器内置页面 / 商店页 / PDF 查看器）',
    'This page type cannot be extracted (browser pages / store / PDF viewer)',
  ],
  'err.extract.noInjectPerm': [
    '无法访问此页面：可能是缺少本站注入权限（面板内可一键授权），或为浏览器内置页面 / 商店页',
    'Cannot access this page: missing injection permission (grant in the panel) or an unsupported browser page',
  ],
  'err.extract.permHint': [
    '没有注入权限：请点一次工具栏的扩展图标，或在面板内授权本站',
    'No injection permission: click the toolbar icon once or grant access in the panel',
  ],
  'err.extract.fail': ['页面提取失败：{0}', 'Page extraction failed: {0}'],
  'err.extract.empty': ['提取结果为空，请重试或换一个页面', 'Extraction returned nothing — retry or try another page'],
  'err.extract.scriptFail': ['页面脚本执行失败: {0}', 'Page script failed: {0}'],
  'err.yt.noPlayer': ['无法读取页面播放器数据，请确认在视频播放页', 'Cannot read player data — make sure this is a video watch page'],
  'err.yt.noCaptions': ['该视频没有可用字幕（纯音乐或未开启字幕），无法总结', 'No captions available (music-only or disabled)'],
  'err.yt.captionsOff': [
    '请先在播放器中开启字幕并选择语言（CC 按钮 → 字幕），然后重新提取',
    'Enable captions first (CC button → Subtitles), then extract again',
  ],
  'err.yt.badTrack': ['字幕轨道信息无效', 'Invalid caption track'],
  'err.yt.captureFail': [
    '字幕获取失败（未能捕获播放器的字幕请求），请确认字幕已在播放器中正常显示后重试',
    'Failed to capture the player caption request — make sure captions render in the player, then retry',
  ],
  'err.bili.noVideoData': ['无法读取页面视频数据，请确认在 B 站视频播放页', 'Cannot read video data — make sure this is a Bilibili video page'],
  'err.bili.noZhCaptions': ['该视频没有中文字幕（AI 字幕需登录 B 站，且仅部分视频开启）', 'No Chinese subtitles (AI subtitles need Bilibili sign-in and are limited)'],
  'err.bili.listCode': ['字幕列表接口返回 {0}{1}', 'Subtitle list API returned {0}{1}'],
  'err.bili.listFail': ['字幕列表请求失败：{0}', 'Subtitle list request failed: {0}'],
  'err.bili.badUrl': ['字幕地址无效', 'Invalid subtitle URL'],
  'err.bili.cdnEmpty': ['字幕内容获取失败（CDN 响应为空），请重试', 'Subtitle fetch failed (empty CDN response) — retry'],

  // ---- LLM 错误（lib）----
  'err.llm.auth': ['鉴权失败（HTTP {0}）：请检查 API Key 是否正确', 'Auth failed (HTTP {0}): check your API key'],
  'err.llm.rateLimit': ['请求过于频繁（HTTP 429）：请稍后重试', 'Rate limited (HTTP 429): retry later'],
  'err.llm.notFound': ['接口不存在（HTTP 404）：请检查 Base URL 是否正确{0}', 'Endpoint not found (HTTP 404): check the Base URL{0}'],
  'err.llm.http': ['请求失败（HTTP {0}）{1}', 'Request failed (HTTP {0}){1}'],
  'err.llm.network': [
    '网络错误：{0}。若连接本机 Ollama，请设置环境变量 OLLAMA_ORIGINS=chrome-extension://* 后重启 Ollama',
    'Network error: {0}. For local Ollama, set OLLAMA_ORIGINS=chrome-extension://* and restart it',
  ],
  'err.llm.streamBroken': ['流式传输中断：{0}', 'Stream interrupted: {0}'],
  'err.llm.stopped': ['已停止生成', 'Generation stopped'],
  'err.llm.empty': [
    '模型返回了空内容（HTTP 200 但没有任何输出），可能是服务端偶发问题，请重试',
    'Model returned empty output (HTTP 200, no content) — likely transient, please retry',
  ],

  'app.engineNotReady': ['生成引擎未就绪（offscreen 无应答），请重试', 'Generation engine not ready (no offscreen response) — retry'],

  // ---- 回合占位（offscreen）----
  'turn.stoppedPlaceholder': ['*（已停止，未生成内容）*', '*(stopped, nothing generated)*'],
  'turn.emptyPlaceholder': ['*（未生成内容，请重试）*', '*(no content generated, please retry)*'],
  'turn.interrupted': ['生成已中断', 'Generation interrupted'],
  'turn.internalErr': ['*（回合引擎内部错误，请重试）*', '*(turn engine internal error, please retry)*'],
  'turn.internalErrDetail': ['回合引擎内部错误：{0}', 'Turn engine internal error: {0}'],
};

export function t(key: string, ...args: (string | number)[]): string {
  const entry = DICT[key];
  let text = entry ? (currentLang === 'zh' ? entry[0] : entry[1]) : key;
  args.forEach((a, i) => {
    text = text.replaceAll(`{${i}}`, String(a));
  });
  return text;
}

/** 组件内使用：语言切换时触发重渲染 */
export function useT(): (key: string, ...args: (string | number)[]) => string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((x) => x + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return t;
}
