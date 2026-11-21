import { Check, Copy, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { useT } from '@/lib/i18n';
import { cn, copyToClipboard } from '@/lib/utils';
import { expandTimestampLinks } from '@/lib/video/pages';
import { DEFAULT_CHAT_FONT_SIZE, type ChatMessage } from '@/types';

/**
 * 单条消息：用户右对齐气泡，助手左对齐 Markdown；muted 用于压缩纪要等元消息。
 * hover 出现操作行：复制（所有消息）；编辑（仅传入 onEdit 的最后一条用户消息，
 * 参考 Gemini：点击把内容放回输入框，重新发送后截断后续对话）。
 */
export function MessageBubble({
  message,
  muted,
  onEdit,
  videoUrl = null,
  fontSize = DEFAULT_CHAT_FONT_SIZE,
}: {
  message: ChatMessage;
  muted?: boolean;
  /** 传入时显示编辑按钮（点击回调由父组件处理） */
  onEdit?: () => void;
  /** 当前会话的视频页 URL（透传给 Markdown 做占位展开与 seek） */
  videoUrl?: string | null;
  /** 对话字体大小（px）：用户气泡与助手 Markdown 共用（顶栏放大/缩小按钮调整） */
  fontSize?: number;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    // 视频会话：复制时把 #t 占位展开为完整链接（存储为占位省 token，复制给别处要能用）
    const ok = await copyToClipboard(expandTimestampLinks(message.content, videoUrl));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const isUser = message.role === 'user';

  return (
    <div className={cn('group flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
      {isUser ? (
        <div
          className="max-w-[85%] rounded-lg bg-secondary px-2.5 py-1.5 whitespace-pre-wrap"
          style={{ fontSize, lineHeight: 1.5 }}
        >
          {message.content}
        </div>
      ) : (
        <div
          className={cn(
            'max-w-full rounded-lg px-2.5 py-1.5',
            muted ? 'border border-dashed text-muted-foreground' : 'border',
          )}
        >
          <Markdown text={message.content} videoUrl={videoUrl} style={{ fontSize }} />
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
            title={t('bubble.editTitle')}
            onClick={onEdit}
            className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-3" />
          </button>
        )}
        <button
          type="button"
          title={t('bubble.copyTitle')}
          onClick={() => void copy()}
          className="rounded p-1 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}
