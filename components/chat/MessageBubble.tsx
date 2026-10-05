import { Check, Copy, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types';

/**
 * 单条消息：用户右对齐气泡，助手左对齐 Markdown；muted 用于压缩纪要等元消息。
 * hover 出现操作行：复制（所有消息）；编辑（仅传入 onEdit 的最后一条用户消息，
 * 参考 Gemini：点击把内容放回输入框，重新发送后截断后续对话）。
 */
export function MessageBubble({
  message,
  muted,
  onEdit,
  isVideoPage = false,
}: {
  message: ChatMessage;
  muted?: boolean;
  /** 传入时显示编辑按钮（点击回调由父组件处理） */
  onEdit?: () => void;
  /** 当前是否在视频页（透传给 Markdown 做时间戳链接 seek） */
  isVideoPage?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isUser = message.role === 'user';

  return (
    <div className={cn('group flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
      {isUser ? (
        <div className="max-w-[85%] rounded-lg bg-secondary px-2.5 py-1.5 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      ) : (
        <div
          className={cn(
            'max-w-full rounded-lg px-2.5 py-1.5',
            muted ? 'border border-dashed text-[13px] text-muted-foreground' : 'border',
          )}
        >
          <Markdown text={message.content} isVideoPage={isVideoPage} />
        </div>
      )}

      <div
        className={cn(
          'flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100',
          isUser && 'flex-row-reverse',
        )}
      >
        {onEdit && (
          <button
            type="button"
            title="编辑并重新发送"
            onClick={onEdit}
            className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-3" />
          </button>
        )}
        <button
          type="button"
          title="复制"
          onClick={() => void copy()}
          className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}
