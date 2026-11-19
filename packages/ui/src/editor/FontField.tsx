import { BoundingBox, DropHalfBottom, Plus, TextB, TextItalic, TextStrikethrough, TextUnderline } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ToggleGroupItem } from '../components/ui/misc';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../components/ui/select';
import { ICON } from '../lib/icons';
import { ColorField } from './ColorField';
import { useEditor, type FontFamilyOption } from './context';

// FontField（font 参数，docs/04-templates.md 4.4）：字体族下拉（游戏字体、内置字体、导入的字体，以及“导入字体…”），
// 下面一排样式开关（粗体、斜体、下划线、删除线、阴影、描边）和描边颜色。
// 列表里只写字体名，不用所选字体预览：应用自己的界面不用游戏的字体（docs/09-compliance.md 9.3）。

export interface FontValue {
  family: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  shadow: boolean;
  outline: string | null;
}

export interface FontFieldProps {
  value: FontValue;
  onChange(value: FontValue): void;
  label: string;
  testId?: string;
}

const IMPORT = '__import__';
/** 打开描边时的默认颜色：黑色（发光告示牌的描边颜色随墨水变，这里取最常见的深色） */
const DEFAULT_OUTLINE = '#000000';

type Flag = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'shadow';

function StyleToggle({ on, onChange, label, children, testId }: { on: boolean; onChange(on: boolean): void; label: string; children: ReactNode; testId?: string }) {
  return (
    <ToggleGroupItem value={label} pressed={on} onPressedChange={(p: boolean) => onChange(p)} aria-label={label} title={label} data-testid={testId} className="flex-none">
      {children}
    </ToggleGroupItem>
  );
}

export function FontField({ value, onChange, label, testId }: FontFieldProps) {
  const editor = useEditor();
  const families: readonly FontFamilyOption[] = editor.fonts?.families ?? [];
  const known = families.some((f) => f.id === value.family);
  const groups: { key: FontFamilyOption['group']; label: string }[] = [
    { key: 'game', label: editor.t('font.groups.game') },
    { key: 'builtin', label: editor.t('font.groups.builtin') },
    { key: 'user', label: editor.t('font.groups.user') },
  ];
  const nameOf = (id: string) => families.find((f) => f.id === id)?.label ?? (id.startsWith('user:') ? editor.t('font.missing') : id);
  const set = (patch: Partial<FontValue>) => onChange({ ...value, ...patch });
  const flag = (k: Flag) => (on: boolean) => set({ [k]: on } as Partial<FontValue>);
  const importFont = editor.fonts?.importFont;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <Select
        value={value.family}
        onValueChange={(v) => {
          if (v === IMPORT) {
            void importFont?.().then((id) => {
              if (id) set({ family: id });
            });
            return;
          }
          if (typeof v === 'string' && v !== value.family) set({ family: v });
        }}
      >
        <SelectTrigger aria-label={label} data-testid={testId ? `${testId}-family` : undefined} className="w-full">
          <SelectValue>{(v: unknown) => <span className="truncate">{nameOf(String(v))}</span>}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!known && (
            <SelectItem value={value.family}>
              <span className="truncate">{nameOf(value.family)}</span>
            </SelectItem>
          )}
          {groups.map((g) => {
            const items = families.filter((f) => f.group === g.key);
            if (items.length === 0) return null;
            return (
              <div key={g.key} role="presentation">
                <div className="px-2 pt-1.5 pb-0.5 text-xs text-fg-subtle" aria-hidden="true">
                  {g.label}
                </div>
                {items.map((f) => (
                  <SelectItem key={f.id} value={f.id} title={f.hint}>
                    <span className="truncate">{f.label}</span>
                  </SelectItem>
                ))}
              </div>
            );
          })}
          {importFont && <SelectSeparator />}
          {importFont && (
            <SelectItem value={IMPORT} data-testid={testId ? `${testId}-import` : undefined}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={ICON.sm} />
                {editor.t('font.import')}
              </span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      <div className="flex min-w-0 items-center gap-1">
        <div className="inline-flex h-control items-stretch gap-0.5 rounded-lg bg-well p-0.5" role="group" aria-label={editor.t('font.style')}>
          <StyleToggle on={value.bold} onChange={flag('bold')} label={editor.t('font.bold')} testId={testId ? `${testId}-bold` : undefined}>
            <TextB size={ICON.md} />
          </StyleToggle>
          <StyleToggle on={value.italic} onChange={flag('italic')} label={editor.t('font.italic')} testId={testId ? `${testId}-italic` : undefined}>
            <TextItalic size={ICON.md} />
          </StyleToggle>
          <StyleToggle on={value.underline} onChange={flag('underline')} label={editor.t('font.underline')} testId={testId ? `${testId}-underline` : undefined}>
            <TextUnderline size={ICON.md} />
          </StyleToggle>
          <StyleToggle on={value.strikethrough} onChange={flag('strikethrough')} label={editor.t('font.strikethrough')} testId={testId ? `${testId}-strikethrough` : undefined}>
            <TextStrikethrough size={ICON.md} />
          </StyleToggle>
          <StyleToggle on={value.shadow} onChange={flag('shadow')} label={editor.t('font.shadow')} testId={testId ? `${testId}-shadow` : undefined}>
            <DropHalfBottom size={ICON.md} />
          </StyleToggle>
          <StyleToggle on={value.outline !== null} onChange={(on) => set({ outline: on ? DEFAULT_OUTLINE : null })} label={editor.t('font.outline')} testId={testId ? `${testId}-outline` : undefined}>
            <BoundingBox size={ICON.md} />
          </StyleToggle>
        </div>
        {value.outline !== null && (
          <div className="min-w-0 flex-1" title={editor.t('font.outlineHint')}>
            <ColorField value={value.outline} onChange={(c) => set({ outline: c.slice(0, 7) })} palette="dye" label={editor.t('font.outlineColor')} testId={testId ? `${testId}-outline-color` : undefined} />
          </div>
        )}
      </div>
      {value.outline !== null && value.shadow && <p className="text-xs text-fg-subtle">{editor.t('font.outlineNoShadow')}</p>}
    </div>
  );
}
