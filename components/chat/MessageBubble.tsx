import { cn } from '@/lib/utils';
import { Markdown } from '@/components/Markdown';
import type { ChatMessage } from '@/types';

/** 单条消息：用户右对齐气泡，助手左对齐 Markdown；muted 用于压缩纪要等元消息 */
export function MessageBubble({ message, muted }: { message: ChatMessage; muted?: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-secondary px-2.5 py-1.5 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex justify-start')}>
      <div
        className={cn(
          'max-w-full rounded-lg px-2.5 py-1.5',
          muted
            ? 'border border-dashed text-[13px] text-muted-foreground'
            : 'border',
        )}
      >
        <Markdown text={message.content} />
      </div>
    </div>
  );
}
