import { ChevronDown, ChevronRight, FileUp, WandSparkles } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  CONFIG_SOURCE_LABELS,
  parseProviderConfig,
  type ProviderDraft,
} from '@/lib/importConfig';
import type { ProviderPreset } from '@/types';

type HintKey = NonNullable<ProviderPreset['importHint']>;

const HINT_TITLE: Record<HintKey, string> = {
  'claude-settings': '从 Claude settings.json 导入',
  codex: '从 OpenAI auth.json / config.toml 导入',
  'gemini-env': '从 Gemini env 配置导入',
};

const HINT_PLACEHOLDER: Record<HintKey, string> = {
  'claude-settings':
    '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://…",\n    "ANTHROPIC_AUTH_TOKEN": "sk-…",\n    "ANTHROPIC_MODEL": "claude-sonnet-5"\n  }\n}',
  codex: '{ "OPENAI_API_KEY": "sk-…" }\n\n或粘贴 config.toml：\nmodel = "gpt-5.1"\n[model_providers.custom]\nbase_url = "https://…"',
  'gemini-env':
    '{\n  "env": {\n    "GEMINI_API_KEY": "AIza…",\n    "GOOGLE_GEMINI_BASE_URL": "",\n    "GEMINI_MODEL": "gemini-2.5-flash"\n  }\n}',
};

/**
 * 配置文件导入区：粘贴或选择文件（settings.json / auth.json / config.toml / env JSON），
 * 解析后回填表单字段。默认展开，点标题栏可收起。
 */
export function ConfigImport({
  hint,
  onApply,
}: {
  /** 配置类型（来自第一步的 Claude/OpenAI/Gemini 选择），决定导入区文案 */
  hint: ProviderPreset['importHint'];
  onApply: (draft: ProviderDraft) => void;
}) {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  function apply(raw: string) {
    try {
      const parsed = parseProviderConfig(raw);
      if (parsed.source === 'unknown') {
        setStatus({
          ok: false,
          msg: '未识别出可导入字段，支持：settings.json / auth.json / config.toml / Gemini env / 通用字段 JSON',
        });
        return;
      }
      onApply(parsed);
      const filled = [
        parsed.baseUrl && 'Base URL',
        parsed.apiKey && 'API Key',
        parsed.model && '模型',
        parsed.apiFormat && '协议',
      ]
        .filter(Boolean)
        .join('、');
      setStatus({
        ok: true,
        msg: `已识别${CONFIG_SOURCE_LABELS[parsed.source]}，填入：${filled || '（无新字段）'}`,
      });
    } catch (err) {
      setStatus({ ok: false, msg: `解析失败：${(err as Error).message}` });
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      setText(raw);
      apply(raw);
    } catch (err) {
      setStatus({ ok: false, msg: `读取文件失败：${(err as Error).message}` });
    }
    e.target.value = '';
  }

  const title = hint ? HINT_TITLE[hint] : '从配置文件导入';
  const placeholder = hint ? HINT_PLACEHOLDER[hint] : HINT_PLACEHOLDER['claude-settings'];

  return (
    <div className="rounded-lg border border-dashed">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <WandSparkles className="size-3.5" />
        {title}
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t px-3 py-2.5">
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <FileUp className="size-3.5" />
              选择文件…
              <input
                type="file"
                accept={hint === 'codex' ? '.json,.toml,application/json,text/plain' : '.json,application/json'}
                className="hidden"
                onChange={handleFile}
              />
            </label>
            <span className="text-[11px] text-muted-foreground/70">或直接粘贴：</span>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            rows={hint === 'codex' ? 7 : 5}
            className="font-mono text-[11px]"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="xs" disabled={!text.trim()} onClick={() => apply(text)}>
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
