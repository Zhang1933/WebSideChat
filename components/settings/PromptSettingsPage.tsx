import { Check, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_SUMMARY_PROMPTS,
  DEFAULT_SYSTEM_PROMPT,
} from '@/lib/prompts';
import { saveSettings, settingsItem } from '@/lib/storage';
import type { AppSettings } from '@/types';

/** 提示词设置：编辑系统提示词（角色设定）与摘要指令，留空/恢复 = 内置默认 */
export function PromptSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [summaryPrompt, setSummaryPrompt] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    settingsItem.getValue().then((s) => {
      setSettings(s);
      setSystemPrompt(s.customSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT);
      setSummaryPrompt(s.customSummaryPrompt?.trim() || DEFAULT_SUMMARY_PROMPTS[s.summaryLanguage]);
    });
  }, []);

  async function save() {
    // 与内置默认相同就存空串（语义上"使用默认"，语言切换时跟随内置变化）
    const sys = systemPrompt.trim() === DEFAULT_SYSTEM_PROMPT ? '' : systemPrompt;
    const sum = summaryPrompt.trim() === DEFAULT_SUMMARY_PROMPTS[settings?.summaryLanguage ?? 'zh'] ? '' : summaryPrompt;
    await saveSettings({ customSystemPrompt: sys, customSummaryPrompt: sum });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="systemPrompt">系统提示词（角色设定）</Label>
        <p className="text-[11px] text-muted-foreground">
          每次摘要与追问都会作为 system 提示发送，位于网页正文之前。修改会影响回答风格与约束。
        </p>
        <Textarea
          id="systemPrompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={5}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
        >
          <RotateCcw className="size-3" /> 恢复默认
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="summaryPrompt">摘要指令</Label>
        <p className="text-[11px] text-muted-foreground">
          生成摘要时发送的第一条指令，决定摘要的结构与格式。自定义后不再随「摘要语言」设置变化。
        </p>
        <Textarea
          id="summaryPrompt"
          value={summaryPrompt}
          onChange={(e) => setSummaryPrompt(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setSummaryPrompt(DEFAULT_SUMMARY_PROMPTS[settings?.summaryLanguage ?? 'zh'])}
        >
          <RotateCcw className="size-3" /> 恢复默认
        </button>
      </div>

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
