import type { AppSettings, Conversation } from '@/types';

const LANG_INSTRUCTION: Record<AppSettings['summaryLanguage'], string> = {
  zh: '请始终使用中文回复。',
  en: 'Always respond in English.',
  auto: '请使用与网页正文相同的语言回复。',
};

const SUMMARY_PROMPT: Record<AppSettings['summaryLanguage'], string> = {
  zh: '请为这个网页生成结构化摘要，使用 Markdown 输出，包含以下部分：\n\n## 一句话总结\n## 核心要点（3-6 条 bullet，保留关键细节）\n## 关键数据 / 结论\n\n要求：只基于正文内容，不要编造；正文信息不足时如实说明。',
  en: 'Summarize this page in Markdown with these sections:\n\n## TL;DR\n## Key Points (3-6 bullets with key details)\n## Data / Conclusions\n\nOnly use the page content; do not make things up.',
  auto: '请为这个网页生成结构化摘要，使用 Markdown 输出，包含以下部分：\n\n## 一句话总结\n## 核心要点（3-6 条 bullet，保留关键细节）\n## 关键数据 / 结论\n\n要求：只基于正文内容，不要编造；正文信息不足时如实说明。',
};

/** system 提示：网页正文 + 元数据作为常驻上下文（摘要与追问共享） */
export function buildSystemPrompt(conversation: Conversation, settings: AppSettings): string {
  const meta = [
    `URL: ${conversation.url}`,
    `标题: ${conversation.title}`,
    conversation.truncated ? '（正文过长，已截断）' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    '你是网页摘要助手。用户会提供网页正文，请严格基于正文内容回答问题，不要编造正文之外的信息。',
    LANG_INSTRUCTION[settings.summaryLanguage],
    '',
    '<page>',
    meta,
    '',
    conversation.content,
    '</page>',
  ].join('\n');
}

export function summaryUserPrompt(settings: AppSettings): string {
  return SUMMARY_PROMPT[settings.summaryLanguage];
}
