// 右栏的“动画”标签页（docs/animation-editor.md 5.2、10.1、10.2）。
// - 没选图层：整段动画的设置（名字、类别、时长、剪辑点、相机）、参数表、“转为模板”。
// - 选了图层：内容（方块、物品、文字、字体、色块）和八个可动画属性；属性行左边的菱形是“在当前时刻加或删关键帧”，
//   有关键帧的属性改数值时自动在当前时刻落一个关键帧（After Effects 的做法）。
// - 选中了关键帧：时刻、数值、缓动；选中了好几个：对齐、复制、删除。选中了音效：音效、时刻、音量、速率、空间位置。
// 能暴露为参数的每一行右边有一个链接按钮：暴露为新参数、绑定到已有参数、解除绑定。绑定了的值显示参数的默认值，
// 改它就是改参数的默认值（转成模板后模板用户在属性面板里改）。
// 界面显示的都是解析过参数的值（resolve.ts），修改写回文档里的原样位置。控件和排版沿用属性面板，不另起样式。
import { Button } from '@allay/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuItemIcon, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@allay/ui/components/dropdown-menu';
import { ScrollArea } from '@allay/ui/components/misc';
import { Switch } from '@allay/ui/components/switch';
import {
  BlockPicker,
  BooleanField,
  ColorField,
  EasingField,
  EnumField,
  FontField,
  ItemPicker,
  ParamGroup,
  ScrubNumberField,
  SoundField,
  SpatialAudioRow,
  TextField,
  type EasingValue,
  type FontValue,
} from '@allay/ui/editor';
import { ICON } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { Code, Diamond, LinkSimple, LinkBreak, Lock, Plus, Trash, TreeStructure } from '@phosphor-icons/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@allay/ui/components/select';
import { descendants } from '../../../shared/animation/layers';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { keyIndexAt, keysOf, propValue, setKeyEase } from '../../../shared/animation/edit';
import { compatibleTypes, paramUsage, readTarget, type BindTarget } from '../../../shared/animation/params';
import { docDuration, resolveDoc, type ResolvedDoc, type ResolvedLayer } from '../../../shared/animation/resolve';
import { ANIM_PROPS, BLEND_MODES, isParamRef, type AnimationDoc, type AnimEasing, type AnimParam, type AnimProp, type Layer } from '../../../shared/animation/schema';
import { commandEnabled, trigger, useRegistry } from '../../app/registry';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { localized } from '../../templates/catalog';
import { EditorServicesProvider } from '../params/editorServices';
import { setProp, toggleKey } from './commands';
import { easeEval } from './easeEval';
import { editDoc } from './source';
import { useAnimationUi } from './uiState';
import { useCodeWindow } from './codeWindow';
import { RepeatSection } from './RepeatSection';
import { PathSection } from './PathSection';

const PROP_META: Record<AnimProp, { step: number; unit?: string; min?: number; max?: number }> = {
  x: { step: 1 },
  y: { step: 1 },
  z: { step: 1 },
  rotX: { step: 1, unit: '°' },
  rotY: { step: 1, unit: '°' },
  rotZ: { step: 1, unit: '°' },
  scale: { step: 0.01, min: 0, max: 20 },
  opacity: { step: 0.01, min: 0, max: 1 },
  progress: { step: 0.001, min: 0, max: 1 },
};

function Row({ label, children, testId, lead, bind }: { label: string; children: ReactNode; testId?: string; lead?: ReactNode; bind?: ReactNode }) {
  return (
    <div className="grid min-h-row grid-cols-[minmax(72px,30%)_1fr] items-center gap-2.5" data-testid={testId}>
      <div className="flex min-w-0 items-center gap-1 text-fg-muted">
        {lead}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">{children}</div>
        {bind}
      </div>
    </div>
  );
}

function Group({ id, title, children, extra }: { id: string; title: string; children: ReactNode; extra?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ParamGroup id={`anim-${id}`} title={title} collapsed={collapsed} onToggle={setCollapsed} extra={extra}>
      {children}
    </ParamGroup>
  );
}

function useDocs(): { doc: AnimationDoc; resolved: ResolvedDoc } | null {
  const doc = useProjectStore((s) => s.template?.animation?.doc ?? null);
  return useMemo(() => (doc ? { doc, resolved: resolveDoc(doc) } : null), [doc]);
}

/** 写一个能绑定的值：绑定着的改参数的默认值，没绑定的直接写进文档 */
function setBindable(doc: AnimationDoc, target: BindTarget, value: unknown, write: () => void): void {
  const raw = readTarget(doc, target);
  if (isParamRef(raw)) trigger('animUpdateParam', { key: raw.$param, patch: { default: value } });
  else write();
}

/** 行右边的链接按钮：暴露为参数、绑定到已有参数、解除绑定 */
function BindButton({ doc, target, label }: { doc: AnimationDoc; target: BindTarget; label: string }) {
  const { t, i18n } = useTranslation();
  const raw = readTarget(doc, target);
  const bound = isParamRef(raw) ? doc.params.find((p) => p.key === raw.$param) : undefined;
  const types = compatibleTypes(target);
  const candidates = doc.params.filter((p) => types.includes(p.type) && p.key !== bound?.key);
  const testId = `anim-bind-${target.kind === 'field' ? target.field : target.kind === 'prop' || target.kind === 'key' ? target.prop : target.kind}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('shrink-0', bound ? 'text-primary-text' : 'text-fg-subtle')}
            aria-label={bound ? t('anim.params.boundTo', { name: localized(bound.label, i18n.language) }) : t('anim.params.expose')}
            title={bound ? t('anim.params.boundTo', { name: localized(bound.label, i18n.language) }) : t('anim.params.expose')}
            data-testid={testId}
            data-bound={bound ? bound.key : ''}
          />
        }
      >
        <LinkSimple size={ICON.xs} weight={bound ? 'bold' : 'regular'} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {/* 分组标题必须放在分组里（Base UI 的要求，见 trial-crashes.test.ts） */}
        <DropdownMenuGroup>
          {bound && <DropdownMenuLabel>{t('anim.params.boundTo', { name: localized(bound.label, i18n.language) })}</DropdownMenuLabel>}
          <DropdownMenuItem data-testid={`${testId}-expose`} onClick={() => trigger('animExposeParam', { target, label })}>
            <DropdownMenuItemIcon icon={Plus} />
            {t('anim.params.exposeNew')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {candidates.length > 0 && <DropdownMenuSeparator />}
        {candidates.map((p) => (
          <DropdownMenuItem key={p.key} onClick={() => trigger('animBindParam', { target, key: p.key })}>
            <DropdownMenuItemIcon icon={LinkSimple} />
            {t('anim.params.bindTo', { name: localized(p.label, i18n.language) })}
          </DropdownMenuItem>
        ))}
        {bound && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid={`${testId}-unbind`} onClick={() => trigger('animUnbindParam', { target })}>
              <DropdownMenuItemIcon icon={LinkBreak} />
              {t('anim.params.unbind')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 改当前图层的一个内容字段（不是可动画属性） */
function patchLayer(id: string, patch: Record<string, unknown>): void {
  editDoc((doc) => {
    const i = doc.layers.findIndex((l) => l.id === id);
    if (i >= 0) doc.layers[i] = { ...doc.layers[i]!, ...patch } as Layer;
  });
}

const fullFont = (f: Partial<FontValue> | undefined): FontValue => ({ family: 'minecraft:default', bold: false, italic: false, underline: false, strikethrough: false, shadow: false, outline: null, ...f });

/** 父级：没有，或任何不是自己、不是自己子孙的图层 */
function ParentSelect({ doc, layer }: { doc: AnimationDoc; layer: Layer }) {
  const { t } = useTranslation();
  const banned = new Set([layer.id, ...descendants(doc, layer.id)]);
  const options = doc.layers.filter((l) => !banned.has(l.id));
  const NONE = '__none__';
  return (
    <Select value={layer.parent ?? NONE} onValueChange={(v) => trigger('animSetParent', { layer: layer.id, parent: v === NONE ? null : String(v) })}>
      <SelectTrigger className="w-full" aria-label={t('anim.props.parent')} data-testid="anim-layer-parent">
        <SelectValue>{(v: unknown) => (v === NONE || v === undefined ? t('anim.props.noParent') : (doc.layers.find((l) => l.id === v)?.name ?? String(v)))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('anim.props.noParent')}</SelectItem>
        {options.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 参数默认值的编辑控件（按参数类型） */
function ParamDefault({ p }: { p: AnimParam }) {
  const { t } = useTranslation();
  const set = (v: unknown) => trigger('animUpdateParam', { key: p.key, patch: { default: v } });
  const label = t('anim.params.default');
  switch (p.type) {
    case 'number':
      return <ScrubNumberField value={p.default} min={p.min} max={p.max} step={p.step ?? 1} label={label} testId={`anim-param-default-${p.key}`} onChange={set} />;
    case 'duration':
      return <ScrubNumberField value={p.default} min={p.min} max={p.max} step={0.01} minDecimals={2} unit="s" label={label} testId={`anim-param-default-${p.key}`} onChange={set} />;
    case 'block':
      return <BlockPicker value={p.default} onChange={set} label={label} testId={`anim-param-default-${p.key}`} />;
    case 'item':
      return <ItemPicker value={p.default} onChange={set} label={label} testId={`anim-param-default-${p.key}`} />;
    case 'text':
      return <TextField value={p.default} maxLength={500} label={label} testId={`anim-param-default-${p.key}`} onChange={(v) => v && set(v)} />;
    case 'color':
      return <ColorField value={p.default} onChange={set} label={label} testId={`anim-param-default-${p.key}`} />;
    case 'font':
      return <FontField value={fullFont(p.default as Partial<FontValue>)} onChange={(v) => set(v)} label={label} testId={`anim-param-default-${p.key}`} />;
    case 'sound':
      return <SoundField value={p.default} onChange={(v) => v && set(v)} label={label} testId={`anim-param-default-${p.key}`} />;
  }
}

function ParamsSection({ doc }: { doc: AnimationDoc }) {
  const { t, i18n } = useTranslation();
  return (
    <Group id="params" title={t('anim.params.title')} extra={doc.params.length > 0 ? String(doc.params.length) : undefined}>
      {doc.params.length === 0 ? (
        <p className="pb-1 text-xs leading-snug text-fg-subtle" data-testid="anim-params-empty">
          {t('anim.params.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="anim-params">
          {doc.params.map((p) => (
            <li key={p.key} className="flex flex-col gap-1 border-t border-divider pt-2 first:border-t-0 first:pt-0" data-testid="anim-param" data-key={p.key}>
              <div className="flex items-center gap-2">
                <span className="rounded-[4px] bg-control px-1.5 text-[11px] leading-[18px] text-fg-muted">{t(`anim.params.types.${p.type}`)}</span>
                <span className="num min-w-0 flex-1 truncate text-xs text-fg-subtle">{p.key}</span>
                <span className="text-xs text-fg-subtle">{t('anim.params.usage', { count: paramUsage(doc, p.key) })}</span>
                <Button variant="ghost" size="icon-xs" aria-label={t('anim.params.remove')} title={t('anim.params.remove')} data-testid={`anim-param-remove-${p.key}`} onClick={() => trigger('animRemoveParam', { key: p.key })}>
                  <Trash size={ICON.xs} />
                </Button>
              </div>
              <Row label={t('anim.params.label')}>
                <TextField value={localized(p.label, i18n.language)} maxLength={60} label={t('anim.params.label')} testId={`anim-param-label-${p.key}`} onChange={(v) => v.trim() && trigger('animUpdateParam', { key: p.key, patch: { label: v.trim() } })} />
              </Row>
              <Row label={t('anim.params.default')}>
                <ParamDefault p={p} />
              </Row>
              {(p.type === 'number' || p.type === 'duration') && (
                <Row label={t('anim.params.range')}>
                  <div className="grid grid-cols-2 gap-[5px]">
                    <ScrubNumberField value={p.min} step={p.type === 'duration' ? 0.1 : 1} lead={t('anim.params.min')} label={t('anim.params.min')} onChange={(v) => trigger('animUpdateParam', { key: p.key, patch: { min: Math.min(v, p.default) } })} />
                    <ScrubNumberField value={p.max} step={p.type === 'duration' ? 0.1 : 1} lead={t('anim.params.max')} label={t('anim.params.max')} onChange={(v) => trigger('animUpdateParam', { key: p.key, patch: { max: Math.max(v, p.default) } })} />
                  </div>
                </Row>
              )}
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}

function DocumentSettings({ doc, resolved }: { doc: AnimationDoc; resolved: ResolvedDoc }) {
  const { t } = useTranslation();
  const fps = useProjectStore((s) => s.output.fps);
  const convert = useRegistry((s) => s.commands.animConvertToTemplate);
  const issues = useProjectStore((s) => s.template?.animation?.issues.length ?? 0);
  const duration = resolved.duration;
  return (
    <>
      <Group id="doc" title={t('anim.props.document')}>
        <Row label={t('anim.props.name')}>
          <TextField value={doc.name} maxLength={60} label={t('anim.props.name')} testId="anim-doc-name" onChange={(v) => v.trim() && editDoc((d) => void (d.name = v.trim()))} />
        </Row>
        <Row label={t('anim.props.category')}>
          <EnumField
            value={doc.category}
            label={t('anim.props.category')}
            testId="anim-doc-category"
            options={(['overlay', 'transition', 'title'] as const).map((c) => ({ value: c, label: t(`gallery.categories.${c}`) }))}
            onChange={(v) =>
              editDoc((d) => {
                d.category = v as AnimationDoc['category'];
                if (d.category === 'transition' && d.cutTime === null) d.cutTime = Math.round((docDuration(d) / 2) * 1000) / 1000;
              })
            }
          />
        </Row>
        <Row label={t('anim.props.duration')} bind={<BindButton doc={doc} target={{ kind: 'duration' }} label={t('anim.props.duration')} />}>
          <ScrubNumberField
            value={duration}
            min={0.1}
            max={30}
            step={1 / fps}
            decimals={3}
            minDecimals={2}
            unit="s"
            label={t('anim.props.duration')}
            testId="anim-doc-duration"
            onChange={(v) => setBindable(doc, { kind: 'duration' }, v, () => editDoc((d) => void (d.duration = v)))}
          />
        </Row>
        {doc.category === 'transition' && (
          <Row label={t('anim.props.cutTime')}>
            <ScrubNumberField value={doc.cutTime ?? 0} min={0} max={duration} step={1 / fps} decimals={3} minDecimals={2} unit="s" label={t('anim.props.cutTime')} onChange={(v) => editDoc((d) => void (d.cutTime = v))} />
          </Row>
        )}
        <Row label={t('anim.props.camera')}>
          <EnumField
            value={doc.camera.type}
            label={t('anim.props.camera')}
            options={[
              { value: 'ortho', label: t('anim.props.cameras.ortho') },
              { value: 'perspective', label: t('anim.props.cameras.perspective') },
            ]}
            onChange={(v) => editDoc((d) => void (d.camera = v === 'perspective' ? { type: 'perspective', fov: 30 } : { type: 'ortho' }))}
          />
        </Row>
        {doc.camera.type === 'perspective' && (
          <Row label={t('anim.props.fov')}>
            <ScrubNumberField value={doc.camera.fov} min={5} max={120} step={1} unit="°" label={t('anim.props.fov')} onChange={(v) => editDoc((d) => void (d.camera = { type: 'perspective', fov: v }))} />
          </Row>
        )}
      </Group>
      <ParamsSection doc={doc} />
      <Group id="template" title={t('anim.props.asTemplate')}>
        <p className="pb-2 text-xs leading-snug text-fg-subtle">{t('anim.props.asTemplateHint')}</p>
        <Button variant="secondary" disabled={!convert || !commandEnabled(convert) || issues > 0} onClick={() => trigger('animConvertToTemplate')} data-testid="anim-convert">
          <TreeStructure size={ICON.sm} />
          {t('anim.commands.convert')}
        </Button>
      </Group>
    </>
  );
}

function LayerContent({ doc, layer, resolvedLayer, duration }: { doc: AnimationDoc; layer: Layer; resolvedLayer: ResolvedLayer; duration: number }) {
  const { t } = useTranslation();
  const set = (patch: Record<string, unknown>) => patchLayer(layer.id, patch);
  const field = (name: FieldName, value: unknown) => setBindable(doc, { kind: 'field', layer: layer.id, field: name }, value, () => set({ [name]: value }));
  const bind = (name: FieldName, label: string) => <BindButton doc={doc} target={{ kind: 'field', layer: layer.id, field: name }} label={`${layer.name} · ${label}`} />;
  const r = resolvedLayer;
  return (
    <Group id="content" title={t('anim.props.content')} extra={t(`anim.layerTypes.${layer.type}`)}>
      <Row label={t('anim.props.name')}>
        <TextField value={layer.name} maxLength={60} label={t('anim.props.name')} testId="anim-layer-name" onChange={(v) => v.trim() && set({ name: v.trim() })} />
      </Row>
      {r.type === 'block' && (
        <>
          <Row label={t('anim.layerTypes.block')} bind={bind('block', t('anim.layerTypes.block'))}>
            <BlockPicker value={r.block} onChange={(v) => field('block', v)} label={t('anim.layerTypes.block')} testId="anim-layer-block" />
          </Row>
          <Row label={t('anim.props.size')} bind={bind('size', t('anim.props.size'))}>
            <ScrubNumberField value={r.size} min={1} max={4000} step={1} label={t('anim.props.size')} onChange={(v) => field('size', v)} />
          </Row>
        </>
      )}
      {r.type === 'item' && (
        <>
          <Row label={t('anim.layerTypes.item')} bind={bind('item', t('anim.layerTypes.item'))}>
            <ItemPicker value={r.item} onChange={(v) => field('item', v)} label={t('anim.layerTypes.item')} testId="anim-layer-item" />
          </Row>
          <Row label={t('anim.props.size')} bind={bind('size', t('anim.props.size'))}>
            <ScrubNumberField value={r.size} min={1} max={4000} step={1} label={t('anim.props.size')} onChange={(v) => field('size', v)} />
          </Row>
        </>
      )}
      {r.type === 'text' && (
        <>
          <Row label={t('anim.layerTypes.text')} bind={bind('text', t('anim.layerTypes.text'))}>
            <TextField value={r.text} multiline maxLength={500} label={t('anim.layerTypes.text')} testId="anim-layer-text" onChange={(v) => v && field('text', v)} />
          </Row>
          <Row label={t('anim.props.font')} bind={bind('font', t('anim.props.font'))}>
            <FontField value={fullFont(r.font as Partial<FontValue> | undefined)} onChange={(v) => field('font', v)} label={t('anim.props.font')} testId="anim-layer-font" />
          </Row>
          <Row label={t('anim.props.fontSize')} bind={bind('size', t('anim.props.fontSize'))}>
            <ScrubNumberField value={r.size} min={0.5} max={100} step={0.5} label={t('anim.props.fontSize')} onChange={(v) => field('size', v)} />
          </Row>
          <Row label={t('anim.props.color')} bind={bind('color', t('anim.props.color'))}>
            <ColorField value={r.color} onChange={(v) => field('color', v)} label={t('anim.props.color')} palette="chat" />
          </Row>
          <Row label={t('anim.props.shadow')}>
            <BooleanField value={r.shadow} onChange={(v) => set({ shadow: v })} label={t('anim.props.shadow')} />
          </Row>
          <Row label={t('anim.props.align')}>
            <EnumField value={r.align} label={t('anim.props.align')} options={(['left', 'center', 'right'] as const).map((a) => ({ value: a, label: t(`anim.props.aligns.${a}`) }))} onChange={(v) => set({ align: v })} />
          </Row>
        </>
      )}
      {(r.type === 'rect' || r.type === 'ellipse' || r.type === 'line') && layer.type === r.type && (
        <ShapeFields layer={layer as ShapeLayer} resolved={r} field={field} bind={bind} set={set} />
      )}
      {r.type !== 'block' && r.type !== 'group' && (
        <Row label={t('anim.props.blend')}>
          <EnumField
            value={(layer as { blend?: string }).blend ?? 'normal'}
            label={t('anim.props.blend')}
            testId="anim-layer-blend"
            options={BLEND_MODES.map((m) => ({ value: m, label: t(`anim.props.blends.${m}`) }))}
            onChange={(v) => set({ blend: v === 'normal' ? undefined : v })}
          />
        </Row>
      )}
      <Row label={t('anim.props.parent')}>
        <ParentSelect doc={doc} layer={layer} />
      </Row>
      <Row label={t('anim.props.visible')}>
        <div className="grid grid-cols-2 gap-[5px]">
          <ScrubNumberField value={layer.from ?? 0} min={0} max={duration} step={0.01} minDecimals={2} unit="s" lead={t('anim.props.from')} label={t('anim.props.from')} onChange={(v) => set({ from: v })} />
          <ScrubNumberField value={Math.min(layer.to ?? duration, duration)} min={0} max={duration} step={0.01} minDecimals={2} unit="s" lead={t('anim.props.to')} label={t('anim.props.to')} onChange={(v) => set({ to: v })} />
        </div>
      </Row>
    </Group>
  );
}

type FieldName = 'block' | 'item' | 'text' | 'color' | 'font' | 'size' | 'width' | 'height' | 'radius';
type ShapeLayer = Extract<Layer, { type: 'rect' | 'ellipse' | 'line' }>;

/** 形状（矩形、椭圆、线段）的大小、圆角、填充（纯色或渐变）、描边、线端（docs/animation-editor.md 10.12） */
function ShapeFields({
  layer,
  resolved: r,
  field,
  bind,
  set,
}: {
  layer: ShapeLayer;
  resolved: Extract<ResolvedLayer, { type: 'rect' | 'ellipse' | 'line' }>;
  field(name: FieldName, value: unknown): void;
  bind(name: FieldName, label: string): ReactNode;
  set(patch: Record<string, unknown>): void;
}) {
  const { t } = useTranslation();
  const isLine = r.type === 'line';
  const g = layer.gradient;
  const stroke = layer.type === 'line' ? undefined : layer.stroke;
  const wLabel = t(isLine ? 'anim.props.length' : 'anim.props.width');
  const hLabel = t(isLine ? 'anim.props.thickness' : 'anim.props.height');
  return (
    <>
      <Row label={wLabel} bind={bind('width', wLabel)}>
        <ScrubNumberField value={r.width} min={1} max={8000} step={1} label={wLabel} testId="anim-shape-width" onChange={(v) => field('width', v)} />
      </Row>
      <Row label={hLabel} bind={bind('height', hLabel)}>
        <ScrubNumberField value={r.height} min={isLine ? 0.5 : 1} max={isLine ? 400 : 8000} step={1} label={hLabel} onChange={(v) => field('height', v)} />
      </Row>
      {r.type === 'rect' && (
        <Row label={t('anim.props.radius')} bind={bind('radius', t('anim.props.radius'))}>
          <ScrubNumberField value={r.radius ?? 0} min={0} max={4000} step={1} label={t('anim.props.radius')} testId="anim-shape-radius" onChange={(v) => field('radius', v)} />
        </Row>
      )}
      {layer.type === 'line' && (
        <Row label={t('anim.props.cap')}>
          <EnumField value={layer.cap} label={t('anim.props.cap')} options={(['round', 'butt'] as const).map((c) => ({ value: c, label: t(`anim.props.caps.${c}`) }))} onChange={(v) => set({ cap: v })} />
        </Row>
      )}
      <Row label={t('anim.props.fill')}>
        <EnumField
          value={g ? g.type : 'solid'}
          label={t('anim.props.fill')}
          testId="anim-shape-fill"
          options={(['solid', 'linear', 'radial'] as const).map((f) => ({ value: f, label: t(`anim.props.fills.${f}`) }))}
          onChange={(v) => set({ gradient: v === 'solid' ? undefined : { type: v, from: g?.from ?? r.color, to: g?.to ?? '#FFFFFF', angle: g?.angle ?? 90 } })}
        />
      </Row>
      {g ? (
        <>
          <Row label={t('anim.props.gradientFrom')}>
            <ColorField value={g.from} onChange={(v) => set({ gradient: { ...g, from: v } })} label={t('anim.props.gradientFrom')} />
          </Row>
          <Row label={t('anim.props.gradientTo')}>
            <ColorField value={g.to} onChange={(v) => set({ gradient: { ...g, to: v } })} label={t('anim.props.gradientTo')} />
          </Row>
          {g.type === 'linear' && (
            <Row label={t('anim.props.gradientAngle')}>
              <ScrubNumberField value={g.angle} min={-360} max={360} step={1} unit="°" label={t('anim.props.gradientAngle')} onChange={(v) => set({ gradient: { ...g, angle: v } })} />
            </Row>
          )}
        </>
      ) : (
        <Row label={t('anim.props.color')} bind={bind('color', t('anim.props.color'))}>
          <ColorField value={r.color} onChange={(v) => field('color', v)} label={t('anim.props.color')} />
        </Row>
      )}
      {!isLine && (
        <>
          <Row label={t('anim.props.stroke')}>
            <Switch checked={!!stroke} onCheckedChange={(on) => set({ stroke: on ? { color: '#FFFFFF', width: 8 } : undefined })} aria-label={t('anim.props.stroke')} data-testid="anim-shape-stroke" />
          </Row>
          {stroke && (
            <Row label={t('anim.props.strokeStyle')}>
              <div className="grid grid-cols-[1fr_80px] gap-[5px]">
                <ColorField value={stroke.color} onChange={(v) => set({ stroke: { ...stroke, color: v } })} label={t('anim.props.strokeColor')} />
                <ScrubNumberField value={stroke.width} min={0.5} max={400} step={0.5} label={t('anim.props.strokeWidth')} onChange={(v) => set({ stroke: { ...stroke, width: v } })} />
              </div>
            </Row>
          )}
        </>
      )}
    </>
  );
}

function PropRow({ doc, layer, resolvedLayer, prop }: { doc: AnimationDoc; layer: Layer; resolvedLayer: ResolvedLayer; prop: AnimProp }) {
  const { t } = useTranslation();
  const time = useTransportStore((s) => s.time);
  const track = layer.props[prop];
  const animated = keysOf(track).length > 0;
  const onKey = keyIndexAt(track, time) >= 0;
  const meta = PROP_META[prop];
  const label = t(`anim.propNames.${prop}`);
  const value = propValue(resolvedLayer, prop, time, easeEval);
  // 绑定目标：没有关键帧时是这条属性的常量；有关键帧、当前时刻正好有一个时是那个关键帧的值
  const target: BindTarget | null = !animated ? { kind: 'prop', layer: layer.id, prop } : onKey ? { kind: 'key', layer: layer.id, prop, t: keysOf(track)[keyIndexAt(track, time)]!.t } : null;
  const raw = target ? readTarget(doc, target) : undefined;
  return (
    <Row
      label={label}
      testId={`anim-prop-${prop}`}
      lead={
        <button
          type="button"
          className={cn('grid size-5 shrink-0 place-items-center rounded-sm hover:bg-control', onKey ? 'text-primary' : animated ? 'text-fg-muted' : 'text-fg-subtle/60')}
          aria-label={t(onKey ? 'anim.props.removeKey' : 'anim.props.addKey', { prop: label })}
          aria-pressed={onKey}
          title={t(onKey ? 'anim.props.removeKey' : 'anim.props.addKey', { prop: label })}
          data-testid={`anim-key-toggle-${prop}`}
          onClick={() => toggleKey(layer.id, prop)}
        >
          <Diamond size={ICON.xs} weight={onKey ? 'fill' : 'regular'} />
        </button>
      }
      bind={target ? <BindButton doc={doc} target={target} label={`${layer.name} · ${label}`} /> : <span className="size-5 shrink-0" />}
    >
      <ScrubNumberField
        value={Math.round(value * 1000) / 1000}
        step={meta.step}
        {...(meta.min !== undefined ? { min: meta.min } : {})}
        {...(meta.max !== undefined ? { max: meta.max } : {})}
        {...(meta.unit ? { unit: meta.unit } : {})}
        label={label}
        testId={`anim-prop-value-${prop}`}
        onChange={(v) => (isParamRef(raw) ? trigger('animUpdateParam', { key: raw.$param, patch: { default: v } }) : setProp(layer.id, prop, v))}
      />
    </Row>
  );
}

const EASE_DEFAULT: EasingValue = 'linear';

function KeyframeSettings({ doc, layer, resolvedLayer, duration }: { doc: AnimationDoc; layer: Layer; resolvedLayer: ResolvedLayer; duration: number }) {
  const { t } = useTranslation();
  const sel = useAnimationUi((s) => s.key);
  const count = useAnimationUi((s) => s.keys.length);
  const fps = useProjectStore((s) => s.output.fps);
  if (!sel || sel.layer !== layer.id || count > 1) return null;
  const track = layer.props[sel.prop];
  const index = keyIndexAt(track, sel.t);
  const key = keysOf(track)[index];
  const rkey = keysOf(resolvedLayer.props[sel.prop])[index];
  if (!key || !rkey) return null;
  const hold = key.ease === 'hold';
  const target: BindTarget = { kind: 'key', layer: layer.id, prop: sel.prop, t: key.t };
  // 只改缓动（不经 animSetKeyframe：那会把绑定到参数的值换成数）
  const setEase = (ease: EasingValue | 'hold' | undefined) =>
    editDoc((d) => {
      const l = d.layers.find((x) => x.id === layer.id);
      const tr = l?.props[sel.prop];
      if (!l || !tr) return;
      const next = setKeyEase(tr, keyIndexAt(tr, key.t), ease === undefined ? undefined : (ease as AnimEasing));
      if (next) l.props[sel.prop] = next;
    });
  return (
    <Group id="key" title={t('anim.props.keyframe')} extra={t(`anim.propNames.${sel.prop}`)}>
      <Row label={t('anim.props.keyTime')}>
        <ScrubNumberField
          value={key.t}
          min={0}
          max={duration}
          step={1 / fps}
          decimals={3}
          minDecimals={2}
          unit="s"
          label={t('anim.props.keyTime')}
          testId="anim-key-time"
          onChange={(v) => {
            trigger('animMoveKeyframe', { layer: layer.id, prop: sel.prop, from: key.t, to: v });
            useAnimationUi.getState().select({ layer: layer.id, key: { ...sel, t: Math.round(v * 10000) / 10000 } });
          }}
        />
      </Row>
      <Row label={t('anim.props.keyValue')} bind={<BindButton doc={doc} target={target} label={`${layer.name} · ${t(`anim.propNames.${sel.prop}`)}`} />}>
        <ScrubNumberField
          value={rkey.v}
          step={PROP_META[sel.prop].step}
          label={t('anim.props.keyValue')}
          testId="anim-key-value"
          onChange={(v) => (isParamRef(key.v) ? trigger('animUpdateParam', { key: key.v.$param, patch: { default: v } }) : trigger('animSetKeyframe', { layer: layer.id, prop: sel.prop, t: key.t, v }))}
        />
      </Row>
      <Row label={t('anim.props.hold')}>
        <BooleanField value={hold} onChange={(v) => setEase(v ? 'hold' : 'linear')} label={t('anim.props.hold')} testId="anim-key-hold" />
      </Row>
      {!hold && (
        <Row label={t('anim.props.ease')}>
          <EasingField value={(key.ease as EasingValue | undefined) ?? EASE_DEFAULT} onChange={(v) => setEase(v)} label={t('anim.props.ease')} testId="anim-key-ease" />
        </Row>
      )}
      <p className="pt-1 text-xs leading-snug text-fg-subtle">{t('anim.props.easeHint')}</p>
    </Group>
  );
}

/** 选中了好几个关键帧 */
function MultiKeySettings() {
  const { t } = useTranslation();
  const count = useAnimationUi((s) => s.keys.length);
  if (count < 2) return null;
  return (
    <Group id="keys" title={t('anim.keys.selected', { count })}>
      <div className="grid grid-cols-2 gap-[5px] py-1" data-testid="anim-multi-keys">
        <Button variant="secondary" onClick={() => trigger('animAlignSelectionToPlayhead')} data-testid="anim-keys-align">
          {t('anim.commands.alignToPlayhead')}
        </Button>
        <Button variant="secondary" onClick={() => trigger('animSnapSelectionToFrames')}>
          {t('anim.commands.snapToFrames')}
        </Button>
        <Button variant="secondary" onClick={() => trigger('animCopySelection')} data-testid="anim-keys-copy">
          {t('anim.commands.copySelection')}
        </Button>
        <Button variant="secondary" onClick={() => trigger('animDeleteSelection')} data-testid="anim-keys-delete">
          {t('anim.commands.deleteSelection')}
        </Button>
      </div>
      <p className="pt-1 text-xs leading-snug text-fg-subtle">{t('anim.keys.hint')}</p>
    </Group>
  );
}

/** 选中了一个音效 */
function SoundSettings({ doc, resolved, id }: { doc: AnimationDoc; resolved: ResolvedDoc; id: string }) {
  const { t } = useTranslation();
  const fps = useProjectStore((s) => s.output.fps);
  const i = doc.sounds.findIndex((s) => s.id === id);
  const s = doc.sounds[i];
  const r = resolved.sounds[i];
  if (!s || !r) return null;
  const patch = (p: Record<string, unknown>) => trigger('animUpdateSound', { id, patch: p });
  const pos = s.position;
  return (
    <Group id="sound" title={t('anim.sounds.one')}>
      <Row label={t('anim.sounds.sound')} bind={<BindButton doc={doc} target={{ kind: 'sound', sound: id }} label={t('anim.sounds.sound')} />}>
        <SoundField value={r.sound} onChange={(v) => v && setBindable(doc, { kind: 'sound', sound: id }, v, () => patch({ sound: v }))} label={t('anim.sounds.sound')} testId="anim-sound-pick" />
      </Row>
      <Row label={t('anim.sounds.at')}>
        <ScrubNumberField value={r.at} min={0} max={resolved.duration} step={1 / fps} decimals={3} minDecimals={2} unit="s" label={t('anim.sounds.at')} testId="anim-sound-at" onChange={(v) => patch({ at: v })} />
      </Row>
      <Row label={t('anim.sounds.gain')}>
        <ScrubNumberField value={s.gain} min={0} max={2} step={0.01} fill label={t('anim.sounds.gain')} testId="anim-sound-gain" onChange={(v) => patch({ gain: v })} />
      </Row>
      <Row label={t('anim.sounds.rate')}>
        <ScrubNumberField value={s.rate ?? 1} min={0.5} max={2} step={0.01} label={t('anim.sounds.rate')} testId="anim-sound-rate" onChange={(v) => patch({ rate: v === 1 ? null : v })} />
      </Row>
      <Row label={t('anim.sounds.positional')}>
        <Switch checked={!!pos} onCheckedChange={(on) => patch({ position: on ? { x: 0, y: 0, z: -4 } : null })} aria-label={t('anim.sounds.positional')} data-testid="anim-sound-positional" />
      </Row>
      {pos && (
        <Row label={t('anim.sounds.position')}>
          <div className="grid grid-cols-3 gap-[5px]">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <ScrubNumberField key={axis} value={pos[axis]} min={-64} max={64} step={0.1} lead={axis.toUpperCase()} label={`${t('anim.sounds.position')} ${axis}`} testId={`anim-sound-pos-${axis}`} onChange={(v) => patch({ position: { ...pos, [axis]: v } })} />
            ))}
          </div>
        </Row>
      )}
      <SpatialAudioRow />
      <p className="pt-1 text-xs leading-snug text-fg-subtle">{t('anim.sounds.positionHint')}</p>
      <div className="pt-2">
        <Button variant="destructive" onClick={() => trigger('animRemoveSound', { id })} data-testid="anim-sound-remove">
          <Trash size={ICON.sm} />
          {t('anim.sounds.remove')}
        </Button>
      </div>
    </Group>
  );
}

export function AnimPropsActions() {
  const { t } = useTranslation();
  const dock = useAnimationUi((s) => s.codeOpen);
  const win = useCodeWindow((s) => s.open);
  const open = dock || win;
  return (
    <Button variant="ghost" size="icon-sm" className="text-fg-subtle" aria-label={t('anim.commands.editCode')} title={t('anim.commands.editCode')} aria-pressed={open} data-testid="anim-toggle-code" onClick={() => trigger('animEditCode')}>
      <Code size={ICON.md - 1} weight={open ? 'fill' : 'regular'} />
    </Button>
  );
}

export function AnimPropsPanel() {
  const { t } = useTranslation();
  const docs = useDocs();
  const selected = useAnimationUi((s) => s.layer);
  const sound = useAnimationUi((s) => s.sound);
  if (!docs) return null;
  const { doc, resolved } = docs;
  const index = doc.layers.findIndex((l) => l.id === selected);
  const layer = doc.layers[index] ?? null;
  const resolvedLayer = resolved.layers[index] ?? null;
  const back = (
    <div className="flex items-center gap-2 px-3.5 pb-2">
      <Button variant="ghost" size="sm" onClick={() => useAnimationUi.getState().select({ layer: null, key: null })} data-testid="anim-back-to-doc">
        {t('anim.props.backToDocument')}
      </Button>
    </div>
  );
  return (
    <EditorServicesProvider>
      <ScrollArea className="min-h-0 flex-1" data-testid="anim-props">
        {sound && doc.sounds.some((s) => s.id === sound) ? (
          <>
            {back}
            <SoundSettings doc={doc} resolved={resolved} id={sound} />
          </>
        ) : layer && resolvedLayer ? (
          <>
            {back}
            <MultiKeySettings />
            {layer.locked && (
              <div className="mx-3.5 mb-2 flex items-center gap-2 rounded-md bg-control px-2.5 py-1.5 text-xs text-fg-muted" data-testid="anim-layer-locked">
                <Lock size={ICON.sm} weight="fill" className="shrink-0" />
                <span className="min-w-0 flex-1">{t('anim.layers.lockedHint')}</span>
                <Button variant="ghost" size="sm" onClick={() => trigger('animSetLayerFlags', { layer: layer.id, locked: false })}>
                  {t('anim.layers.unlock')}
                </Button>
              </div>
            )}
            {/* 锁定的图层：内容照常显示，但不能改（inert 让里面的控件都不接收输入） */}
            <div {...(layer.locked ? { inert: true } : {})} className={cn(layer.locked && 'opacity-60')} data-testid="anim-layer-editor">
              <LayerContent doc={doc} layer={layer} resolvedLayer={resolvedLayer} duration={resolved.duration} />
              <Group id="transform" title={t('anim.props.transform')}>
                {/* progress 只在图层有路径时有意义 */}
                {ANIM_PROPS.filter((p) => p !== 'progress' || layer.path).map((p) => (
                  <PropRow key={p} doc={doc} layer={layer} resolvedLayer={resolvedLayer} prop={p} />
                ))}
              </Group>
              <KeyframeSettings doc={doc} layer={layer} resolvedLayer={resolvedLayer} duration={resolved.duration} />
              <RepeatSection layer={layer} />
              {layer.type !== 'group' && <PathSection doc={doc} layer={layer} />}
            </div>
          </>
        ) : (
          <>
            <MultiKeySettings />
            <DocumentSettings doc={doc} resolved={resolved} />
          </>
        )}
      </ScrollArea>
    </EditorServicesProvider>
  );
}
