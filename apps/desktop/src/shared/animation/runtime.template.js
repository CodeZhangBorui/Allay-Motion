// 动画文档的解释器（docs/animation-editor.md 第 4 节）。这个文件以文本原样嵌进生成的 template.js（compile.ts），
// 在引擎 Worker 里和任何模板一样运行：只用 ctx 给的公开接口，不 import，不读真实时间，不用 Math.random（硬性规则 2、3、5）。
// update(t) 不分配内存：所有对象在 setup 里建好，每帧只按 t 插值、写矩阵和不透明度。
// 改这里要同时看 schema.ts 的格式和 tests/unit/T-ANIM-1.animation-doc.test.ts（T-ANIM-2 部分）。

// 这个文件单独看时 createAnimation 没有被用到：生成的 template.js 在它后面调用它（compile.ts）
/**
 * @param {import('./template-api').SetupContext} ctx
 * @param {any} doc 已按 AnimationDocSchema 校验过的动画文档
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createAnimation(ctx, doc) {
  const { THREE, scene } = ctx;
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
  const matrix = new THREE.Matrix4();
  const disposables = [];

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

  const layers = [];
  for (let index = 0; index < doc.layers.length; index++) {
    const def = doc.layers[index];
    const tracks = {};
    for (const p of PROPS) tracks[p] = compileTrack(def.props ? def.props[p] : undefined, DEFAULTS[p]);
    const layer = { def, tracks, from: typeof def.from === 'number' ? def.from : 0, to: typeof def.to === 'number' ? def.to : Infinity, unit: 1, apply: null };
    const holder = new THREE.Object3D();
    holder.renderOrder = index;
    if (def.type === 'block') {
      const inst = (await ctx.resources.block(def.block)).instanced(1);
      holder.add(inst.object);
      layer.unit = def.size;
      layer.apply = (visible, opacity) => {
        inst.object.visible = visible;
        inst.setMatrix(0, matrix);
        inst.setOpacity(0, opacity);
        inst.commit();
      };
      scene.add(holder);
    } else {
      let setOpacity;
      if (def.type === 'item') {
        const obj = (await ctx.resources.item(def.item)).single();
        const mats = ownMaterials(obj);
        holder.add(obj);
        layer.unit = def.size;
        setOpacity = (o) => {
          for (const m of mats) m.material.opacity = m.base * o;
        };
      } else if (def.type === 'text') {
        const text = ctx.text.create({ text: def.text, size: def.size, color: def.color, shadow: def.shadow, align: def.align });
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
      layer.apply = (visible, opacity) => {
        holder.visible = visible;
        holder.matrix.copy(matrix);
        holder.matrixWorldNeedsUpdate = true;
        setOpacity(opacity);
      };
    }
    layers.push(layer);
  }

  for (const s of doc.sounds || []) ctx.audio.cue(s.sound, s.at, { gain: s.gain });

  return {
    duration,
    cutTime: doc.cutTime === undefined ? null : doc.cutTime,
    update(t) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        const tr = l.tracks;
        const opacity = Math.min(1, Math.max(0, sample(tr.opacity, t)));
        const visible = t >= l.from && t < l.to && opacity > 0;
        const s = sample(tr.scale, t) * l.unit;
        position.set(sample(tr.x, t), sample(tr.y, t), sample(tr.z, t));
        euler.set(sample(tr.rotX, t) * DEG, sample(tr.rotY, t) * DEG, sample(tr.rotZ, t) * DEG, 'YXZ');
        quaternion.setFromEuler(euler);
        scaleV.set(s, s, s);
        matrix.compose(position, quaternion, scaleV);
        l.apply(visible, opacity);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
