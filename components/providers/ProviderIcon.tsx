import anthropic from '@/assets/brand/anthropic.svg';
import deepseek from '@/assets/brand/deepseek.svg';
import gemini from '@/assets/brand/gemini.svg';
import kimi from '@/assets/brand/kimi.svg';
import ollama from '@/assets/brand/ollama.svg';
import openai from '@/assets/brand/openai.svg';
import qwen from '@/assets/brand/qwen.svg';
import zhipu from '@/assets/brand/zhipu.svg';
import { cn } from '@/lib/utils';

/**
 * 品牌图标（SVG 取自 cc-switch 的图标库），按 icon 标识渲染；
 * 未命中（自定义供应商）退回首字母着色方块。
 */
const BRAND_ICONS: Record<string, string> = {
  anthropic,
  claude: anthropic,
  openai,
  gemini,
  deepseek,
  kimi,
  qwen,
  zhipu,
  ollama,
};

const FALLBACK_LABELS: Record<string, string> = {
  custom: '?',
};

export function ProviderIcon({
  icon,
  iconColor,
  className,
}: {
  icon?: string;
  iconColor?: string;
  className?: string;
}) {
  const src = icon ? BRAND_ICONS[icon] : undefined;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={cn('size-8 shrink-0 rounded-md object-contain', className)}
      />
    );
  }
  // 自定义/未知图标：着色方块 + 短标识
  const label =
    FALLBACK_LABELS[icon ?? 'custom'] ?? (icon?.slice(0, 2).toUpperCase() || '?');
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
