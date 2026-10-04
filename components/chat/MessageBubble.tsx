import { cn } from '@/lib/utils';
import { Markdown } from '@/components/Markdown';
import type { ChatMessage } from '@/types';

/** 单条消息：用户右对齐气泡，助手左对齐 Markdown */
export function MessageBubble({ message }: { message: ChatMessage }) {
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
      <div className="max-w-full rounded-lg border px-2.5 py-1.5">
        <Markdown text={message.content} />
      </div>
    </div>
  );
}
