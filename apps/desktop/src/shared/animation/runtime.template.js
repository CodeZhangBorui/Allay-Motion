// 动画文档的解释器（docs/animation-editor.md 第 4 节）。这个文件以文本原样嵌进生成的 template.js（compile.ts），
// 在引擎 Worker 里和任何模板一样运行：只用 ctx 给的公开接口，不 import，不读真实时间，不用 Math.random（硬性规则 2、3、5）。
// update(t) 不分配内存：所有对象在 setup 里建好，每帧只按 t 插值、写矩阵和不透明度。
// 改这里要同时看 schema.ts 的格式和 tests/unit/T-ANIM-1.animation-doc.test.ts（T-ANIM-2 部分）。

/**
 * 把绑定到参数的值换成取值（第 2 版）。规则与 shared/animation/resolve.ts 的 resolveDoc 相同（T-ANIM-11 核对）：
 * {"$param": 键} 换成 ctx.params 里的值（没有就是参数的默认值）；整段时长绑定到 duration 参数时所有时刻等比伸缩。
 * @param {any} doc
 * @param {Record<string, unknown>} values
 */
function resolveAnimation(doc, values) {
  const params = new Map((doc.params || []).map((p) => [p.key, p]));
  const isRef = (x) => typeof x === 'object' && x !== null && !Array.isArray(x) && typeof x.$param === 'string';
  const valueOf = (p) => {
    const v = values[p.key];
    if (v === undefined || v === null) return p.default;
    if (p.type === 'number' || p.type === 'duration') return typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
    if (p.type === 'font') return typeof v === 'object' && !Array.isArray(v) && typeof v.family === 'string' ? v : p.default;
    return typeof v === 'string' && v !== '' ? v : p.default;
  };
  const sub = (x) => {
    if (isRef(x)) {
      const p = params.get(x.$param);
      return p ? valueOf(p) : undefined;
    }
    if (Array.isArray(x)) return x.map(sub);
    if (typeof x === 'object' && x !== null) {
      const o = {};
      for (const k of Object.keys(x)) if (k !== 'params') o[k] = sub(x[k]);
      return o;
    }
    return x;
  };
  const out = sub(doc);
  let scale = 1;
  if (isRef(doc.duration)) {
    const p = params.get(doc.duration.$param);
    if (p && p.type === 'duration' && p.default > 0) scale = out.duration / p.default;
  }
  if (scale !== 1) {
    if (out.cutTime !== null && out.cutTime !== undefined) out.cutTime *= scale;
    for (const s of out.sounds || []) s.at *= scale;
    for (const l of out.layers || []) {
      if (typeof l.from === 'number') l.from *= scale;
      if (typeof l.to === 'number') l.to *= scale;
      for (const p of Object.keys(l.props || {})) {
        const tr = l.props[p];
        if (tr && typeof tr === 'object' && Array.isArray(tr.keys)) for (const k of tr.keys) k.t *= scale;
      }
    }
  }
  return out;
}

// 这个文件单独看时 createAnimation 没有被用到：生成的 template.js 在它后面调用它（compile.ts）
/**
 * @param {import('./template-api').SetupContext} ctx
 * @param {any} doc 已按 AnimationDocSchema 校验过的动画文档
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createAnimation(ctx, source) {
  const { THREE, scene } = ctx;
  const doc = resolveAnimation(source, ctx.params || {});
  const PROPS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scale', 'opacity', 'progress'];
  const DEFAULTS = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1, opacity: 1, progress: 0 };
  const DEG = Math.PI / 180;
  const duration = doc.duration;

  if (doc.camera && doc.camera.type === 'perspective') ctx.setCamera(ctx.createStageCamera({ fov: doc.camera.fov }));

  /** 一条轨道变成 { times, values, eases }；常量只有一个值 */
  function compileTrack(track, fallback) {
    if (typeof track === 'number') return { times: [0], values: [track], eases: [null], hold: [false] };
    if (!track || !Array.isArray(track.keys) || track.keys.length === 0) return { times: [0], values: [fallback], eases: [null], hold: [false] };
    const keys = track.keys;
    return {
      times: keys.map((k) => k.t),
      values: keys.map((k) => k.v),
      eases: keys.map((k) => (k.ease === undefined || k.ease === 'hold' ? null : ctx.ease.from(k.ease))),
      hold: keys.map((k) => k.ease === 'hold'),
    };
  }

  /** 按 t 求一条轨道的值（关键帧之前取第一个值，之后取最后一个值） */
  function sample(tr, t) {
    const n = tr.times.length;
    if (n === 1 || t <= tr.times[0]) return tr.values[0];
    if (t >= tr.times[n - 1]) return tr.values[n - 1];
    let i = 0;
    while (i < n - 2 && t >= tr.times[i + 1]) i++;
    const a = tr.values[i];
    if (tr.hold[i]) return a;
    const p = (t - tr.times[i]) / (tr.times[i + 1] - tr.times[i]);
    const e = tr.eases[i];
    return a + (tr.values[i + 1] - a) * (e ? e(p) : p);
  }

  const position = new THREE.Vector3();
  const euler = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scaleV = new THREE.Vector3();
  /** 交给图层对象的矩阵：世界变换 × 图层自己的大小（大小不传给子图层） */
  const matrix = new THREE.Matrix4();
  const unitM = new THREE.Matrix4();
  const disposables = [];
  // 有图层独显时只画独显的图层和它们的子图层（父级的变换照常起作用）
  const anySolo = doc.layers.some((l) => l.solo === true);

  /** 把对象里的材质换成自己的副本并打开透明，按图层单独改不透明度（不碰引擎缓存里的共享材质） */
  function ownMaterials(object) {
    const mats = [];
    object.traverse((o) => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const copies = list.map((m) => {
        const c = m.clone();
        c.transparent = true;
        disposables.push(c);
        mats.push({ material: c, base: typeof m.opacity === 'number' ? m.opacity : 1 });
        return c;
      });
      o.material = Array.isArray(o.material) ? copies : copies[0];
    });
    return mats;
  }

  /**
   * 方块排列（第三轮复制器）：网格的每一格放方块列表里的第几项。与模板 block-wipe / block-fall 的 arrangement.ts 规则相同
   * （T-ANIM-26 核对），这里不能 import，只好再写一份。
   */
  function arrangeCells(arrangement, entries, cols, rows, rng) {
    const count = cols * rows;
    const out = new Array(count).fill(0);
    const n = entries.length;
    if (arrangement === 'random') {
      const total = entries.reduce((a, e) => a + e.weight, 0);
      for (let i = 0; i < count; i++) {
        let x = rng.next() * total;
        let k = n - 1;
        for (let j = 0; j < n; j++) {
          x -= entries[j].weight;
          if (x < 0) {
            k = j;
            break;
          }
        }
        out[i] = Math.max(0, k);
      }
      return out;
    }
    if (n <= 1) return out;
    if (arrangement === 'checker') {
      const shift = Math.floor(n / 2);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = (c + r * shift) % n;
      return out;
    }
    const total = entries.reduce((a, e) => a + e.weight, 0);
    const bandEntry = (band) => {
      if (!(total > 0)) return 0;
      let x = (band + 0.5) % total;
      for (let j = 0; j < n; j++) {
        x -= entries[j].weight;
        if (x < 0) return j;
      }
      return n - 1;
    };
    const cc = (cols - 1) / 2;
    const rc = (rows - 1) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let band;
        if (arrangement === 'columns') band = c;
        else if (arrangement === 'rows') band = r;
        else if (arrangement === 'diagonal') band = c + r;
        else band = Math.floor(Math.hypot(c - cc, r - rc) + 1e-9);
        out[r * cols + c] = bandEntry(band);
      }
    }
    return out;
  }

  /**
   * 一个图层的每一份：相对图层自己的偏移矩阵、晚开始的秒数、方块列表里的第几项。没有复制器时只有一份（单位矩阵、0、0）。
   * 随机都来自 ctx.random('repeat:<id>:<seed>')，按固定的顺序取，同一份文档每次结果相同。
   */
  /** 名次：按序号、倒序、离中心由近到远（同样远的同一名次）、随机；每一份晚 名次 × stagger 秒 */
  function rankCopies(list, order, stagger, rng) {
    const n = list.length;
    let ranks;
    if (order === 'reverse') ranks = list.map((_, i) => n - 1 - i);
    else if (order === 'center') {
      const levels = [...new Set(list.map((p) => Math.round(p.dist * 1000) / 1000))].sort((a, b) => a - b);
      ranks = list.map((p) => levels.indexOf(Math.round(p.dist * 1000) / 1000));
    } else if (order === 'random') {
      const idx = list.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const tmp = idx[i];
        idx[i] = idx[j];
        idx[j] = tmp;
      }
      ranks = new Array(n);
      idx.forEach((v, rank) => (ranks[v] = rank));
    } else ranks = list.map((_, i) => i);
    for (let i = 0; i < n; i++) list[i].delay = ranks[i] * stagger;
  }

  function disposeObject(object) {
    object.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
  }
  const textOptions = (def, text) => ({ text, size: def.size, color: def.color, shadow: def.shadow, align: 'center', ...(def.font ? { font: def.font } : {}) });

  /**
   * 逐字动画（第三轮）：每个字（空格除外）一份，摆在它在整段文字里的位置，按名次错开播放图层自己的动画。
   * 字宽用 ctx.text.create 量（量完就释放）：一个字的宽 w、两个字之间的间隔 = 宽("aa") − 2·宽("a")、
   * 空格的步长 = 宽("a a") − 宽("aa")、行距 = 高("a\na") − 高("a")。与整段排出来的位置可能差半个字体像素。最多 256 个字
   */
  function charCopies(def) {
    const cache = new Map();
    const measure = (text) => {
      let m = cache.get(text);
      if (!m) {
        const o = ctx.text.create(textOptions(def, text));
        m = { w: o.width, h: o.height };
        disposeObject(o.object);
        cache.set(text, m);
      }
      return m;
    };
    const lines = def.text.split('\n').map((l) => Array.from(l));
    const probe = lines.flat().find((c) => c.trim() !== '');
    if (!probe) return [];
    const wp = measure(probe).w;
    const gap = measure(probe + probe).w - 2 * wp;
    const spaceStep = measure(probe + ' ' + probe).w - measure(probe + probe).w;
    const lineStep = lines.length > 1 ? measure(probe + '\n' + probe).h - measure(probe).h : 0;
    const list = [];
    const stepsOf = (chars) => chars.map((c) => (c.trim() === '' ? spaceStep : measure(c).w + gap));
    const widthOf = (chars, steps) => steps.reduce((a, b) => a + b, 0) - (chars.length > 0 && chars[chars.length - 1].trim() !== '' ? gap : 0);
    // 整段的宽是最宽的一行；居中时每行相对整段左边的偏移取整到字体像素（同引擎的位图文字）
    const full = Math.max(0, ...lines.map((chars) => widthOf(chars, stepsOf(chars))));
    lines.forEach((chars, li) => {
      const steps = stepsOf(chars);
      const width = widthOf(chars, steps);
      const left = def.align === 'left' ? 0 : def.align === 'right' ? -width : -full / 2 + Math.floor((full - width) / 2 / def.size + 1e-9) * def.size;
      const y = ((lines.length - 1) / 2 - li) * lineStep;
      let x = left;
      chars.forEach((c, k) => {
        if (c.trim() !== '' && list.length < MAX_CHARS) {
          const offset = new THREE.Matrix4().makeTranslation(x + measure(c).w / 2, y, 0);
          list.push({ offset, delay: 0, block: 0, dist: 0, i: list.length, char: c });
        }
        x += steps[k];
      });
    });
    const n = list.length;
    for (const c of list) c.dist = Math.abs(c.i - (n - 1) / 2);
    rankCopies(list, def.chars.order, def.chars.stagger, ctx.random(`chars:${def.id}:${def.chars.seed}`));
    return list;
  }
  const MAX_CHARS = 256;

  function copiesOf(def) {
    if (def.type === 'text' && def.chars) return charCopies(def);
    const rep = def.repeat;
    if (!rep) return [{ offset: new THREE.Matrix4(), delay: 0, block: 0 }];
    const rng = ctx.random(`repeat:${def.id}:${rep.seed}`);
    const cols = rep.mode === 'grid' ? rep.cols : rep.count;
    const rows = rep.mode === 'grid' ? rep.rows : 1;
    const n = cols * rows;
    const list = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      let x;
      let y;
      let rot = 0;
      let dist;
      if (rep.mode === 'grid') {
        x = (c - (cols - 1) / 2) * rep.spacing.x;
        y = ((rows - 1) / 2 - r) * rep.spacing.y;
        dist = Math.hypot(c - (cols - 1) / 2, r - (rows - 1) / 2);
      } else if (rep.mode === 'linear') {
        x = i * rep.spacing.x;
        y = i * rep.spacing.y;
        dist = Math.abs(i - (n - 1) / 2);
      } else {
        // 一圈：整圈时均匀分 n 份；不到整圈时首尾都放一份
        const step = rep.arc >= 360 ? rep.arc / n : n > 1 ? rep.arc / (n - 1) : 0;
        const a = (90 - i * step) * DEG;
        x = Math.cos(a) * rep.radius;
        y = Math.sin(a) * rep.radius;
        rot = rep.orient ? -i * step : 0;
        dist = i;
      }
      let s = 1;
      if (rep.jitter) {
        x += (rng.next() * 2 - 1) * rep.jitter.x;
        y += (rng.next() * 2 - 1) * rep.jitter.y;
        rot += (rng.next() * 2 - 1) * rep.jitter.rot;
        s *= 1 + (rng.next() * 2 - 1) * rep.jitter.scale;
      }
      const offset = new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rot * DEG), new THREE.Vector3(s, s, s));
      list.push({ offset, delay: 0, block: 0, dist, i });
    }
    rankCopies(list, rep.order, rep.stagger, rng);
    if (def.type === 'block' && rep.blocks) {
      const cells = arrangeCells(rep.arrangement || 'random', rep.blocks, cols, rows, rng);
      for (let i = 0; i < n; i++) list[i].block = cells[i];
    }
    return list;
  }

  // ---- 形状（第三轮）：圆角矩形、椭圆、线段；纯色或渐变填充、描边；混合方式（docs/animation-editor.md 4.6）----
  function boxPath(path, w, h, r) {
    const x = -w / 2;
    const y = -h / 2;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r <= 0) {
      path.moveTo(x, y);
      path.lineTo(x + w, y);
      path.lineTo(x + w, y + h);
      path.lineTo(x, y + h);
      path.lineTo(x, y);
      return path;
    }
    const H = Math.PI / 2;
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y);
    path.absarc(x + w - r, y + r, r, -H, 0, false);
    path.lineTo(x + w, y + h - r);
    path.absarc(x + w - r, y + h - r, r, 0, H, false);
    path.lineTo(x + r, y + h);
    path.absarc(x + r, y + h - r, r, H, 2 * H, false);
    path.lineTo(x, y + r);
    path.absarc(x + r, y + r, r, 2 * H, 3 * H, false);
    return path;
  }
  /** 形状的轮廓，inset 是往里缩多少（描边的内圈）；缩没了返回 null */
  function outline(def, inset, Ctor) {
    const w = def.width - 2 * inset;
    const h = def.height - 2 * inset;
    if (w <= 0 || h <= 0) return null;
    const p = new Ctor();
    if (def.type === 'ellipse') p.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
    else if (def.type === 'line') boxPath(p, w, h, def.cap === 'round' ? h / 2 : 0);
    else boxPath(p, w, h, (def.radius || 0) - inset);
    return p;
  }
  /** ShapeGeometry 的 uv 是顶点坐标，换成外框里的 0–1（渐变贴图按外框铺） */
  function boxUv(geometry, w, h) {
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    uv.needsUpdate = true;
  }
  const hexBytes = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  /** 渐变贴图（sRGB，64×64，按外框铺；线性插值在贴图里做） */
  function gradientTexture(g, w, h) {
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    const a = hexBytes(g.from);
    const b = hexBytes(g.to);
    const ang = g.angle * DEG;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy) || 1;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N - 0.5) * w;
        const y = ((j + 0.5) / N - 0.5) * h;
        let f = g.type === 'radial' ? Math.hypot(x / (w / 2), y / (h / 2)) : ((x * dx + y * dy) / half + 1) / 2;
        f = Math.min(1, Math.max(0, f));
        const o = (j * N + i) * 4;
        for (let c = 0; c < 3; c++) data[o + c] = Math.round(a[c] + (b[c] - a[c]) * f);
        data[o + 3] = 255;
      }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    disposables.push(tex);
    return tex;
  }
  /**
   * 混合方式。画面缓冲是线性、预乘 alpha 的，所以材质改成输出预乘的颜色（premultipliedAlpha），颜色按：
   * 相加 src + dst；相乘 src·dst + dst·(1 − a)；滤色 src·(1 − dst) + dst。alpha 一律按普通叠加（a + dst·(1 − a)）。
   */
  function applyBlend(material, mode) {
    if (!mode || mode === 'normal') return;
    material.premultipliedAlpha = true;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    if (mode === 'add') {
      material.blendSrc = THREE.OneFactor;
      material.blendDst = THREE.OneFactor;
    } else if (mode === 'multiply') {
      material.blendSrc = THREE.DstColorFactor;
      material.blendDst = THREE.OneMinusSrcAlphaFactor;
    } else {
      material.blendSrc = THREE.OneMinusDstColorFactor;
      material.blendDst = THREE.OneFactor;
    }
    material.needsUpdate = true;
  }
  function blendObject(object, mode) {
    if (!mode || mode === 'normal') return;
    object.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) applyBlend(m, mode);
    });
  }
  /** 形状：填充一个网格，有描边时再一个（环形，画在填充上面） */
  function shapeMeshes(def, index, holder) {
    const mats = [];
    const add = (shape, color, gradient, order) => {
      const geometry = new THREE.ShapeGeometry(shape, 16);
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(gradient ? '#FFFFFF' : color), transparent: true, depthWrite: false });
      if (gradient) {
        boxUv(geometry, def.width, def.height);
        material.map = gradientTexture(gradient, def.width, def.height);
      }
      applyBlend(material, def.blend);
      disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = order;
      holder.add(mesh);
      mats.push(material);
    };
    const stroke = def.type === 'line' ? null : def.stroke;
    add(outline(def, 0, THREE.Shape), def.color, def.gradient, index);
    if (stroke) {
      const ring = outline(def, 0, THREE.Shape);
      const inner = outline(def, stroke.width, THREE.Path);
      if (inner) ring.holes.push(inner);
      add(ring, stroke.color, null, index + 0.5);
    }
    return (o) => {
      for (const m of mats) m.opacity = o;
    };
  }

  /** 每一份的画法：apply(可见, 不透明度, 矩阵) */
  async function drawsOf(def, index, copies) {
    if (def.type === 'group') return { draws: copies.map(() => ({ apply: () => undefined })), commit: () => undefined, unit: 1 };
    if (def.type === 'block') {
      const ids = def.repeat && def.repeat.blocks ? def.repeat.blocks.map((b) => b.id) : [def.block];
      // 同一种方块的各份共用一组实例
      const groups = new Map();
      copies.forEach((c, i) => {
        const id = ids[c.block] || ids[0];
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(i);
      });
      const draws = new Array(copies.length);
      const insts = [];
      for (const [id, members] of groups) {
        const inst = (await ctx.resources.block(id)).instanced(members.length);
        const holder = new THREE.Object3D();
        holder.renderOrder = index;
        holder.add(inst.object);
        scene.add(holder);
        // 这一组里有没有可见的份：没有时整组不画（commit 时写到 object.visible）
        const group = { inst, any: false };
        insts.push(group);
        members.forEach((copy, k) => {
          draws[copy] = {
            apply: (visible, opacity, m) => {
              group.any = group.any || visible;
              // 一份不可见时把它缩成一个点（实例没有单独的可见开关）
              if (visible) inst.setMatrix(k, m);
              else inst.setMatrix(k, zero);
              inst.setOpacity(k, visible ? opacity : 0);
            },
          };
        });
      }
      const commit = () => {
        for (const g of insts) {
          g.inst.object.visible = g.any;
          g.any = false;
          g.inst.commit();
        }
      };
      return { draws, commit, unit: def.size };
    }
    const draws = [];
    for (let i = 0; i < copies.length; i++) {
      const holder = new THREE.Object3D();
      holder.renderOrder = index;
      let setOpacity;
      if (def.type === 'item') {
        const obj = (await ctx.resources.item(def.item)).single();
        const mats = ownMaterials(obj);
        for (const m of mats) applyBlend(m.material, def.blend);
        holder.add(obj);
        setOpacity = (o) => {
          for (const m of mats) m.material.opacity = m.base * o;
        };
      } else if (def.type === 'text') {
        // 逐字时每一份是一个字（居中放在它的位置上）
        const text = copies[i].char !== undefined ? ctx.text.create(textOptions(def, copies[i].char)) : ctx.text.create({ ...textOptions(def, def.text), align: def.align });
        blendObject(text.object, def.blend);
        holder.add(text.object);
        setOpacity = (o) => text.setOpacity(o);
      } else if (def.type === 'image') {
        // 图片（第三轮）：没选图片时不画
        if (def.image) {
          const tex = await ctx.resources.texture(def.image);
          const sprite = ctx.sprite.create(tex, def.nineSlice ? { nineSlice: def.nineSlice, pixelSize: def.pixelSize } : { pixelSize: def.pixelSize });
          sprite.setSize(def.width, def.height);
          blendObject(sprite.object, def.blend);
          holder.add(sprite.object);
          setOpacity = (o) => sprite.setOpacity(o);
        } else setOpacity = () => undefined;
      } else {
        setOpacity = shapeMeshes(def, index, holder);
      }
      holder.matrixAutoUpdate = false;
      scene.add(holder);
      draws.push({
        apply: (visible, opacity, m) => {
          holder.visible = visible;
          holder.matrix.copy(m);
          holder.matrixWorldNeedsUpdate = true;
          setOpacity(opacity);
        },
      });
    }
    return { draws, commit: () => undefined, unit: def.type === 'item' ? def.size : 1 };
  }

  // ---- 路径动画（第三轮）：与 shared/animation/path.ts 规则相同（T-ANIM-28 核对）----
  const PATH_STEPS = 32;
  const cubicAt = (a, b, c, d, u) => {
    const v = 1 - u;
    return { x: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x, y: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y };
  };
  const pathSegment = (path, i) => {
    const n = path.points.length;
    const a = path.points[i];
    const b = path.points[(i + 1) % n];
    return [a, { x: a.x + (a.out ? a.out.x : 0), y: a.y + (a.out ? a.out.y : 0) }, { x: b.x + (b.in ? b.in.x : 0), y: b.y + (b.in ? b.in.y : 0) }, b];
  };
  function pathTable(path) {
    const count = path.closed ? path.points.length : path.points.length - 1;
    const lengths = [0];
    const seg = [0];
    const us = [0];
    let prev = path.points[0];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const [a, b, c, d] = pathSegment(path, i);
      for (let k = 1; k <= PATH_STEPS; k++) {
        const p = cubicAt(a, b, c, d, k / PATH_STEPS);
        total += Math.hypot(p.x - prev.x, p.y - prev.y);
        lengths.push(total);
        seg.push(i);
        us.push(k / PATH_STEPS);
        prev = p;
      }
    }
    return { path, lengths, seg, u: us, total, out: { x: 0, y: 0, angle: 0 } };
  }
  /** progress 处的位置和切线方向（度），写进 table.out（不分配） */
  function pathAt(table, progress) {
    const target = Math.min(1, Math.max(0, progress)) * table.total;
    const L = table.lengths;
    let lo = 0;
    let hi = L.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (L[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const j = Math.max(1, lo);
    const span = L[j] - L[j - 1] || 1;
    const f = (target - L[j - 1]) / span;
    const s = table.seg[j];
    const u0 = table.seg[j - 1] === s ? table.u[j - 1] : 0;
    const u = u0 + (table.u[j] - u0) * f;
    const [a, b, c, d] = pathSegment(table.path, s);
    const p = cubicAt(a, b, c, d, u);
    const q = cubicAt(a, b, c, d, Math.min(1, u + 1e-3));
    const r = cubicAt(a, b, c, d, Math.max(0, u - 1e-3));
    table.out.x = p.x;
    table.out.y = p.y;
    table.out.angle = (Math.atan2(q.y - r.y, q.x - r.x) * 180) / Math.PI;
    return table.out;
  }

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const layers = [];
  for (let index = 0; index < doc.layers.length; index++) {
    const def = doc.layers[index];
    const tracks = {};
    for (const p of PROPS) tracks[p] = compileTrack(def.props ? def.props[p] : undefined, DEFAULTS[p]);
    const copies = copiesOf(def);
    const built = await drawsOf(def, index, copies);
    layers.push({
      def,
      tracks,
      copies,
      draws: built.draws,
      commit: built.commit,
      unit: built.unit,
      from: typeof def.from === 'number' ? def.from : 0,
      to: typeof def.to === 'number' ? def.to : Infinity,
      parent: -1,
      /** 世界变换（不含图层自己的大小、不含复制器的偏移）、可见、不透明度：子图层从这里接着算 */
      world: new THREE.Matrix4(),
      visible: false,
      opacity: 1,
      solo: def.solo === true,
      path: def.path ? pathTable(def.path) : null,
    });
  }

  // 父子层级：父级先算。按依赖排一个顺序（schema 已经保证没有环、父级存在）
  const byId = new Map(layers.map((l, i) => [l.def.id, i]));
  for (const l of layers) l.parent = typeof l.def.parent === 'string' && byId.has(l.def.parent) ? byId.get(l.def.parent) : -1;
  const order = [];
  const placed = new Array(layers.length).fill(false);
  const place = (i, depth) => {
    if (placed[i] || depth > layers.length) return;
    const pi = layers[i].parent;
    if (pi >= 0) place(pi, depth + 1);
    placed[i] = true;
    order.push(i);
  };
  for (let i = 0; i < layers.length; i++) place(i, 0);
  // 独显：自己或某个祖先独显
  for (const i of order) {
    const l = layers[i];
    l.solo = l.solo || (l.parent >= 0 && layers[l.parent].solo);
  }

  for (const s of doc.sounds || []) {
    const opts = { gain: s.gain };
    if (typeof s.rate === 'number') opts.rate = s.rate;
    if (s.position) opts.position = { x: s.position.x, y: s.position.y, z: s.position.z };
    ctx.audio.cue(s.sound, s.at, opts);
  }

  const local = new THREE.Matrix4();
  const copyM = new THREE.Matrix4();
  /** 图层自己在 tt 时刻的局部变换（不含大小）写进 out */
  function localAt(l, tt, out) {
    const tr = l.tracks;
    const s = sample(tr.scale, tt);
    let px = 0;
    let py = 0;
    let pa = 0;
    if (l.path) {
      // 路径：位置是路径上的点加上 x、y 的偏移；自动朝向时 rotZ 加上切线方向
      const at = pathAt(l.path, sample(tr.progress, tt));
      px = at.x;
      py = at.y;
      if (l.def.path.orient) pa = at.angle;
    }
    position.set(sample(tr.x, tt) + px, sample(tr.y, tt) + py, sample(tr.z, tt));
    euler.set(sample(tr.rotX, tt) * DEG, sample(tr.rotY, tt) * DEG, (sample(tr.rotZ, tt) + pa) * DEG, 'YXZ');
    quaternion.setFromEuler(euler);
    scaleV.set(s, s, s);
    return out.compose(position, quaternion, scaleV);
  }

  return {
    duration,
    cutTime: doc.cutTime === undefined ? null : doc.cutTime,
    update(t) {
      for (let k = 0; k < order.length; k++) {
        const l = layers[order[k]];
        const parent = l.parent >= 0 ? layers[l.parent] : null;
        const parentOpacity = parent ? parent.opacity : 1;
        const parentVisible = parent ? parent.visible : true;
        // 子图层接在图层本身（第 0 份、不晚开始、不加复制器偏移）的变换后面
        localAt(l, t, l.world);
        if (parent) l.world.premultiply(parent.world);
        l.opacity = Math.min(1, Math.max(0, sample(l.tracks.opacity, t))) * parentOpacity;
        l.visible = t >= l.from && t < l.to && l.def.hidden !== true && parentVisible;
        const shown = !anySolo || l.solo;
        unitM.makeScale(l.unit, l.unit, l.unit);
        for (let i = 0; i < l.copies.length; i++) {
          const c = l.copies[i];
          // 每一份晚 delay 秒播放图层自己的动画；它的可见区间也跟着晚
          const tt = t - c.delay;
          const opacity = Math.min(1, Math.max(0, sample(l.tracks.opacity, tt))) * parentOpacity;
          const inside = tt >= l.from && tt < l.to && l.def.hidden !== true && parentVisible;
          localAt(l, tt, local);
          // 世界 = 父级 · 复制器偏移 · 图层自己 · 大小
          copyM.multiplyMatrices(c.offset, local);
          if (parent) copyM.premultiply(parent.world);
          matrix.multiplyMatrices(copyM, unitM);
          l.draws[i].apply(inside && opacity > 0 && shown, opacity, matrix);
        }
        l.commit();
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
