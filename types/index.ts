/** LLM API 协议格式（对齐 cc-switch 的 apiFormat 概念） */
export type ApiFormat = 'openai_chat' | 'anthropic' | 'openai_responses';

/** 供应商配置（扁平结构，存储于 chrome.storage.local） */
export interface Provider {
  id: string; // crypto.randomUUID()
  name: string;
  /** 自带版本段，如 https://api.deepseek.com / https://api.openai.com/v1；代码只去尾斜杠拼固定后缀，不自动补 /v1 */
  baseUrl: string;
  /** 明文存 storage.local（与 cc-switch 一致） */
  apiKey: string;
  model: string;
  apiFormat: ApiFormat;
  /** 上下文上限（token）；留空 = 自动：模型名以 [1m] 结尾取 1,000,000，否则 128,000 */
  contextLimit?: number;
  /** ChatGPT OAuth 登录的账号 ID（来自 auth.json 的 tokens.account_id），随 access_token 使用 */
  accountId?: string;
  /** 导入区各输入框的内容（settings.json / auth.json / config.toml 原文），编辑时回显、保存时重新解析 */
  importTexts?: Record<string, string>;
  /** 新增时选择的配置类型（决定编辑时导入区的槽位形状） */
  importHint?: ProviderPreset['importHint'];
  /** 'deepseek' | 'kimi' | 'moonshot' | 'qwen' | 'openai' | 'anthropic' | 'ollama' | 'custom' */
  icon?: string;
  iconColor?: string;
  category?: 'preset' | 'custom';
  createdAt: number;
}

/** 内置供应商预设（新增时的模板） */
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  defaultModel: string;
  /** "获取 API Key ↗" 外链 */
  apiKeyUrl?: string;
  websiteUrl?: string;
  icon: string;
  iconColor?: string;
  /** 配置文件导入格式提示：决定导入区的标题与占位符 */
  importHint?: 'claude-settings' | 'codex' | 'gemini-env' | 'grok-toml';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** extract.content 主函数的返回值（必须 JSON 可序列化才能经 executeScript 回传） */
export interface ExtractResult {
  title: string;
  byline?: string;
  siteName?: string;
  textContent: string;
  length: number;
  /** true = Readability 未命中正文，退化为整页转换 */
  fallback: boolean;
  /** 提取产物格式：markdown（turndown 转换）或 plaintext（innerText 兜底） */
  format: 'markdown' | 'plaintext';
  /** 提取失败的可读原因（如 YouTube 视频无字幕）；有值时 panel 侧转为错误 */
  error?: string;
}

/** 按页面（pageKey）持久化的会话 */
export interface Conversation {
  /** normalizeUrl(url)：去 hash、去跟踪参数 */
  pageKey: string;
  url: string;
  title: string;
  /** 截断后的正文，追问的上下文 */
  content: string;
  truncated: boolean;
  extractedAt: number;
  /** [0] 恒为摘要轮 */
  messages: ChatMessage[];
  /** 摘要轮使用的固定指令原文（用于 UI 隐藏该条消息）；首轮直接提问的会话无此字段 */
  summaryPrompt?: string;
  updatedAt: number;
}

export interface AppSettings {
  summaryLanguage: 'zh' | 'en' | 'auto';
  /** 显示提取的 Web 内容：顶栏"已提取 N 字符"可点击查看实际送入模型的正文（默认开） */
  debugMode?: boolean;
  /** 自定义系统提示词（角色设定）；空/未设置 = 使用内置默认 */
  customSystemPrompt?: string;
  /** 自定义摘要指令；空/未设置 = 按 summaryLanguage 使用内置默认 */
  customSummaryPrompt?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  summaryLanguage: 'zh',
  debugMode: true,
};
