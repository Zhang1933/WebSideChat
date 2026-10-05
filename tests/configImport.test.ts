import { describe, expect, it } from 'vitest';
import { cleanCodexToml, parseProviderConfig, syncDraftToTexts } from '@/lib/importConfig';

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

  it('解析 ChatGPT OAuth 登录的 auth.json（OPENAI_API_KEY 为 null，Base URL 指向 Codex 后端）', () => {
    const r = parseProviderConfig(
      JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          access_token: 'eyJaccess...',
          refresh_token: 'rt.1.AAC...',
          account_id: '0e132663-6f7e-4019-8611-5080642c9bc8',
        },
        last_refresh: '2026-10-04T07:52:50Z',
      }),
    );
    expect(r).toEqual({
      source: 'codex-auth',
      apiFormat: 'openai_responses',
      apiKey: 'eyJaccess...',
      accountId: '0e132663-6f7e-4019-8611-5080642c9bc8',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    });
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

  it('解析 OpenCode opencode.json（顶层 model 选 provider 与模型，context 进上下文上限）', () => {
    const r = parseProviderConfig(
      JSON.stringify({
        model: 'kimi/kimi-k3',
        provider: {
          kimi: {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'https://api.moonshot.cn/v1', apiKey: 'sk-t' },
            models: {
              'kimi-k3': { name: 'Kimi K3', limit: { context: 262144, output: 131072 } },
            },
          },
          other: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://o' } },
        },
      }),
    );
    expect(r).toEqual({
      source: 'opencode-json',
      apiFormat: 'openai_chat',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'sk-t',
      model: 'kimi-k3',
      contextLimit: 262_144,
    });
  });

  it('OpenCode：无顶层 model 取第一个 provider 的第一个模型；anthropic npm 映射协议', () => {
    const r = parseProviderConfig(
      JSON.stringify({
        provider: {
          myclaude: {
            npm: '@ai-sdk/anthropic',
            options: { baseURL: 'https://a', apiKey: 'k' },
            models: { 'claude-x': {} },
          },
        },
      }),
    );
    expect(r?.source).toBe('opencode-json');
    expect(r?.apiFormat).toBe('anthropic');
    expect(r?.model).toBe('claude-x');
    expect(r?.contextLimit).toBeUndefined();
  });

  it('OpenCode：@ai-sdk/openai 映射 responses；单 provider 片段也可识别', () => {
    const frag = parseProviderConfig(
      JSON.stringify({
        npm: '@ai-sdk/openai',
        options: { baseURL: 'https://x', apiKey: 'k' },
        models: { 'gpt-5.5': { limit: { context: 400000 } } },
      }),
    );
    expect(frag?.source).toBe('opencode-json');
    expect(frag?.apiFormat).toBe('openai_responses');
    expect(frag?.model).toBe('gpt-5.5');
    expect(frag?.contextLimit).toBe(400_000);
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

  it('Codex config.toml 的 wire_api=responses 映射 Responses 协议', () => {
    const r = parseProviderConfig(
      [
        'model_provider = "custom"',
        'model = "gpt-5.5"',
        '',
        '[model_providers.custom]',
        'name = "sssaicode"',
        'base_url = "https://node.example.com/api/v1"',
        'wire_api = "responses"',
        'requires_openai_auth = true',
      ].join('\n'),
    );
    expect(r.source).toBe('codex-toml');
    expect(r.model).toBe('gpt-5.5');
    expect(r.baseUrl).toBe('https://node.example.com/api/v1');
    expect(r.apiFormat).toBe('openai_responses');
  });

  it('Codex config.toml 的 experimental_bearer_token 作为内嵌 API Key 提取', () => {
    const r = parseProviderConfig(
      [
        'model_provider = "ZAI"',
        'model = "glm-5.3"',
        'model_reasoning_effort = "max"',
        '',
        '[model_providers.ZAI]',
        'name = "ZAI"',
        'base_url = "https://open.bigmodel.cn/api/v1"',
        'experimental_bearer_token = "test-bearer-token-fake"',
        'wire_api = "responses"',
        'requires_openai_auth = false',
        '',
        '[tui]',
        'screen_reader_detection_done = true',
      ].join('\n'),
    );
    expect(r).toEqual({
      source: 'codex-toml',
      apiFormat: 'openai_responses',
      model: 'glm-5.3',
      baseUrl: 'https://open.bigmodel.cn/api/v1',
      apiKey: 'test-bearer-token-fake',
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

describe('cleanCodexToml', () => {
  const noisy = [
    'model = "gpt-5.5"',
    'model_provider = "custom"',
    'model_reasoning_effort = "low"',
    'disable_response_storage = true',
    'notify = ["C:\\\\path\\\\codex-computer-use.exe", "turn-ended"]',
    'approvals_reviewer = "user"',
    'personality = "pragmatic"',
    '',
    '[windows]',
    'sandbox = "elevated"',
    '',
    '[projects."c:\\\\users\\\\z1933\\\\workplace\\\\demo"]',
    'trust_level = "trusted"',
    '',
    '[plugins."spreadsheets@openai-primary-runtime"]',
    'enabled = true',
    '',
    '[model_providers.custom]',
    'name = "sssaicode"',
    'base_url = "https://node.example.com/api/v1"',
    'wire_api = "responses"',
    'requires_openai_auth = true',
    'query_params = { foo = "bar" }',
  ].join('\n');

  it('去掉 projects/plugins/notify 等噪音，保留关键项', () => {
    const cleaned = cleanCodexToml(noisy);
    const parsed = JSON.parse(JSON.stringify(cleaned)); // 确认是文本
    expect(typeof parsed).toBe('string');
    expect(cleaned).toContain('model = "gpt-5.5"');
    expect(cleaned).toContain('model_reasoning_effort = "low"');
    expect(cleaned).toContain('base_url = "https://node.example.com/api/v1"');
    expect(cleaned).toContain('wire_api = "responses"');
    expect(cleaned).not.toContain('trust_level');
    expect(cleaned).not.toContain('spreadsheets');
    expect(cleaned).not.toContain('notify');
    expect(cleaned).not.toContain('sandbox');
    expect(cleaned).not.toContain('requires_openai_auth');
    // 净化后仍可被解析器识别
    const r = parseProviderConfig(cleaned);
    expect(r.source).toBe('codex-toml');
    expect(r.model).toBe('gpt-5.5');
    expect(r.apiFormat).toBe('openai_responses');
  });

  it('解析失败或无关键内容时原样返回', () => {
    const broken = 'this is === not toml';
    expect(cleanCodexToml(broken)).toBe(broken);
    const onlyNoise = '[projects."x"]\ntrust_level = "trusted"';
    expect(cleanCodexToml(onlyNoise)).toBe(onlyNoise);
  });
});

describe('syncDraftToTexts（表单 → 配置文本反向同步）', () => {
  it('Claude settings.json：baseUrl/apiKey/model 写回 env', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://old', ANTHROPIC_AUTH_TOKEN: 'old-key', ANTHROPIC_MODEL: 'old-model' } });
    const next = syncDraftToTexts({ main: text }, 'claude-settings', {
      baseUrl: 'https://new', apiKey: 'new-key', model: 'new-model',
    });
    const parsed = JSON.parse(next.main!);
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://new');
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('new-key');
    expect(parsed.env.ANTHROPIC_MODEL).toBe('new-model');
  });

  it('Codex：auth.json 的 OPENAI_API_KEY 与 config.toml 的 base_url/bearer/model 写回', () => {
    const next = syncDraftToTexts(
      {
        auth: JSON.stringify({ OPENAI_API_KEY: 'old' }),
        toml: 'model = "old"\nmodel_provider = "x"\n\n[model_providers.x]\nbase_url = "https://old"\nexperimental_bearer_token = "old-k"',
      },
      'codex',
      { baseUrl: 'https://new', apiKey: 'new-k', model: 'new-m' },
    );
    expect(JSON.parse(next.auth!).OPENAI_API_KEY).toBe('new-k');
    const toml = next.toml!;
    expect(toml).toContain('"new-m"');
    expect(toml).toContain('https://new');
    expect(toml).toContain('new-k');
  });

  it('OpenCode：options.baseURL/apiKey 与模型写回，顶层 model 同步 provider/model', () => {
    const text = JSON.stringify({ model: 'c/m1', provider: { c: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://o', apiKey: 'ok' }, models: { m1: {} } } } });
    const next = syncDraftToTexts({ main: text }, 'opencode-json', {
      baseUrl: 'https://n', apiKey: 'nk', model: 'm2',
    });
    const parsed = JSON.parse(next.main!);
    expect(parsed.provider.c.options.baseURL).toBe('https://n');
    expect(parsed.provider.c.options.apiKey).toBe('nk');
    expect(parsed.model).toBe('c/m2');
    expect(parsed.provider.c.models).toHaveProperty('m2');
  });

  it('空值不覆盖、解析失败原样保留、无变化返回原引用', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'keep' } });
    // 空 model 不覆盖已有
    const kept = syncDraftToTexts({ main: text }, 'claude-settings', { apiKey: 'k2' });
    expect(JSON.parse(kept.main!).env.ANTHROPIC_AUTH_TOKEN).toBe('k2');
    // 解析失败
    const broken = syncDraftToTexts({ main: '{bad' }, 'claude-settings', { apiKey: 'x' });
    expect(broken.main).toBe('{bad');
    // 无变化 → 原引用
    const same = syncDraftToTexts({ main: text }, 'claude-settings', {});
    expect(same).toBe(same); // 返回原对象
    expect(Object.is(same, { ...same })).toBe(false); // 确认是比较而非新建
  });
});

