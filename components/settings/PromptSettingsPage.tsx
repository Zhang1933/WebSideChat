import { Check, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_VIDEO_SUMMARY_PROMPTS,
  DEFAULT_VIDEO_SYSTEM_PROMPT,
  DEFAULT_WEB_SUMMARY_PROMPTS,
  DEFAULT_WEB_SYSTEM_PROMPT,
} from '@/lib/prompts';
import { saveSettings, settingsItem } from '@/lib/storage';
import type { AppSettings } from '@/types';

/** 提示词设置：分「网页」与「视频」两部分，各自可编辑系统提示词与摘要指令 */
export function PromptSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [webSystem, setWebSystem] = useState('');
  const [webSummary, setWebSummary] = useState('');
  const [videoSystem, setVideoSystem] = useState('');
  const [videoSummary, setVideoSummary] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    settingsItem.getValue().then((s) => {
      setSettings(s);
      const lang = s.summaryLanguage;
      setWebSystem(s.customWebSystemPrompt?.trim() || DEFAULT_WEB_SYSTEM_PROMPT);
      setWebSummary(s.customWebSummaryPrompt?.trim() || DEFAULT_WEB_SUMMARY_PROMPTS[lang]);
      setVideoSystem(s.customVideoSystemPrompt?.trim() || DEFAULT_VIDEO_SYSTEM_PROMPT);
      setVideoSummary(s.customVideoSummaryPrompt?.trim() || DEFAULT_VIDEO_SUMMARY_PROMPTS[lang]);
    });
  }, []);

  async function save() {
    const lang = settings?.summaryLanguage ?? 'zh';
    // 与内置默认相同就存空串（语义上"使用默认"，语言切换时跟随内置变化）
    await saveSettings({
      customWebSystemPrompt:
        webSystem.trim() === DEFAULT_WEB_SYSTEM_PROMPT ? '' : webSystem,
      customWebSummaryPrompt:
        webSummary.trim() === DEFAULT_WEB_SUMMARY_PROMPTS[lang] ? '' : webSummary,
      customVideoSystemPrompt:
        videoSystem.trim() === DEFAULT_VIDEO_SYSTEM_PROMPT ? '' : videoSystem,
      customVideoSummaryPrompt:
        videoSummary.trim() === DEFAULT_VIDEO_SUMMARY_PROMPTS[lang] ? '' : videoSummary,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const section = (
    label: string,
    hint: string,
    sysId: string,
    sysValue: string,
    sysDefault: string,
    sysSetter: (v: string) => void,
    sumId: string,
    sumValue: string,
    sumDefault: string,
    sumSetter: (v: string) => void,
  ) => (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 text-sm font-semibold">{label}</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={sysId}>系统提示词（角色设定）</Label>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
        <Textarea
          id={sysId}
          value={sysValue}
          onChange={(e) => sysSetter(e.target.value)}
          rows={4}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => sysSetter(sysDefault)}
        >
          <RotateCcw className="size-3" /> 恢复默认
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        <Label htmlFor={sumId}>摘要指令</Label>
        <Textarea
          id={sumId}
          value={sumValue}
          onChange={(e) => sumSetter(e.target.value)}
          rows={7}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => sumSetter(sumDefault)}
        >
          <RotateCcw className="size-3" /> 恢复默认
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {section(
        '📄 网页',
        '普通网页摘要与追问时的角色设定，位于正文之前。',
        'webSystem', webSystem, DEFAULT_WEB_SYSTEM_PROMPT, setWebSystem,
        'webSummary', webSummary,
        DEFAULT_WEB_SUMMARY_PROMPTS[settings?.summaryLanguage ?? 'zh'], setWebSummary,
      )}
      {section(
        '▶️ 视频',
        'YouTube 等视频页摘要与追问时的角色设定，位于字幕之前。字幕每行带 [时:分:秒] 时间戳。',
        'videoSystem', videoSystem, DEFAULT_VIDEO_SYSTEM_PROMPT, setVideoSystem,
        'videoSummary', videoSummary,
        DEFAULT_VIDEO_SUMMARY_PROMPTS[settings?.summaryLanguage ?? 'zh'], setVideoSummary,
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()}>
          <Save className="size-3.5" /> 保存
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <Check className="size-3.5" /> 已保存
          </span>
        )}
      </div>
    </div>
  );
}
