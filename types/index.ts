/** LLM API 协议格式（对齐 cc-switch 的 apiFormat 概念） */
export type ApiFormat = 'openai_chat' | 'anthropic';

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
  /** true = Readability 解析失败，退化为 body.innerText */
  fallback: boolean;
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
  updatedAt: number;
}

export interface AppSettings {
  maxContentChars: number;
  summaryLanguage: 'zh' | 'en' | 'auto';
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxContentChars: 48_000,
  summaryLanguage: 'zh',
};
