import { ExternalLink } from 'lucide-react';
import { PROVIDER_PRESETS } from '@/config/presets';
import type { ProviderPreset } from '@/types';
import { ProviderIcon } from './ProviderIcon';

/** 新增供应商第一步：预设网格（对齐 cc-switch 的 AddProviderDialog 两步式） */
export function PresetGrid({ onSelect }: { onSelect: (preset: ProviderPreset) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PROVIDER_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onSelect(preset)}
          className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
        >
          <div className="flex items-center gap-2">
            <ProviderIcon icon={preset.icon} iconColor={preset.iconColor} />
            <span className="text-sm font-medium leading-tight">{preset.name}</span>
          </div>
          <p className="line-clamp-1 text-[11px] text-muted-foreground">
            {preset.baseUrl || '填写任意 OpenAI/Anthropic 兼容端点'}
          </p>
          {preset.apiKeyUrl && (
            <a
              href={preset.apiKeyUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              获取 API Key <ExternalLink className="size-3" />
            </a>
          )}
        </button>
      ))}
    </div>
  );
}
