import type { ProviderPreset } from '@/types';

/**
 * 配置类型预设（新增第一步的大卡片，对齐 cc-switch 的 App 概念）：
 * 每种类型绑定对应的配置文件导入格式。
 */
export const CONFIG_TYPE_PRESETS: ProviderPreset[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    defaultModel: 'claude-sonnet-5',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    websiteUrl: 'https://www.anthropic.com',
    icon: 'anthropic',
    iconColor: '#D97757',
    importHint: 'claude-settings',
  },
  {
    id: 'openai',
    name: 'Codex',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai_chat',
    defaultModel: 'gpt-5.5',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    websiteUrl: 'https://openai.com',
    icon: 'openai',
    iconColor: '#10A37F',
    importHint: 'codex',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    baseUrl: '',
    apiFormat: 'openai_chat',
    defaultModel: '',
    websiteUrl: 'https://opencode.ai',
    icon: 'opencode',
    importHint: 'opencode-json',
  },
];

/**
 * 供应商预设（配置类型下方的手动路径）：baseUrl 自带正确的版本段，
 * 代码只去尾斜杠拼固定后缀，绝不自动补 /v1。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    apiFormat: 'openai_chat',
    defaultModel: '',
    icon: 'custom',
    iconColor: '#737373',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiFormat: 'openai_chat',
    defaultModel: 'deepseek-chat',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    websiteUrl: 'https://www.deepseek.com',
    icon: 'deepseek',
    iconColor: '#4D6BFE',
  },
  {
    id: 'kimi',
    name: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiFormat: 'openai_chat',
    defaultModel: 'kimi-k2-turbo-preview',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    websiteUrl: 'https://platform.moonshot.cn',
    icon: 'kimi',
    iconColor: '#16191E',
  },
  {
    id: 'kimi-anthropic',
    name: 'Kimi（Anthropic 兼容）',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    apiFormat: 'anthropic',
    defaultModel: 'kimi-k2-turbo-preview',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    websiteUrl: 'https://platform.moonshot.cn',
    icon: 'kimi',
    iconColor: '#16191E',
  },
  {
    id: 'qwen',
    name: '通义千问（百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: 'openai_chat',
    defaultModel: 'qwen-plus',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    websiteUrl: 'https://bailian.console.aliyun.com',
    icon: 'qwen',
    iconColor: '#615CED',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiFormat: 'openai_chat',
    defaultModel: 'glm-4.6',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    websiteUrl: 'https://open.bigmodel.cn',
    icon: 'zhipu',
    iconColor: '#3859FF',
  },
  {
    id: 'ollama',
    name: 'Ollama（本机）',
    baseUrl: 'http://localhost:11434/v1',
    apiFormat: 'openai_chat',
    defaultModel: 'qwen3:latest',
    websiteUrl: 'https://ollama.com',
    icon: 'ollama',
    iconColor: '#0D0D0D',
  },
];
