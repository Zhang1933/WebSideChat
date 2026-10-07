import { Check, RotateCcw, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { defaultUiLang, useT } from '@/lib/i18n';
import {
  DEFAULT_VIDEO_SUMMARY_PROMPTS,
  DEFAULT_WEB_SUMMARY_PROMPTS,
} from '@/lib/prompts';
import { saveSettings, settingsItem } from '@/lib/storage';
import type { AppSettings, SummaryLanguage } from '@/types';

/** 词条表（zh/en/auto 三键） */
type PromptTable = Record<SummaryLanguage, string>;

/** 内容为空或等于任一语言的内置默认 → 视为"未自定义"（语言切换时跟随新默认） */
function isBuiltIn(text: string, table: PromptTable): boolean {
  return !text.trim() || text === table.zh || text === table.en || text === table.auto;
}

/** 提示词设置：分「网页」与「视频」两部分，各自可编辑摘要指令（系统提示词内置不可改）。
 * 默认指令的展示语言跟随 UI 显示语言（uiLang）：切换语言时未自定义的内容自动换成
 * 对应语言的内置默认；运行时实际发送的摘要指令仍由「摘要语言」（summaryLanguage）决定。 */
export function PromptSettingsPage() {
  const t = useT();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [uiLang, setUiLang] = useState<'zh' | 'en'>('zh');
  const [webSummary, setWebSummary] = useState('');
  const [videoSummary, setVideoSummary] = useState('');
  const [saved, setSaved] = useState(false);
  const langRef = useRef<'zh' | 'en' | null>(null);
  // 上次语言切换时的文本快照（用于切换时判断是否自定义）
  const snapshotRef = useRef<{ web: string; video: string } | null>(null);
  snapshotRef.current = { web: webSummary, video: videoSummary };

  useEffect(() => {
    const load = (s: AppSettings) => {
      setSettings(s);
      const lang = s.uiLang ?? defaultUiLang();
      if (langRef.current === null) {
        // 首次加载：自定义优先，否则取 UI 语言的内置默认
        langRef.current = lang;
        setUiLang(lang);
        setWebSummary(s.customWebSummaryPrompt?.trim() || DEFAULT_WEB_SUMMARY_PROMPTS[lang]);
        setVideoSummary(s.customVideoSummaryPrompt?.trim() || DEFAULT_VIDEO_SUMMARY_PROMPTS[lang]);
        return;
      }
      if (langRef.current === lang) return;
      // UI 语言切换：未自定义的内容跟随新语言默认，已自定义的保留
      langRef.current = lang;
      setUiLang(lang);
      const snap = snapshotRef.current;
      if (snap && isBuiltIn(snap.web, DEFAULT_WEB_SUMMARY_PROMPTS)) {
        setWebSummary(DEFAULT_WEB_SUMMARY_PROMPTS[lang]);
      }
      if (snap && isBuiltIn(snap.video, DEFAULT_VIDEO_SUMMARY_PROMPTS)) {
        setVideoSummary(DEFAULT_VIDEO_SUMMARY_PROMPTS[lang]);
      }
    };
    void settingsItem.getValue().then(load);
    return settingsItem.watch(load);
  }, []);

  async function save() {
    // 默认值判定用当前展示语言：界面显示哪种默认，原样保存即视为"用默认"
    await saveSettings({
      // 系统提示词始终清空（内置优先，不允许自定义）
      customWebSystemPrompt: '',
      customVideoSystemPrompt: '',
      customWebSummaryPrompt:
        webSummary.trim() === DEFAULT_WEB_SUMMARY_PROMPTS[uiLang] ? '' : webSummary,
      customVideoSummaryPrompt:
        videoSummary.trim() === DEFAULT_VIDEO_SUMMARY_PROMPTS[uiLang] ? '' : videoSummary,
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
        <Label htmlFor={sumId}>{t('prompts.instruction')}</Label>
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
          <RotateCcw className="size-3" /> {t('prompts.restore')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {section(
        t('prompts.web'),
        'webSummary', webSummary,
        DEFAULT_WEB_SUMMARY_PROMPTS[uiLang], setWebSummary,
      )}
      {section(
        t('prompts.video'),
        'videoSummary', videoSummary,
        DEFAULT_VIDEO_SUMMARY_PROMPTS[uiLang], setVideoSummary,
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()}>
          <Save className="size-3.5" /> {t('common.save')}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <Check className="size-3.5" /> {t('common.saved')}
          </span>
        )}
      </div>
    </div>
  );
}
