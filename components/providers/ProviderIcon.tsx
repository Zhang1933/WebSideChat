import { cn } from '@/lib/utils';

const SHORT_LABELS: Record<string, string> = {
  deepseek: 'DS',
  kimi: 'K',
  qwen: '通',
  zhipu: '智',
  openai: 'AI',
  anthropic: 'Cl',
  ollama: 'Ol',
  custom: '?',
};

/**
 * 供应商图标：品牌色圆角方块 + 短标识。
 * 不内置品牌 SVG（避免体积与版权问题），视觉对齐 cc-switch 的"图标+着色"。
 */
export function ProviderIcon({
  icon,
  iconColor,
  className,
}: {
  icon?: string;
  iconColor?: string;
  className?: string;
}) {
  const label = SHORT_LABELS[icon ?? 'custom'] ?? (icon?.slice(0, 2).toUpperCase() || '?');
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white select-none',
        className,
      )}
      style={{ backgroundColor: iconColor || '#737373' }}
    >
      {label}
    </div>
  );
}
