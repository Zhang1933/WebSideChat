import { Loader2, Pencil, Send, Sparkles, Square } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CONTEXT_COMPRESSED_MARKER, visibleStartIndex } from '@/lib/conversation';
import { isVideoPageUrl } from '@/lib/video/pages';
import type { Conversation } from '@/types';
import { MessageBubble } from './MessageBubble';

/**
 * 统一对话流（始终以对话框形式呈现）：
 * - 空会话（无输入无历史）显示可点击的快捷气泡「帮我总结网页内容」，
 *   同时输入框可用——用户可自由选择直接提问或一键总结
 * - 有历史后：摘要/纪要即第一条 AI 消息，追问接续在后
 */
export function UnifiedChat({
  conversation,
  videoUrl,
  extracting,
  streaming,
  streamText,
  disabled,
  onPresetSummary,
  onSend,
  onStop,
}: {
  /** 当前页面会话；null = 尚未提取（空会话） */
  conversation: Conversation | null;
  /** 视频页 URL（YouTube/B 站）：占位时间戳展开、seek 与快捷气泡文案 */
  videoUrl?: string | null;
  /** 正文/字幕提取中 */
  extracting: boolean;
  streaming: boolean;
  streamText: string;
  /** 无活动页面 / 本页生成中 / 提取中 */
  disabled: boolean;
  /** 点击快捷气泡「帮我总结网页内容」 */
  onPresetSummary: () => void;
  /** editFrom：编辑重发时，被编辑消息在 visibleMessages 中的下标（从该条截断） */
  onSend: (text: string, editFrom?: number) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 贴底跟随：只有用户停留在底部附近时才自动滚动，翻阅历史不被拽回
  const stickToBottomRef = useRef(true);
  /** 编辑中的消息（visibleMessages 下标）：发送时从该条截断重新提问（Gemini 交互） */
  const [editingFrom, setEditingFrom] = useState<number | null>(null);
  const isVideo = isVideoPageUrl(videoUrl);

  const visibleMessages = conversation
    ? conversation.messages.slice(visibleStartIndex(conversation))
    : [];
  const showPreset = visibleMessages.length === 0 && !streaming;
  /** 最后一条可编辑的用户消息（排除压缩标记）的下标 */
  const lastUserIndex = visibleMessages.findLastIndex(
    (m) => m.role === 'user' && m.content !== CONTEXT_COMPRESSED_MARKER,
  );

  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation?.messages.length, streamText]);

  function send() {
    const text = input.trim();
    if (!text || streaming || disabled) return;
    setInput('');
    const editFrom = editingFrom;
    setEditingFrom(null);
    onSend(text, editFrom ?? undefined);
  }

  /** 点击最后一条用户消息的编辑按钮：内容放回输入框并聚焦（Gemini 交互） */
  function startEdit(index: number, content: string) {
    setInput(content);
    setEditingFrom(index);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(content.length, content.length);
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
        {showPreset && (
          <div className="flex flex-col items-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={onPresetSummary}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg disabled:opacity-50"
            >
              <Sparkles className="size-4" />
              {isVideo ? '帮我总结视频内容' : '帮我总结网页内容'}
            </button>
            {extracting && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> 正在提取页面正文…
              </p>
            )}
          </div>
        )}

        {visibleMessages.map((m, i) => {
          // 压缩标记 → 提示行（不渲染为气泡）
          if (m.role === 'user' && m.content === CONTEXT_COMPRESSED_MARKER) {
            return (
              <div
                key={i}
                className="rounded-md border border-dashed px-2 py-1 text-center text-[11px] text-muted-foreground"
              >
                上文已压缩：早期对话已摘要为下方纪要，可继续追问
              </div>
            );
          }
          const isDigest =
            i > 0 &&
            visibleMessages[i - 1]!.role === 'user' &&
            visibleMessages[i - 1]!.content === CONTEXT_COMPRESSED_MARKER;
          return (
            <Fragment key={i}>
              <MessageBubble
                message={m}
                muted={isDigest}
                videoUrl={videoUrl}
                onEdit={
                  i === lastUserIndex && !streaming
                    ? () => startEdit(i, m.content)
                    : undefined
                }
              />
            </Fragment>
          );
        })}

        {streaming && (
          <>
            <MessageBubble message={{ role: 'assistant', content: streamText || '…' }} videoUrl={videoUrl} />
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
            </div>
          </>
        )}
      </div>

      {editingFrom != null && (
        <div className="flex items-center gap-1.5 border-t px-3 py-1 text-[11px] text-muted-foreground">
          <Pencil className="size-3" />
          正在编辑此消息，Enter 重新发送（之后的对话将被移除）
          <button
            type="button"
            className="ml-auto underline hover:text-foreground"
            onClick={() => {
              setEditingFrom(null);
              setInput('');
            }}
          >
            取消
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 border-t p-2.5">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="针对本页内容提问，Enter 发送"
          disabled={disabled && !streaming}
          rows={2}
          className="max-h-32 min-h-9 resize-none text-sm"
        />
        {streaming ? (
          <Button variant="secondary" size="icon-sm" aria-label="停止" onClick={onStop}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            aria-label="发送"
            disabled={!input.trim() || disabled}
            onClick={send}
          >
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
