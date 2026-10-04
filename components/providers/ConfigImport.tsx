import { ChevronDown, ChevronRight, FileUp, WandSparkles } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  parseAndMergeTexts,
  type ProviderDraft,
} from '@/lib/importConfig';
import type { ProviderPreset } from '@/types';

type HintKey = NonNullable<ProviderPreset['importHint']>;

const HINT_TITLE: Record<HintKey, string> = {
  'claude-settings': '从 Claude settings.json 导入',
  codex: '从 OpenAI auth.json + config.toml 导入',
  'gemini-env': '从 Gemini env 配置导入',
  'grok-toml': '从 Grok config.toml 导入',
};

interface Slot {
  key: string;
  label: string;
  placeholder: string;
  accept: string;
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
      },
      {
        key: 'toml',
        label: 'config.toml',
        placeholder: 'model = "gpt-5.5"\nmodel_provider = "custom"\n\n[model_providers.custom]\nbase_url = "https://…"',
        accept: '.toml,text/plain',
      },
    ];
  }
  const placeholder: Record<Exclude<HintKey, 'codex'>, string> = {
    'claude-settings':
      '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://…",\n    "ANTHROPIC_AUTH_TOKEN": "sk-…",\n    "ANTHROPIC_MODEL": "claude-sonnet-5"\n  }\n}',
    'gemini-env':
      '{\n  "env": {\n    "GEMINI_API_KEY": "AIza…",\n    "GOOGLE_GEMINI_BASE_URL": "",\n    "GEMINI_MODEL": "gemini-2.5-flash"\n  }\n}',
    'grok-toml':
      '[models]\ndefault = "grok-4.6"\n\n[model."grok-4.6"]\nmodel = "grok-4.6"\nbase_url = "https://…"\napi_backend = "responses"\ncontext_window = 500000\napi_key = "sk-…"',
  };
  const key: Exclude<HintKey, 'codex'> = hint ?? 'claude-settings';
  return [
    {
      key: 'main',
      label: '',
      placeholder: placeholder[key],
      accept: key === 'grok-toml' ? '.toml,.json,text/plain' : '.json,application/json',
    },
  ];
}

/**
 * 配置文件导入区：粘贴或选择文件，解析后回填表单字段。
 * OpenAI 类型提供 auth.json / config.toml 两个输入框，一次合并填充。
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
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const slots = slotsFor(hint);

  /** 解析所有非空框并合并应用；部分失败时仍应用成功部分并提示失败原因 */
  function applyMerged() {
    const { draft, labels, errors } = parseAndMergeTexts(
      slots.map((s) => ({ key: s.key, label: s.label, text: texts[s.key] ?? '' })),
    );
    if (labels.length === 0) {
      setStatus({ ok: false, msg: errors[0] ?? '请先粘贴或选择文件' });
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
      onTextsChange({ ...texts, [slotKey]: raw });
    } catch (err) {
      setStatus({ ok: false, msg: `读取文件失败：${(err as Error).message}` });
    }
    e.target.value = '';
  }

  const hasAnyText = slots.some((s) => (texts[s.key] ?? '').trim());

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
                placeholder={slot.placeholder}
                rows={slot.key === 'toml' ? 6 : 4}
                className="font-mono text-[11px]"
                spellCheck={false}
              />
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="xs" disabled={!hasAnyText} onClick={applyMerged}>
              解析并填充
            </Button>
            {status && (
              <span className={status.ok ? 'text-[11px] text-primary' : 'text-[11px] text-destructive'}>
                {status.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
