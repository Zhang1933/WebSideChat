import type { ChatMessage, Conversation } from '@/types';
import { isDefaultSummaryPrompt } from './prompts';

/** 会话保留上限（LRU，按 updatedAt） */
export const MAX_CONVERSATIONS = 10;
/** 单会话消息上限，超出丢最旧（摘要轮 [0] 保留） */
export const MAX_MESSAGES = 100;

/**
 * 上下文动态压缩标记：压缩后的 user 消息内容固定为该字符串，
 * UI 据此渲染为"上文已压缩"提示行，其后紧跟 assistant 的压缩纪要。
 */
export const CONTEXT_COMPRESSED_MARKER = '⟦上文已压缩⟧';

/** 淘汰超出上限的旧会话（纯函数，供单测） */
export function pruneConversations(
  conversations: Record<string, Conversation>,
): Record<string, Conversation> {
  const entries = Object.values(conversations);
  if (entries.length <= MAX_CONVERSATIONS) return conversations;
  const keep = entries
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  return Object.fromEntries(keep.map((c) => [c.pageKey, c]));
}

export function newConversation(params: {
  pageKey: string;
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}): Conversation {
  const now = Date.now();
  return {
    pageKey: params.pageKey,
    url: params.url,
    title: params.title,
    content: params.content,
    truncated: params.truncated,
    extractedAt: now,
    messages: [],
    updatedAt: now,
  };
}

export function withMessage(conversation: Conversation, message: ChatMessage): Conversation {
  const messages = [...conversation.messages, message].slice(-MAX_MESSAGES);
  return { ...conversation, messages, updatedAt: Date.now() };
}

/** 会话是否已有摘要（第一轮问答完成） */
export function hasSummary(conversation: Conversation | null | undefined): boolean {
  if (!conversation) return false;
  return conversation.messages.some((m) => m.role === 'assistant' && m.content.trim().length > 0);
}

/**
 * 消息列表的展示起始下标：摘要轮的固定指令消息（messages[0]）不展示；
 * 首轮直接提问的会话（无 summaryPrompt 且首条非摘要指令）从 0 开始全量展示。
 */
export function visibleStartIndex(conversation: Conversation): number {
  const first = conversation.messages[0];
  if (!first || first.role !== 'user') return 0;
  const isSummaryPrompt = conversation.summaryPrompt
    ? first.content === conversation.summaryPrompt
    : isDefaultSummaryPrompt(first.content);
  return isSummaryPrompt ? 1 : 0;
}
