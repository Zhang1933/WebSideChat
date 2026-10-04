import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { ApiFormat } from '@/types';

export interface ProviderDraft {
  apiFormat?: ApiFormat;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** 配置文件中显式给出的上下文上限（token），如配置文件显式给出 */
  contextLimit?: number;
  /** ChatGPT OAuth 登录（auth_mode=chatgpt）的账号 ID，随 access_token 一起用于鉴权头 */
  accountId?: string;
}

export type ConfigSource =
  | 'claude-settings'
  | 'codex-auth'
  | 'codex-toml'
  | 'generic-fields'
  | 'unknown';

export interface ParsedProviderConfig extends ProviderDraft {
  /** 自动识别出的配置格式，用于导入提示 */
  source: ConfigSource;
}

export const CONFIG_SOURCE_LABELS: Record<ConfigSource, string> = {
  'claude-settings': 'Claude 配置（settings.json env / cc-switch Claude 格式）',
  'codex-auth': 'OpenAI 配置（auth.json / cc-switch Codex 格式）',
  'codex-toml': 'Codex config.toml（模型与自定义端点）',
  'generic-fields': '通用字段 JSON（baseUrl/apiKey/model）',
  unknown: '未识别',
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 解析供应商配置，自动识别格式（对齐 cc-switch 的 settingsConfig 形状）：
 *
 * ① ~/.claude/settings.json / cc-switch Claude：{ env: { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN | ANTHROPIC_API_KEY, ANTHROPIC_MODEL } }（也接受扁平 env）
 * ② ~/.codex/auth.json / cc-switch Codex：{ OPENAI_API_KEY } 或 { auth: { OPENAI_API_KEY } }
 * ③ ~/.codex/config.toml：model = "…" + [model_providers.X].base_url = "…"（TOML）
 * ④ 通用字段：{ "baseUrl" | "baseURL", "apiKey" | "api_key", "model", "apiFormat?" }
 *
 * 输入非法 JSON 时尝试按 TOML 解析；两者都失败抛出异常，由调用方展示错误。
 */
export function parseProviderConfig(text: string): ParsedProviderConfig {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('内容为空');

  let json: unknown;
  let jsonError: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (err) {
    jsonError = err;
  }

  if (json !== undefined) {
    const obj = asRecord(json);
    if (!obj) return { source: 'unknown' };
    return parseJsonObject(obj);
  }

  // 非 JSON → 尝试 Codex config.toml
  try {
    const toml = asRecord(parseToml(trimmed));
    if (toml) {
      const codex = parseCodexToml(toml);
      if (codex) return codex;
    }
  } catch {
    // 非 TOML → 报 JSON 错误
  }
  throw new Error(`既不是合法 JSON，也不是可识别的 config.toml：${String(jsonError ?? '')}`.trim());
}

/**
 * 解析并合并多个输入框的配置文本（OpenAI 类型的 auth.json + config.toml 双框等）。
 * 后解析的条目字段优先；单个条目解析失败不影响其余，错误逐条收集。
 */
export function parseAndMergeTexts(
  entries: { key: string; label?: string; text: string }[],
): { draft: ProviderDraft; labels: string[]; errors: string[] } {
  const drafts: ParsedProviderConfig[] = [];
  const labels: string[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    const raw = entry.text.trim();
    if (!raw) continue;
    try {
      const parsed = parseProviderConfig(raw);
      drafts.push(parsed);
      labels.push(CONFIG_SOURCE_LABELS[parsed.source].split('（')[0]!);
    } catch (err) {
      errors.push(`${entry.label ?? entry.key}解析失败：${(err as Error).message}`);
    }
  }
  const draft = drafts.reduce<ProviderDraft>(
    (acc, d) => ({
      apiFormat: d.apiFormat ?? acc.apiFormat,
      baseUrl: d.baseUrl ?? acc.baseUrl,
      apiKey: d.apiKey ?? acc.apiKey,
      model: d.model ?? acc.model,
      contextLimit: d.contextLimit ?? acc.contextLimit,
      accountId: d.accountId ?? acc.accountId,
    }),
    {},
  );
  return { draft, labels, errors };
}

/**
 * 净化 Codex config.toml：只保留对插件有意义的配置，去掉 projects/plugins/
 * notify/sandbox/approvals 等本机噪音后重新序列化。
 * 保留：顶层 model / model_provider / model_reasoning_effort；
 *       [model_providers.*] 的 name / base_url / wire_api / env_key。
 * 解析失败或无可保留内容时原样返回（保存不因此报错）。
 */
export function cleanCodexToml(text: string): string {
  const KEEP_SCALARS = ['model', 'model_provider', 'model_reasoning_effort'] as const;
  const KEEP_PROVIDER_KEYS = ['name', 'base_url', 'wire_api', 'env_key'] as const;

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text.trim()) as Record<string, unknown>;
  } catch {
    return text;
  }

  const out: Record<string, unknown> = {};
  for (const key of KEEP_SCALARS) {
    if (typeof parsed[key] === 'string') out[key] = parsed[key];
  }
  const providers = parsed.model_providers;
  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    const cleaned: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(providers as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const keep: Record<string, unknown> = {};
      for (const k of KEEP_PROVIDER_KEYS) {
        if (typeof (entry as Record<string, unknown>)[k] === 'string') {
          keep[k] = (entry as Record<string, unknown>)[k];
        }
      }
      if (Object.keys(keep).length > 0) cleaned[name] = keep;
    }
    if (Object.keys(cleaned).length > 0) out.model_providers = cleaned;
  }

  if (Object.keys(out).length === 0) return text;
  return stringifyToml(out);
}

function parseJsonObject(obj: Record<string, unknown>): ParsedProviderConfig {
  // ① Claude：settings.json 的 env（或扁平 env）。须存在任意 ANTHROPIC_* 键，
  //    否则通用字段 JSON 的顶层 model 会被误判为 Claude 配置。
  const env = asRecord(obj.env) ?? obj;
  const hasAnthropicKey = [
    env.ANTHROPIC_BASE_URL,
    env.ANTHROPIC_AUTH_TOKEN,
    env.ANTHROPIC_API_KEY,
    env.ANTHROPIC_MODEL,
    env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  ].some((v) => asString(v));
  if (hasAnthropicKey) {
    return {
      source: 'claude-settings',
      apiFormat: 'anthropic',
      baseUrl: asString(env.ANTHROPIC_BASE_URL),
      // cc-switch 区分 apiKeyField：AUTH_TOKEN 优先，退回 API_KEY
      apiKey: asString(env.ANTHROPIC_AUTH_TOKEN) ?? asString(env.ANTHROPIC_API_KEY),
      // 模型字段优先级：env 显式模型 > 顶层 model > 三档默认模型
      model:
        asString(env.ANTHROPIC_MODEL) ??
        asString(obj.model) ??
        asString(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ??
        asString(env.ANTHROPIC_DEFAULT_OPUS_MODEL) ??
        asString(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    };
  }

  // ② OpenAI / Codex auth.json：API Key 模式或 ChatGPT OAuth 登录模式
  const auth = asRecord(obj.auth) ?? obj;
  const openaiKey = asString(auth.OPENAI_API_KEY);
  if (openaiKey) {
    return { source: 'codex-auth', apiFormat: 'openai_chat', apiKey: openaiKey };
  }
  const tokens = asRecord((asRecord(auth.tokens) ?? asRecord(obj.tokens)) ?? null);
  const accessToken = asString(tokens?.access_token);
  if (accessToken) {
    // auth_mode=chatgpt：OAuth token 只被 chatgpt.com 的 Codex 后端接受
    // （签发对象是 Codex 应用，在 api.openai.com 上直接 401），需带账号 ID 头
    return {
      source: 'codex-auth',
      apiFormat: 'openai_responses',
      apiKey: accessToken,
      accountId: asString(tokens?.account_id),
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    };
  }

  // ③ 通用字段
  const generic = {
    baseUrl: asString(obj.baseUrl) ?? asString(obj.baseURL),
    apiKey: asString(obj.apiKey) ?? asString(obj.api_key),
    model: asString(obj.model),
    apiFormat:
      obj.apiFormat === 'anthropic' || obj.apiFormat === 'openai_chat'
        ? (obj.apiFormat as ApiFormat)
        : undefined,
  };
  if (generic.baseUrl || generic.apiKey || generic.model) {
    return { source: 'generic-fields', ...generic };
  }

  return { source: 'unknown' };
}

/** Codex config.toml：顶层 model + model_provider 指向（或第一个）model_providers 条目的 base_url；
 *  wire_api = "responses" 的端点映射 Responses 协议 */
function parseCodexToml(toml: Record<string, unknown>): ParsedProviderConfig | null {
  const model = asString(toml.model);
  let baseUrl: string | undefined;
  let wireApi: string | undefined;
  const providers = asRecord(toml.model_providers);
  if (providers) {
    const activeKey = asString(toml.model_provider);
    const entry =
      (activeKey ? asRecord(providers[activeKey]) : null) ??
      asRecord(Object.values(providers)[0]);
    baseUrl = asString(entry?.base_url);
    wireApi = asString(entry?.wire_api);
  }
  if (!model && !baseUrl) return null;
  return {
    source: 'codex-toml',
    // 官方端点（无 model_providers）不指定协议，让 auth.json 一侧的决定（如 OAuth → responses）生效
    apiFormat: providers ? (wireApi === 'responses' ? 'openai_responses' : 'openai_chat') : undefined,
    model,
    baseUrl,
  };
}
