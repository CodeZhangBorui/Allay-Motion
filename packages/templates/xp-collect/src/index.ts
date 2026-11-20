// 044 经验收集 allay.builtin.xp-collect（docs/templates/xp-collect.md）。叠加层：经验球飞向底部的经验条，条一份份涨，满了等级数字加一。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值和公式在 layout.ts。
// 经验条和等级数字照游戏的抬头显示；经验球在游戏里是世界里的实体，飞向经验条的运动是这个模板自己设计的。
import type { SetupContext, TemplateInstance, TemplateModule, TextObject } from '@allay/template-sdk';
import { overlayWindows, progress } from '../../_lib/src/timing';
import { bool, createGui, firstTexture, fontOf, num, rgbOf, str } from '../../_lib/src/gui-kit';
import {
  arrivalFraction,
  BAR_H,
  BAR_W,
  filledWidth,
  fitUnit,
  FLIGHT,
  LEVEL_COLOR,
  levelPopScale,
  ORB_ATLAS,
  ORB_ORIGINS,
  orbAlpha,
  orbCell,
  orbIconIndex,
  orbPosition,
  orbStart,
  orbTint,
  PLAIN_FILL,
  PLAIN_TRACK,
  sampleIndices,
  TICK,
  totalXp,
  xpLayout,
  xpStateAfter,
  type OrbOrigin,
  type Point,
  type XpState,
} from './layout';

/** 同一种声音最多几个 cue */
const MAX_CUES = 12;

const hex2 = (v: number): string =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0');

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.25);
    const hold = num(params.hold, 3);
    const outDuration = num(params.outDuration, 0.25);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);

    // 界面宽度放不下经验条时整体缩小（界面像素变小，版式不变）
    const G = fitUnit(stage.width, Math.max(1, num(params.guiScale, 5)));
    const guiW = stage.width / G;
    const guiH = stage.height / G;
    const gui = createGui(ctx, G);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);
    const layout = xpLayout(guiW, guiH);

    // 经验的账：一共要涨多少，分给每个球多少，第 k 个球到达之后是几级、条到哪
    const levelFrom = Math.max(0, Math.round(num(params.levelFrom, 29)));
    const levels = Math.max(0, Math.round(num(params.levels, 1)));
    const startProgress = num(params.startProgress, 0.35);
    const endProgress = num(params.endProgress, 0.2);
    const orbCount = Math.max(1, Math.round(num(params.orbs, 12)));
    const total = totalXp(levelFrom, levels, startProgress, endProgress);
    const states: XpState[] = Array.from({ length: orbCount + 1 }, (_, k) => xpStateAfter(levelFrom, startProgress, (total * k) / orbCount, levelFrom + levels));

    // 到达时刻：均匀排在停留阶段的前面一大段里，各自错开一点
    const holdStart = win.in.end;
    const jitter = ctx.random('arrive');
    const arrivals = Array.from({ length: orbCount }, (_, k) => holdStart + hold * arrivalFraction(k, orbCount, jitter.range(-0.4, 0.4)));
    // 到第 k 个球为止最近一次升级的时刻（没升过是负无穷），给“跳一下”用
    const lastLevelUp: number[] = [Number.NEGATIVE_INFINITY];
    for (let k = 1; k <= orbCount; k++) lastLevelUp.push(states[k]!.level > states[k - 1]!.level ? arrivals[k - 1]! : lastLevelUp[k - 1]!);

    // 经验条：1.20.2 起的两张单张贴图 → 旧图集 gui/icons → 两个纯色矩形
    const barBg = await ctx.resources.texture('minecraft:gui/sprites/hud/experience_bar_background', { optional: true });
    const barFg = barBg ? await ctx.resources.texture('minecraft:gui/sprites/hud/experience_bar_progress', { optional: true }) : null;
    const icons = barBg && barFg ? null : await ctx.resources.texture('minecraft:gui/icons', { optional: true });
    const track = gui.quads(1, barBg && barFg ? barBg : icons, 0);
    const fill = gui.quads(1, barBg && barFg ? barFg : icons, 0.5);
    track.rect(0, layout.barX, layout.barTop, BAR_W, BAR_H);
    if (!(barBg && barFg)) {
      if (icons) track.region(0, [0, 64, BAR_W, BAR_H]);
      else {
        track.color(0, PLAIN_TRACK);
        fill.color(0, PLAIN_FILL);
      }
    }
    track.commit();
    const drawFill = (px: number): void => {
      if (px <= 0) {
        fill.hide(0);
        return;
      }
      fill.rect(0, layout.barX, layout.barTop, px, BAR_H);
      // 裁切而不是压扁：只取进度贴图左边的 px 个像素
      if (barBg && barFg) fill.uv(0, 0, 0, px / BAR_W, 1);
      else if (icons) fill.region(0, [0, 69, px, BAR_H]);
    };

    // 等级数字：文字对象的内容不能改，所以每个会出现的等级各建一个，按当前等级切换；0 级不显示（和游戏一样）
    const levelColor = rgbOf(params.levelColor, LEVEL_COLOR);
    const levelTexts = new Map<number, TextObject>();
    for (let level = Math.max(1, levelFrom); level <= levelFrom + levels; level++) {
      const text = ctx.text.create({ text: String(level), size: G, color: levelColor, align: 'center', font: fontOf(params.levelFont) });
      gui.putText(text, layout.levelCenterX, layout.levelTop, 2);
      text.object.visible = false;
      levelTexts.set(level, text);
    }
    const levelPop = bool(params.levelPop, false);

    // 经验球：一个批次。大小按每个球分到的经验值选贴图里的那一格；没有贴图时是染了色的纯色方块
    const orbTexture = await firstTexture(ctx, ['minecraft:entity/experience/experience_orb', 'minecraft:entity/experience_orb']);
    const orbs = gui.quads(orbCount, orbTexture?.texture ?? null, 3);
    const orbSize = num(params.orbSize, 9);
    const orbOpacity = num(params.orbOpacity, 0.5);
    const cell = orbCell(orbIconIndex(Math.max(1, Math.round(total / orbCount))));
    const originParam = str(params.orbOrigin, 'around');
    const origin: OrbOrigin = (ORB_ORIGINS as readonly string[]).includes(originParam) ? (originParam as OrbOrigin) : 'around';
    const target: Point = { x: layout.targetX, y: layout.targetY };
    const rng = ctx.random('orbs');
    const flights = arrivals.map((arrive, i) => {
      if (orbTexture) orbs.region(i, cell, ORB_ATLAS);
      const flight = FLIGHT * rng.range(0.8, 1.2);
      return {
        spawn: arrive - flight,
        flight,
        start: orbStart(origin, guiW, guiH, rng.next(), rng.next(), orbSize),
        arc: rng.range(-0.12, 0.12),
        // 每个球的颜色循环从不同的相位开始（游戏里取决于它已经存在了多久）；一个循环是 4π 刻
        phaseTicks: rng.range(0, 8 * Math.PI),
      };
    });

    // 音效：每个球到达时一声拾取（音高照游戏在 0.55–1.25 之间随机），每次升级一声升级
    const gain = num(params.volume, 0.8);
    if (typeof params.pickupSound === 'string') {
      const pitch = ctx.random('pitch');
      for (const k of sampleIndices(orbCount, MAX_CUES)) ctx.audio.cue(params.pickupSound, arrivals[k]!, { gain, rate: 0.9 + (pitch.next() - pitch.next()) * 0.35 });
    }
    if (typeof params.levelupSound === 'string') {
      const ups = arrivals.filter((_, k) => states[k + 1]!.level > states[k]!.level);
      for (const k of sampleIndices(ups.length, MAX_CUES)) ctx.audio.cue(params.levelupSound, ups[k]!, { gain });
    }

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 游戏里经验条一直在；这里整体线性淡入淡出（时间窗首尾各让出一帧）
        const a = progress(t, win.in) * (1 - progress(t, win.out));

        // 已经到达了几个球 → 等级和进度。球一到就加上它那一份，条是跳过去的（游戏里也不补间）
        let arrived = 0;
        while (arrived < orbCount && arrivals[arrived]! <= t) arrived++;
        const state = states[arrived]!;
        drawFill(filledWidth(state.progress));
        fill.commit();
        track.setOpacity(a);
        fill.setOpacity(a);

        for (const [level, text] of levelTexts) {
          const current = level === state.level;
          text.object.visible = current && a > 0;
          if (!current) continue;
          text.setOpacity(a);
          text.object.scale.setScalar(levelPop ? levelPopScale(t - lastLevelUp[arrived]!) : 1);
        }

        flights.forEach((f, i) => {
          const u = (t - f.spawn) / f.flight;
          const alpha = orbAlpha(u);
          if (alpha <= 0) {
            orbs.hide(i);
            return;
          }
          const p = orbPosition(u, f.start, target, f.arc);
          orbs.rect(i, p.x - orbSize / 2, p.y - orbSize / 2, orbSize, orbSize);
          const [r, g, b] = orbTint((t - f.spawn) / TICK + f.phaseTicks);
          orbs.color(i, `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha * orbOpacity);
        });
        orbs.commit();
        orbs.setOpacity(a);
      },
      dispose() {
        track.dispose();
        fill.dispose();
        orbs.dispose();
      },
    };
  },
};

export default template;
