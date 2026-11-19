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
  const PROPS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scale', 'opacity'];
  const DEFAULTS = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1, opacity: 1 };
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
  function copiesOf(def) {
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
    // 名次：按序号、倒序、离中心由近到远（同样远的同一名次）、随机
    let ranks;
    if (rep.order === 'reverse') ranks = list.map((_, i) => n - 1 - i);
    else if (rep.order === 'center') {
      const levels = [...new Set(list.map((p) => Math.round(p.dist * 1000) / 1000))].sort((a, b) => a - b);
      ranks = list.map((p) => levels.indexOf(Math.round(p.dist * 1000) / 1000));
    } else if (rep.order === 'random') {
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
    for (let i = 0; i < n; i++) list[i].delay = ranks[i] * rep.stagger;
    if (def.type === 'block' && rep.blocks) {
      const cells = arrangeCells(rep.arrangement || 'random', rep.blocks, cols, rows, rng);
      for (let i = 0; i < n; i++) list[i].block = cells[i];
    }
    return list;
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
        holder.add(obj);
        setOpacity = (o) => {
          for (const m of mats) m.material.opacity = m.base * o;
        };
      } else if (def.type === 'text') {
        const text = ctx.text.create({ text: def.text, size: def.size, color: def.color, shadow: def.shadow, align: def.align, ...(def.font ? { font: def.font } : {}) });
        holder.add(text.object);
        setOpacity = (o) => text.setOpacity(o);
      } else {
        const geometry = new THREE.PlaneGeometry(def.width, def.height);
        const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color), transparent: true, depthWrite: false });
        disposables.push(geometry, material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = index;
        holder.add(mesh);
        setOpacity = (o) => {
          material.opacity = o;
        };
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
    position.set(sample(tr.x, tt), sample(tr.y, tt), sample(tr.z, tt));
    euler.set(sample(tr.rotX, tt) * DEG, sample(tr.rotY, tt) * DEG, sample(tr.rotZ, tt) * DEG, 'YXZ');
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
