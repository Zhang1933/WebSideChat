import { describe, expect, it } from 'vitest';
import { parseProviderConfig } from '@/lib/importConfig';

describe('parseProviderConfig', () => {
  it('解析 ~/.claude/settings.json（env 包装格式）', () => {
    const r = parseProviderConfig(
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'sk-test',
          ANTHROPIC_MODEL: 'kimi-k2-turbo-preview',
        },
      }),
    );
    expect(r).toEqual({
      source: 'claude-settings',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'sk-test',
      model: 'kimi-k2-turbo-preview',
    });
  });

  it('解析扁平 env（无外层包装）', () => {
    const r = parseProviderConfig(
      JSON.stringify({ ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: 'k' }),
    );
    expect(r.source).toBe('claude-settings');
    expect(r.baseUrl).toBe('https://x');
  });

  it('AUTH_TOKEN 缺失时退回 ANTHROPIC_API_KEY', () => {
    const r = parseProviderConfig(
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_API_KEY: 'sk-ak' } }),
    );
    expect(r.apiKey).toBe('sk-ak');
  });

  it('ANTHROPIC_MODEL 缺失时退回 SONNET 默认模型', () => {
    const r = parseProviderConfig(
      JSON.stringify({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' } }),
    );
    expect(r.model).toBe('claude-sonnet-5');
  });

  it('模型链回退到 OPUS 默认模型与顶层 model 字段（含 [1m] 后缀保留）', () => {
    // 顶层 model 优先于 DEFAULT_OPUS_MODEL
    const r = parseProviderConfig(
      JSON.stringify({
        env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3[1m]' },
        model: 'glm-5.3-air[1m]',
      }),
    );
    expect(r.source).toBe('claude-settings');
    expect(r.model).toBe('glm-5.3-air[1m]');

    // 无顶层 model 时取 DEFAULT_OPUS_MODEL
    const r2 = parseProviderConfig(
      JSON.stringify({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3[1m]' } }),
    );
    expect(r2.model).toBe('glm-5.3[1m]');
  });

  it('settings.json 混入无关字段（permissions 等）不受影响', () => {
    const r = parseProviderConfig(
      JSON.stringify({
        permissions: { allow: ['Bash'] },
        env: { ANTHROPIC_BASE_URL: 'https://y', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_MODEL: 'm' },
      }),
    );
    expect(r.source).toBe('claude-settings');
    expect(r.baseUrl).toBe('https://y');
  });

  it('解析 ~/.codex/auth.json（裸 OPENAI_API_KEY）', () => {
    const r = parseProviderConfig(JSON.stringify({ OPENAI_API_KEY: 'sk-oai' }));
    expect(r).toEqual({ source: 'codex-auth', apiFormat: 'openai_chat', apiKey: 'sk-oai' });
  });

  it('解析 cc-switch Codex settingsConfig（auth 包装）', () => {
    const r = parseProviderConfig(
      JSON.stringify({ auth: { OPENAI_API_KEY: 'sk-oai' }, config: 'model = "gpt-5.1"' }),
    );
    expect(r.source).toBe('codex-auth');
    expect(r.apiKey).toBe('sk-oai');
    expect(r.apiFormat).toBe('openai_chat');
  });

  it('解析通用字段 JSON（含 apiFormat 与下划线变体）', () => {
    const r = parseProviderConfig(
      JSON.stringify({ baseURL: 'https://b', api_key: 'sk-x', model: 'm1', apiFormat: 'anthropic' }),
    );
    expect(r).toEqual({
      source: 'generic-fields',
      baseUrl: 'https://b',
      apiKey: 'sk-x',
      model: 'm1',
      apiFormat: 'anthropic',
    });
  });

  it('解析 Gemini env 配置（env 包装）', () => {
    const r = parseProviderConfig(
      JSON.stringify({
        env: {
          GEMINI_API_KEY: 'AIza-xxx',
          GOOGLE_GEMINI_BASE_URL: '',
          GEMINI_MODEL: 'gemini-2.5-flash',
        },
      }),
    );
    expect(r.source).toBe('gemini-env');
    expect(r.apiKey).toBe('AIza-xxx');
    expect(r.model).toBe('gemini-2.5-flash');
    // GOOGLE_GEMINI_BASE_URL 为空字符串 → 不覆盖表单预设
    expect(r.baseUrl).toBeUndefined();
  });

  it('解析 Gemini 扁平 env（GOOGLE_API_KEY 变体）', () => {
    const r = parseProviderConfig(JSON.stringify({ GOOGLE_API_KEY: 'k' }));
    expect(r.source).toBe('gemini-env');
    expect(r.apiKey).toBe('k');
  });

  it('解析 Codex config.toml：model_provider 指向的 base_url', () => {
    const r = parseProviderConfig(
      'model = "gpt-5.1"\nmodel_provider = "custom"\n\n[model_providers.custom]\nname = "MyProxy"\nbase_url = "https://proxy.example.com/v1"\nwire_api = "chat"\n',
    );
    expect(r).toEqual({
      source: 'codex-toml',
      apiFormat: 'openai_chat',
      model: 'gpt-5.1',
      baseUrl: 'https://proxy.example.com/v1',
    });
  });

  it('config.toml 无 model_provider 时取第一个 provider 的 base_url', () => {
    const r = parseProviderConfig(
      '[model_providers.p1]\nbase_url = "https://a.com"\n\n[model_providers.p2]\nbase_url = "https://b.com"\n',
    );
    expect(r.source).toBe('codex-toml');
    expect(r.baseUrl).toBe('https://a.com');
  });

  it('无关 JSON 返回 unknown', () => {
    expect(parseProviderConfig('{"foo": 1}').source).toBe('unknown');
    expect(parseProviderConfig('[1,2]').source).toBe('unknown');
  });

  it('非法 JSON 抛错', () => {
    expect(() => parseProviderConfig('{oops')).toThrow();
    expect(() => parseProviderConfig('')).toThrow();
  });
});
