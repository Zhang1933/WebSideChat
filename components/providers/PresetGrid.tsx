import { FileJson, FileTerminal } from 'lucide-react';
import { CONFIG_TYPE_PRESETS } from '@/config/presets';
import { useT } from '@/lib/i18n';
import type { ProviderPreset } from '@/types';
import { ProviderIcon } from './ProviderIcon';

const TYPE_SUBTITLE_KEY: Record<string, string> = {
  'claude-settings': 'preset.sub.claude-settings',
  codex: 'preset.sub.codex',
  'opencode-json': 'preset.sub.opencode-json',
};

/** 新增供应商第一步：选择配置类型（对齐 cc-switch），按类型提供配置文件导入 */
export function PresetGrid({ onSelect }: { onSelect: (preset: ProviderPreset) => void }) {
  const t = useT();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold text-muted-foreground">{t('preset.title')}</h2>
      <div className="grid gap-2">
        {CONFIG_TYPE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset)}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <ProviderIcon icon={preset.icon} iconColor={preset.iconColor} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{preset.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {preset.baseUrl || t('preset.anyEndpoint')}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {preset.importHint === 'codex' ? (
                <FileTerminal className="size-3" />
              ) : (
                <FileJson className="size-3" />
              )}
              {t(TYPE_SUBTITLE_KEY[preset.importHint ?? ''] ?? '')}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
