import type { AppSettings, Conversation } from '@/types';
import { extractVideoId, isYouTubeWatchUrl } from '@/lib/youtube';

/** 内置系统提示词（网页场景的角色设定；语言指令与正文在其后拼接） */
export const DEFAULT_WEB_SYSTEM_PROMPT =
  '你是网页摘要助手。用户会提供网页正文，请严格基于所提供内容回答问题，不要编造之外的信息。\n内容为 Markdown，引用数据时以其结构为准。';

/** 内置系统提示词（视频场景，字幕带 [时:分:秒] 时间戳） */
export const DEFAULT_VIDEO_SYSTEM_PROMPT =
  '你是视频摘要助手。用户会提供视频字幕（每行带 [时:分:秒] 时间戳）与一个时间戳链接模板，请严格基于字幕内容回答问题，不要编造之外的信息。\n引用内容时输出可点击的时间戳链接：取模板中的完整 URL，把其中的 {秒数} 字面量替换为实际秒数。示例：若模板为 https://www.youtube.com/watch?v=abc&t={秒数}s，字幕 [05:30] 对应 330 秒，则输出 [`05:30`](https://www.youtube.com/watch?v=abc&t=330s)。';

/** 兼容旧引用 */
export const DEFAULT_SYSTEM_PROMPT = DEFAULT_WEB_SYSTEM_PROMPT;

/** 内置摘要指令（网页，按摘要语言） */
export const DEFAULT_WEB_SUMMARY_PROMPTS: Record<AppSettings['summaryLanguage'], string> = {
  zh: '请为这个网页生成结构化摘要，使用 Markdown 输出，包含以下部分：\n\n## 一句话总结\n## 核心要点（3-6 条 bullet，保留关键细节）\n## 关键数据 / 结论\n\n要求：只基于正文内容，不要编造；正文信息不足时如实说明。',
  en: 'Summarize this page in Markdown with these sections:\n\n## TL;DR\n## Key Points (3-6 bullets with key details)\n## Data / Conclusions\n\nOnly use the page content; do not make things up.',
  auto: '请为这个网页生成结构化摘要，使用 Markdown 输出，包含以下部分：\n\n## 一句话总结\n## 核心要点（3-6 条 bullet，保留关键细节）\n## 关键数据 / 结论\n\n要求：只基于正文内容，不要编造；正文信息不足时如实说明。',
};

/** 内置摘要指令（视频，按摘要语言） */
export const DEFAULT_VIDEO_SUMMARY_PROMPTS: Record<AppSettings['summaryLanguage'], string> = {
  zh: '请为这个视频生成结构化摘要，使用 Markdown 输出，包含以下部分：\n\n## 一句话总结\n## 核心要点（3-6 条 bullet，每条附可点击的时间戳链接）\n## 关键结论\n\n要求：只基于字幕内容，不要编造；字幕信息不足时如实说明。',
  en: 'Summarize this video in Markdown with these sections:\n\n## TL;DR\n## Key Points (3-6 bullets, each with a clickable timestamp link)\n## Conclusions\n\nOnly use the subtitle content; do not make things up.',
  auto: '请为这个视频生成结构化摘要，使用 Markdown 输出，包含以下部分：\n\n## 一句话总结\n## 核心要点（3-6 条 bullet，每条附可点击的时间戳链接）\n## 关键结论\n\n要求：只基于字幕内容，不要编造；字幕信息不足时如实说明。',
};

/** 兼容旧引用 */
export const DEFAULT_SUMMARY_PROMPTS = DEFAULT_WEB_SUMMARY_PROMPTS;

const LANG_INSTRUCTION: Record<AppSettings['summaryLanguage'], string> = {
  zh: '请始终使用中文回复。',
  en: 'Always respond in English.',
  auto: '请使用与网页正文相同的语言回复。',
};

/** 系统提示词正文之前的角色设定（自定义优先；按视频/网页场景取对应默认与自定义） */
export function systemRole(settings: AppSettings, isVideo = false): string {
  const custom = (
    isVideo ? settings.customVideoSystemPrompt : settings.customWebSystemPrompt
  )?.trim();
  if (custom) return custom;
  return isVideo ? DEFAULT_VIDEO_SYSTEM_PROMPT : DEFAULT_WEB_SYSTEM_PROMPT;
}

/** 摘要轮的用户指令（自定义优先，其次按语言与场景取内置） */
export function summaryUserPrompt(settings: AppSettings, isVideo = false): string {
  const custom = (
    isVideo ? settings.customVideoSummaryPrompt : settings.customWebSummaryPrompt
  )?.trim();
  if (custom) return custom;
  const table = isVideo ? DEFAULT_VIDEO_SUMMARY_PROMPTS : DEFAULT_WEB_SUMMARY_PROMPTS;
  return table[settings.summaryLanguage];
}

/** 是否为内置摘要指令（用于识别并隐藏历史会话里的摘要轮指令消息） */
export function isDefaultSummaryPrompt(text: string): boolean {
  const all = [
    ...Object.values(DEFAULT_WEB_SUMMARY_PROMPTS),
    ...Object.values(DEFAULT_VIDEO_SUMMARY_PROMPTS),
  ];
  return new Set(all).has(text.trim());
}

/** system 提示：网页正文 + 元数据作为常驻上下文（摘要与追问共享） */
export function buildSystemPrompt(conversation: Conversation, settings: AppSettings): string {
  const isVideo = conversation.url ? isYouTubeWatchUrl(conversation.url) : false;

  // 视频：提取 videoId 并给出可直接替换的时间戳链接模板，模型不需要自己解析 URL
  let linkTemplate = '';
  if (isVideo) {
    const videoId = extractVideoId(conversation.url ?? '');
    if (videoId) {
      linkTemplate = `时间戳链接模板: https://www.youtube.com/watch?v=${videoId}&t={秒数}s（把 {秒数} 替换为实际秒数，如 330 表示 05:30）`;
    }
  }

  const meta = [
    `URL: ${conversation.url}`,
    `标题: ${conversation.title}`,
    linkTemplate,
    conversation.truncated ? '（正文过长，已截断）' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    systemRole(settings, isVideo),
    LANG_INSTRUCTION[settings.summaryLanguage],
    '',
    '<page>',
    meta,
    '',
    conversation.content,
    '</page>',
  ].join('\n');
}
