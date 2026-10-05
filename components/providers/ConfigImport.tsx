import { ChevronDown, ChevronRight, FileUp, WandSparkles } from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { parseAndMergeTexts, type ProviderDraft } from '@/lib/importConfig';
import type { ProviderPreset } from '@/types';

type HintKey = NonNullable<ProviderPreset['importHint']>;

const HINT_TITLE: Record<HintKey, string> = {
  'claude-settings': '从 Claude Code settings.json 导入',
  codex: '从 Codex auth.json + config.toml 导入',
  'opencode-json': '从 OpenCode opencode.json 导入',
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
      if (errors.length > 0) setStatus({ ok: false, msg: errors[0] ?? '配置未识别' });
      return;
    }
    onApply(draft);
    const filled = [
      draft.baseUrl && 'Base URL',
      draft.apiKey && (draft.accountId ? 'API Key（ChatGPT OAuth）' : 'API Key'),
      draft.model && '模型',
      draft.apiFormat && '协议',
      draft.contextLimit && '上下文上限',
    ]
      .filter(Boolean)
      .join('、');
    setStatus({
      ok: errors.length === 0,
      msg: `已识别 ${labels.join(' + ')}，填入：${filled || '（无新字段）'}${errors.length ? `；${errors.join('；')}` : ''}`,
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
      setStatus({ ok: false, msg: `读取文件失败：${(err as Error).message}` });
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
        {hint ? HINT_TITLE[hint] : '从配置文件导入'}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t px-3 py-2.5">
          {slots.map((slot) => (
            <div key={slot.key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                {slot.label && (
                  <span className="text-xs font-medium text-foreground">{slot.label}</span>
                )}
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <FileUp className="size-3.5" />
                  选择文件…
                  <input
                    type="file"
                    accept={slot.accept}
                    className="hidden"
                    onChange={(e) => void handleFile(slot.key, e)}
                  />
                </label>
              </div>
              <Textarea
                value={texts[slot.key] ?? ''}
                onChange={(e) => onTextsChange({ ...texts, [slot.key]: e.target.value })}
                onBlur={() => applyMerged()}
                placeholder={slot.placeholder}
                rows={slot.key === 'toml' ? 6 : 4}
                className="font-mono text-[11px]"
                spellCheck={false}
              />
            </div>
          ))}

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
