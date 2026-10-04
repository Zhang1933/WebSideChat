import type { SseEvent } from './types';

/**
 * 增量式 SSE（text/event-stream）解析器。
 *
 * fetch 的流式 body 会被切成任意大小的 chunk，事件可能跨 chunk 断裂，
 * 因此必须缓冲拼接、按空行（\n\n）切帧。纯函数式类，无 DOM 依赖，可单测。
 */
export class SseParser {
  private buffer = '';

  /** 喂入一个 chunk，返回其中完整的 SSE 事件 */
  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    // 规范化 CRLF；跨 chunk 的 \r + \n 会在下一次 feed 时合并处理
    this.buffer = this.buffer.replace(/\r\n/g, '\n');

    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const ev = parseSseFrame(raw);
      if (ev) events.push(ev);
    }
    return events;
  }

  /** 流结束时冲刷残留缓冲（未以空行结尾的最后事件） */
  flush(): SseEvent[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (!rest) return [];
    const ev = parseSseFrame(rest);
    return ev ? [ev] : [];
  }
}

function parseSseFrame(raw: string): SseEvent | null {
  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // 注释/心跳
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // 规范：去掉 data: 后的一个前导空格
      const value = line.slice(5);
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }
  if (dataLines.length === 0) return null;
  return { event: eventName, data: dataLines.join('\n') };
}
