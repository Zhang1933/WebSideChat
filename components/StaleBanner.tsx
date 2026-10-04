import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STALE_MS = 5 * 60 * 1000;

/** 提取时间过久的提示条：内容可能已更新，一键重新提取（重置会话） */
export function StaleBanner({
  extractedAt,
  onReextract,
}: {
  extractedAt: number;
  onReextract: () => void;
}) {
  const minutes = Math.round((Date.now() - extractedAt) / 60000);
  if (minutes < 5) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="flex-1">
        内容提取于 {minutes >= 60 ? `${Math.round(minutes / 60)} 小时` : `${minutes} 分钟`}前，页面可能已更新
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="h-6 shrink-0"
        onClick={onReextract}
      >
        <RotateCcw className="size-3" /> 重新提取
      </Button>
    </div>
  );
}
