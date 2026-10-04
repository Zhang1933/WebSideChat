import type { AppSettings, Conversation, Provider } from '@/types';

/**
 * 面板 ↔ background ↔ Offscreen Document 的回合消息协议。
 * LLM 流跑在 Offscreen Document（常驻，不受 SW idle 回收/面板关闭影响），
 * 面板只发起点播并订阅事件；结果由 offscreen 落库并广播。
 */
export type TurnMessage =
  | {
      type: 'turn:start';
      streamId: string;
      pageKey: string;
      provider: Provider;
      settings: AppSettings;
      /** 本轮的会话基底（不含本轮用户消息，offscreen 自行拼接） */
      conversation: Conversation;
      userContent: string;
      target: 'summary' | 'chat';
    }
  | { type: 'turn:cancel'; pageKey: string }
  | { type: 'turn:started'; streamId: string; pageKey: string; conversation: Conversation }
  | { type: 'turn:delta'; streamId: string; pageKey: string; full: string }
  | { type: 'turn:done'; streamId: string; pageKey: string; conversation: Conversation }
  | {
      type: 'turn:error';
      streamId: string;
      pageKey: string;
      error: string;
      conversation: Conversation;
    }
  | { type: 'offscreen:ensure' }
  | { type: 'offscreen:idle' };

/** 面板发起回合前调用：确保 offscreen 文档已创建（由 background 创建） */
export async function ensureOffscreenReady(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'offscreen:ensure' } satisfies TurnMessage);
}
