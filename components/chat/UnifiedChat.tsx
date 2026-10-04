import { Loader2, Send, Sparkles, Square } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CONTEXT_COMPRESSED_MARKER, visibleStartIndex } from '@/lib/conversation';
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
  /** 正文提取中 */
  extracting: boolean;
  streaming: boolean;
  streamText: string;
  /** 无活动页面 / 本页生成中 / 提取中 */
  disabled: boolean;
  /** 点击快捷气泡「帮我总结网页内容」 */
  onPresetSummary: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  // 贴底跟随：只有用户停留在底部附近时才自动滚动，翻阅历史不被拽回
  const stickToBottomRef = useRef(true);

  const visibleMessages = conversation
    ? conversation.messages.slice(visibleStartIndex(conversation))
    : [];
  const showPreset = visibleMessages.length === 0 && !streaming;

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
    onSend(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
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
              <MessageBubble message={m} muted={isDigest} />
            </Fragment>
          );
        })}

        {streaming && (
          <>
            <MessageBubble message={{ role: 'assistant', content: streamText || '…' }} />
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
            </div>
          </>
        )}
      </div>

      {/* 空会话时：快捷总结气泡紧贴输入框上方，而不是远在消息区顶部 */}
      {showPreset &&
        (extracting ? (
          <p className="flex items-center justify-center gap-1.5 px-3 pb-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> 正在提取页面正文…
          </p>
        ) : (
          <div className="flex justify-center px-3 pb-1.5">
            <button
              type="button"
              onClick={onPresetSummary}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-full border bg-secondary px-3.5 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Sparkles className="size-3.5 text-primary" />
              帮我总结网页内容
            </button>
          </div>
        ))}

      <div className="flex items-end gap-2 border-t p-2.5">
        <Textarea
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
