import { ScrollText, Loader2, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/Markdown';
import type { Conversation } from '@/types';

/** 摘要卡：生成/重新生成按钮、流式 Markdown 渲染、停止 */
export function SummaryCard({
  conversation,
  hasSummary,
  streaming,
  streamText,
  disabled,
  onGenerate,
  onStop,
}: {
  conversation: Conversation | null;
  hasSummary: boolean;
  streaming: boolean;
  streamText: string;
  disabled: boolean;
  onGenerate: () => void;
  onStop: () => void;
}) {
  const summary =
    conversation?.messages.find((m) => m.role === 'assistant')?.content ?? null;

  return (
    <div className="border-b px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ScrollText className="size-3.5" /> 摘要
        </h2>
        {streaming ? (
          <Button variant="secondary" size="xs" onClick={onStop}>
            <Square className="size-3" /> 停止
          </Button>
        ) : (
          <Button size="xs" disabled={disabled} onClick={onGenerate}>
            {hasSummary ? (
              <>
                <Sparkles className="size-3" /> 重新生成
              </>
            ) : (
              <>
                <Sparkles className="size-3" /> 生成摘要
              </>
            )}
          </Button>
        )}
      </div>

      {streaming && (
        <div className="relative">
          <Markdown text={streamText || '生成中…'} />
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
          </span>
        </div>
      )}

      {!streaming && summary && <Markdown text={summary} />}
    </div>
  );
}
