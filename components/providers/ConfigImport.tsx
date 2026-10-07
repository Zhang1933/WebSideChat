import { ChevronDown, ChevronRight, FileUp, WandSparkles } from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { getUiLang, t, useT } from '@/lib/i18n';
import { parseAndMergeTexts, type ProviderDraft } from '@/lib/importConfig';
import type { ProviderPreset } from '@/types';

/** 按槽位类型校验文本语法，返回错误信息（null = 格式正确或为空） */
function validateSyntax(text: string, isToml: boolean): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isToml) {
    try {
      // smol-toml 不在组件里 import（避免包体积），只做轻量 TOML 语法检查：
      // 至少有一行 key = value 或 [section]，且不含明显非法行
      const lines = trimmed.split('\n');
      const hasContent = lines.some((l) => /^\s*(\[.+\]\s*$|[\w."'-]+\s*=)/.test(l));
      if (!hasContent) return t('import.notToml');
      return null;
    } catch {
      return t('import.tomlParseFail');
    }
  }
  try {
    JSON.parse(trimmed);
    return null;
  } catch (err) {
    const msg = (err as Error).message;
    // 提取行列号（V8 格式: "Unexpected token } in JSON at position 123"）
    const posMatch = msg.match(/position (\d+)/);
    if (posMatch) {
      const pos = Number(posMatch[1]);
      const before = trimmed.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      return t('import.jsonErrPos', line, col, msg.split(' at position')[0] ?? msg);
    }
    return t('import.jsonErr', msg);
  }
}

type HintKey = NonNullable<ProviderPreset['importHint']>;

const HINT_TITLE_KEY: Record<HintKey, string> = {
  'claude-settings': 'import.title.claude-settings',
  codex: 'import.title.codex',
  'opencode-json': 'import.title.opencode-json',
};

interface Slot {
  key: string;
  label: string;
  placeholder: string;
  accept: string;
  /** 预填模板（新增时可编辑的初值，替代占位符） */
  prefill?: string;
}

/** OpenAI 类型双框（auth.json + config.toml），其余类型单框 */
function slotsFor(hint: HintKey | undefined): Slot[] {
  if (hint === 'codex') {
    return [
      {
        key: 'auth',
        label: 'auth.json',
        placeholder: '{ "OPENAI_API_KEY": "sk-…" }',
        accept: '.json,application/json',
        prefill: '{\n  "OPENAI_API_KEY": ""\n}',
      },
      {
        key: 'toml',
        label: 'config.toml',
        placeholder: 'model = "gpt-5.5"\nmodel_provider = "custom"\n\n[model_providers.custom]\nbase_url = "https://…"',
        accept: '.toml,text/plain',
        prefill: [
          'model_provider = "custom"',
          'model = "gpt-5.6-sol"',
          '',
          '[model_providers.custom]',
          'name = "custom"',
          'wire_api = "responses"',
          'requires_openai_auth = true',
          'base_url = ""',
          'experimental_bearer_token = ""',
        ].join('\n'),
      },
    ];
  }
  const placeholder: Record<Exclude<HintKey, 'codex'>, string> = {
    'claude-settings':
      '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://…",\n    "ANTHROPIC_AUTH_TOKEN": "sk-…",\n    "ANTHROPIC_MODEL": "claude-sonnet-5"\n  }\n}',
    'opencode-json':
      '{\n  "model": "kimi/kimi-k3",\n  "provider": {\n    "kimi": {\n      "npm": "@ai-sdk/openai-compatible",\n      "options": { "baseURL": "https://…", "apiKey": "sk-…" },\n      "models": { "kimi-k3": { "limit": { "context": 262144 } } }\n    }\n  }\n}',
  };
  const key: Exclude<HintKey, 'codex'> = hint ?? 'claude-settings';
  return [
    {
      key: 'main',
      label: '',
      placeholder: placeholder[key],
      accept: '.json,application/json',
      prefill: PREFILL[key],
    },
  ];
}

/** 各类型（codex 之外）单框的可编辑预填模板 */
const PREFILL: Record<Exclude<HintKey, 'codex'>, string> = {
  'claude-settings': [
    '{',
    '  "env": {',
    '    "ANTHROPIC_BASE_URL": "",',
    '    "ANTHROPIC_AUTH_TOKEN": "",',
    '    "ANTHROPIC_MODEL": ""',
    '  }',
    '}',
  ].join('\n'),
  'opencode-json': [
    '{',
    '  "model": "custom/model-id",',
    '  "provider": {',
    '    "custom": {',
    '      "npm": "@ai-sdk/openai-compatible",',
    '      "options": { "baseURL": "", "apiKey": "" },',
    '      "models": { "model-id": {} }',
    '    }',
    '  }',
    '}',
  ].join('\n'),
};

/**
 * 配置文件导入区：粘贴/选择文件后，失焦即自动解析回填表单（无按钮）；
 * 表单字段变化时由父组件反向同步回输入框（双向同步）。
 * 文本状态由父组件持有（受控）：保存时父组件可对未解析的内容自动解析。
 */
export function ConfigImport({
  hint,
  texts,
  onTextsChange,
  onApply,
}: {
  /** 配置类型（来自第一步的配置类型选择），决定导入区文案与输入框数量 */
  hint: ProviderPreset['importHint'];
  /** 各输入框内容，键为槽位 key */
  texts: Record<string, string>;
  onTextsChange: (next: Record<string, string>) => void;
  onApply: (draft: ProviderDraft) => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [open, setOpen] = useState(true);
  const slots = slotsFor(hint);

  // 预填模板：新增（各框均空）时填入可编辑的初值，用户已有内容则不覆盖
  useEffect(() => {
    const hasAny = slots.some((s) => (texts[s.key] ?? '').trim());
    if (hasAny) return;
    const prefillMap = Object.fromEntries(
      slots.filter((s) => s.prefill).map((s) => [s.key, s.prefill!]),
    );
    if (Object.keys(prefillMap).length > 0) onTextsChange(prefillMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  /** 解析所有非空框并合并应用（失焦/选文件后自动触发）；部分失败时仍应用成功部分 */
  function applyMerged(source?: Record<string, string>) {
    const from = source ?? texts;
    const { draft, labels, errors } = parseAndMergeTexts(
      slots.map((s) => ({ key: s.key, label: s.label, text: from[s.key] ?? '' })),
    );
    if (labels.length === 0) {
      if (errors.length > 0) setStatus({ ok: false, msg: errors[0] ?? t('import.unrecognized') });
      return;
    }
    onApply(draft);
    // 中英文分隔符差异：顿号/分号 vs 逗号/分号+空格
    const sep = getUiLang() === 'zh' ? '、' : ', ';
    const esep = getUiLang() === 'zh' ? '；' : '; ';
    const filled = [
      draft.baseUrl && t('import.f.baseUrl'),
      draft.apiKey && (draft.accountId ? t('import.f.apiKeyOauth') : t('import.f.apiKey')),
      draft.model && t('import.f.model'),
      draft.apiFormat && t('import.f.apiFormat'),
      draft.contextLimit && t('import.f.context'),
    ]
      .filter(Boolean)
      .join(sep);
    setStatus({
      ok: errors.length === 0,
      msg: t(
        'import.applied',
        labels.join(' + '),
        filled || t('import.noNewFields'),
        errors.length ? esep + errors.join(esep) : '',
      ),
    });
  }

  async function handleFile(slotKey: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const next = { ...texts, [slotKey]: raw };
      onTextsChange(next);
      applyMerged(next); // 选文件后立即解析（不等失焦）
    } catch (err) {
      setStatus({ ok: false, msg: t('import.readFail', (err as Error).message) });
    }
    e.target.value = '';
  }

  return (
    <div className="rounded-lg border border-dashed">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <WandSparkles className="size-3.5" />
        {hint ? t(HINT_TITLE_KEY[hint]) : t('import.title.claude-settings')}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t px-3 py-2.5">
          {slots.map((slot) => {
            const isToml = slot.key === 'toml';
            const syntaxError = validateSyntax(texts[slot.key] ?? '', isToml);
            return (
              <div key={slot.key} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  {slot.label && (
                    <span className="text-xs font-medium text-foreground">{slot.label}</span>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <FileUp className="size-3.5" />
                    {t('import.pickFile')}
                    <input
                      type="file"
                      accept={slot.accept}
                      className="hidden"
                      onChange={(e) => void handleFile(slot.key, e)}
                    />
                  </label>
                </div>
                <div className="relative">
                  <Textarea
                    value={texts[slot.key] ?? ''}
                    onChange={(e) => onTextsChange({ ...texts, [slot.key]: e.target.value })}
                    onBlur={() => applyMerged()}
                    placeholder={slot.placeholder}
                    rows={slot.key === 'toml' ? 6 : 4}
                    className={`font-mono text-[11px] ${syntaxError ? 'syntax-error' : ''}`}
                    spellCheck={false}
                  />
                  {syntaxError && (
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 border-b-2 border-dashed border-destructive/60"
                      style={{ height: '3px' }}
                    />
                  )}
                </div>
                {syntaxError && (
                  <p className="flex items-center gap-1 text-[11px] text-destructive">
                    <span
                      className="inline-block h-[3px] w-4 rounded-full"
                      style={{ background: 'currentColor', textDecoration: 'wavy' }}
                    />
                    {syntaxError}
                  </p>
                )}
              </div>
            );
          })}

          {status && (
            <p className={status.ok ? 'text-[11px] text-primary' : 'text-[11px] text-destructive'}>
              {status.msg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
