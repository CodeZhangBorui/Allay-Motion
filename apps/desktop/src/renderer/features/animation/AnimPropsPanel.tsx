// 右栏的“动画”标签页（docs/animation-editor.md 5.2）：没选图层时是整段动画的设置（名字、类别、时长、剪辑点、相机）和“转为模板”；
// 选了图层时是它的内容（方块、物品、文字、色块）和八个可动画属性。属性行左边的菱形是“在当前时刻加或删关键帧”；
// 有关键帧的属性改数值时自动在当前时刻落一个关键帧（After Effects 的做法）。选中的关键帧在下面单独一组：时刻、数值、缓动。
// 控件和排版沿用属性面板（packages/ui 的编辑器控件，ParamRow 的网格），不另起一套样式。
import { Button } from '@allay/ui/components/button';
import { ScrollArea } from '@allay/ui/components/misc';
import { BlockPicker, BooleanField, ColorField, EasingField, EnumField, ItemPicker, ParamGroup, ScrubNumberField, TextField, type EasingValue } from '@allay/ui/editor';
import { ICON } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { Code, Diamond, TreeStructure } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { keyIndexAt, keysOf, propValue } from '../../../shared/animation/edit';
import { ANIM_PROPS, type AnimationDoc, type AnimProp, type Layer } from '../../../shared/animation/schema';
import { commandEnabled, trigger, useRegistry } from '../../app/registry';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { EditorServicesProvider } from '../params/editorServices';
import { setProp, toggleKey } from './commands';
import { easeEval } from './easeEval';
import { editDoc } from './source';
import { useAnimationUi } from './uiState';

const PROP_META: Record<AnimProp, { step: number; unit?: string; min?: number; max?: number }> = {
  x: { step: 1 },
  y: { step: 1 },
  z: { step: 1 },
  rotX: { step: 1, unit: '°' },
  rotY: { step: 1, unit: '°' },
  rotZ: { step: 1, unit: '°' },
  scale: { step: 0.01, min: 0, max: 20 },
  opacity: { step: 0.01, min: 0, max: 1 },
};

function Row({ label, children, testId, lead }: { label: string; children: ReactNode; testId?: string; lead?: ReactNode }) {
  return (
    <div className="grid min-h-row grid-cols-[minmax(72px,30%)_1fr] items-center gap-2.5" data-testid={testId}>
      <div className="flex min-w-0 items-center gap-1 text-fg-muted">
        {lead}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0">{children}</div>
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

/** 改当前图层的一个内容字段（不是可动画属性） */
function patchLayer(id: string, patch: Record<string, unknown>): void {
  editDoc((doc) => {
    const i = doc.layers.findIndex((l) => l.id === id);
    if (i >= 0) doc.layers[i] = { ...doc.layers[i]!, ...patch } as Layer;
  });
}

function DocumentSettings({ doc }: { doc: AnimationDoc }) {
  const { t } = useTranslation();
  const fps = useProjectStore((s) => s.output.fps);
  const convert = useRegistry((s) => s.commands.animConvertToTemplate);
  const issues = useProjectStore((s) => s.template?.animation?.issues.length ?? 0);
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
                if (d.category === 'transition' && d.cutTime === null) d.cutTime = Math.round((d.duration / 2) * 1000) / 1000;
              })
            }
          />
        </Row>
        <Row label={t('anim.props.duration')}>
          <ScrubNumberField value={doc.duration} min={0.1} max={30} step={1 / fps} decimals={3} minDecimals={2} unit="s" label={t('anim.props.duration')} testId="anim-doc-duration" onChange={(v) => editDoc((d) => void (d.duration = v))} />
        </Row>
        {doc.category === 'transition' && (
          <Row label={t('anim.props.cutTime')}>
            <ScrubNumberField value={doc.cutTime ?? 0} min={0} max={doc.duration} step={1 / fps} decimals={3} minDecimals={2} unit="s" label={t('anim.props.cutTime')} onChange={(v) => editDoc((d) => void (d.cutTime = v))} />
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

function LayerContent({ layer }: { layer: Layer }) {
  const { t } = useTranslation();
  const set = (patch: Record<string, unknown>) => patchLayer(layer.id, patch);
  const duration = useProjectStore((s) => s.template?.animation?.doc.duration ?? 1);
  return (
    <Group id="content" title={t('anim.props.content')} extra={t(`anim.layerTypes.${layer.type}`)}>
      <Row label={t('anim.props.name')}>
        <TextField value={layer.name} maxLength={60} label={t('anim.props.name')} testId="anim-layer-name" onChange={(v) => v.trim() && set({ name: v.trim() })} />
      </Row>
      {layer.type === 'block' && (
        <>
          <Row label={t('anim.layerTypes.block')}>
            <BlockPicker value={layer.block} onChange={(v) => set({ block: v })} label={t('anim.layerTypes.block')} testId="anim-layer-block" />
          </Row>
          <Row label={t('anim.props.size')}>
            <ScrubNumberField value={layer.size} min={1} max={4000} step={1} label={t('anim.props.size')} onChange={(v) => set({ size: v })} />
          </Row>
        </>
      )}
      {layer.type === 'item' && (
        <>
          <Row label={t('anim.layerTypes.item')}>
            <ItemPicker value={layer.item} onChange={(v) => set({ item: v })} label={t('anim.layerTypes.item')} testId="anim-layer-item" />
          </Row>
          <Row label={t('anim.props.size')}>
            <ScrubNumberField value={layer.size} min={1} max={4000} step={1} label={t('anim.props.size')} onChange={(v) => set({ size: v })} />
          </Row>
        </>
      )}
      {layer.type === 'text' && (
        <>
          <Row label={t('anim.layerTypes.text')}>
            <TextField value={layer.text} multiline maxLength={500} label={t('anim.layerTypes.text')} testId="anim-layer-text" onChange={(v) => v && set({ text: v })} />
          </Row>
          <Row label={t('anim.props.fontSize')}>
            <ScrubNumberField value={layer.size} min={0.5} max={100} step={0.5} label={t('anim.props.fontSize')} onChange={(v) => set({ size: v })} />
          </Row>
          <Row label={t('anim.props.color')}>
            <ColorField value={layer.color} onChange={(v) => set({ color: v })} label={t('anim.props.color')} palette="chat" />
          </Row>
          <Row label={t('anim.props.shadow')}>
            <BooleanField value={layer.shadow} onChange={(v) => set({ shadow: v })} label={t('anim.props.shadow')} />
          </Row>
          <Row label={t('anim.props.align')}>
            <EnumField value={layer.align} label={t('anim.props.align')} options={(['left', 'center', 'right'] as const).map((a) => ({ value: a, label: t(`anim.props.aligns.${a}`) }))} onChange={(v) => set({ align: v })} />
          </Row>
        </>
      )}
      {layer.type === 'rect' && (
        <>
          <Row label={t('anim.props.width')}>
            <ScrubNumberField value={layer.width} min={1} max={8000} step={1} label={t('anim.props.width')} onChange={(v) => set({ width: v })} />
          </Row>
          <Row label={t('anim.props.height')}>
            <ScrubNumberField value={layer.height} min={1} max={8000} step={1} label={t('anim.props.height')} onChange={(v) => set({ height: v })} />
          </Row>
          <Row label={t('anim.props.color')}>
            <ColorField value={layer.color} onChange={(v) => set({ color: v })} label={t('anim.props.color')} />
          </Row>
        </>
      )}
      <Row label={t('anim.props.visible')}>
        <div className="grid grid-cols-2 gap-[5px]">
          <ScrubNumberField value={layer.from ?? 0} min={0} max={duration} step={0.01} minDecimals={2} unit="s" lead={t('anim.props.from')} label={t('anim.props.from')} onChange={(v) => set({ from: v })} />
          <ScrubNumberField value={Math.min(layer.to ?? duration, duration)} min={0} max={duration} step={0.01} minDecimals={2} unit="s" lead={t('anim.props.to')} label={t('anim.props.to')} onChange={(v) => set({ to: v })} />
        </div>
      </Row>
    </Group>
  );
}

function PropRow({ layer, prop }: { layer: Layer; prop: AnimProp }) {
  const { t } = useTranslation();
  const time = useTransportStore((s) => s.time);
  const track = layer.props[prop];
  const animated = keysOf(track).length > 0;
  const onKey = keyIndexAt(track, time) >= 0;
  const meta = PROP_META[prop];
  const label = t(`anim.propNames.${prop}`);
  const value = propValue(layer, prop, time, easeEval);
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
    >
      <ScrubNumberField
        value={Math.round(value * 1000) / 1000}
        step={meta.step}
        {...(meta.min !== undefined ? { min: meta.min } : {})}
        {...(meta.max !== undefined ? { max: meta.max } : {})}
        {...(meta.unit ? { unit: meta.unit } : {})}
        label={label}
        testId={`anim-prop-value-${prop}`}
        onChange={(v) => setProp(layer.id, prop, v)}
      />
    </Row>
  );
}

const EASE_DEFAULT: EasingValue = 'linear';

function KeyframeSettings({ layer }: { layer: Layer }) {
  const { t } = useTranslation();
  const sel = useAnimationUi((s) => s.key);
  const fps = useProjectStore((s) => s.output.fps);
  const duration = useProjectStore((s) => s.template?.animation?.doc.duration ?? 1);
  if (!sel || sel.layer !== layer.id) return null;
  const track = layer.props[sel.prop];
  const index = keyIndexAt(track, sel.t);
  const key = keysOf(track)[index];
  if (!key) return null;
  const hold = key.ease === 'hold';
  const setEase = (ease: EasingValue | 'hold' | undefined) => trigger('animSetKeyframe', { layer: layer.id, prop: sel.prop, t: key.t, v: key.v, ease: ease ?? 'linear' });
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
      <Row label={t('anim.props.keyValue')}>
        <ScrubNumberField value={key.v} step={PROP_META[sel.prop].step} label={t('anim.props.keyValue')} testId="anim-key-value" onChange={(v) => trigger('animSetKeyframe', { layer: layer.id, prop: sel.prop, t: key.t, v })} />
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

export function AnimPropsActions() {
  const { t } = useTranslation();
  const open = useAnimationUi((s) => s.codeOpen);
  return (
    <Button variant="ghost" size="icon-sm" className="text-fg-subtle" aria-label={t('anim.commands.toggleCode')} title={t('anim.commands.toggleCode')} aria-pressed={open} data-testid="anim-toggle-code" onClick={() => trigger('animToggleCode')}>
      <Code size={ICON.md - 1} weight={open ? 'fill' : 'regular'} />
    </Button>
  );
}

export function AnimPropsPanel() {
  const { t } = useTranslation();
  const doc = useProjectStore((s) => s.template?.animation?.doc ?? null);
  const selected = useAnimationUi((s) => s.layer);
  if (!doc) return null;
  const layer = doc.layers.find((l) => l.id === selected) ?? null;
  return (
    <EditorServicesProvider>
      <ScrollArea className="min-h-0 flex-1" data-testid="anim-props">
        {layer ? (
          <>
            <div className="flex items-center gap-2 px-3.5 pb-2">
              <Button variant="ghost" size="sm" onClick={() => useAnimationUi.getState().select({ layer: null, key: null })} data-testid="anim-back-to-doc">
                {t('anim.props.backToDocument')}
              </Button>
            </div>
            <LayerContent layer={layer} />
            <Group id="transform" title={t('anim.props.transform')}>
              {ANIM_PROPS.map((p) => (
                <PropRow key={p} layer={layer} prop={p} />
              ))}
            </Group>
            <KeyframeSettings layer={layer} />
          </>
        ) : (
          <DocumentSettings doc={doc} />
        )}
      </ScrollArea>
    </EditorServicesProvider>
  );
}
