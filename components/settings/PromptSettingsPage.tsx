import { Check, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_VIDEO_SUMMARY_PROMPTS,
  DEFAULT_WEB_SUMMARY_PROMPTS,
} from '@/lib/prompts';
import { saveSettings, settingsItem } from '@/lib/storage';
import type { AppSettings } from '@/types';

/** 提示词设置：分「网页」与「视频」两部分，各自可编辑摘要指令（系统提示词内置不可改） */
export function PromptSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [webSummary, setWebSummary] = useState('');
  const [videoSummary, setVideoSummary] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    settingsItem.getValue().then((s) => {
      setSettings(s);
      const lang = s.summaryLanguage;
      setWebSummary(s.customWebSummaryPrompt?.trim() || DEFAULT_WEB_SUMMARY_PROMPTS[lang]);
      setVideoSummary(s.customVideoSummaryPrompt?.trim() || DEFAULT_VIDEO_SUMMARY_PROMPTS[lang]);
    });
  }, []);

  async function save() {
    const lang = settings?.summaryLanguage ?? 'zh';
    await saveSettings({
      // 系统提示词始终清空（内置优先，不允许自定义）
      customWebSystemPrompt: '',
      customVideoSystemPrompt: '',
      customWebSummaryPrompt:
        webSummary.trim() === DEFAULT_WEB_SUMMARY_PROMPTS[lang] ? '' : webSummary,
      customVideoSummaryPrompt:
        videoSummary.trim() === DEFAULT_VIDEO_SUMMARY_PROMPTS[lang] ? '' : videoSummary,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const section = (
    label: string,
    sumId: string,
    sumValue: string,
    sumDefault: string,
    sumSetter: (v: string) => void,
  ) => (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 text-sm font-semibold">{label}</h3>
      <div className="flex flex-col gap-1.5">
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
        'webSummary', webSummary,
        DEFAULT_WEB_SUMMARY_PROMPTS[settings?.summaryLanguage ?? 'zh'], setWebSummary,
      )}
      {section(
        '▶️ 视频',
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
