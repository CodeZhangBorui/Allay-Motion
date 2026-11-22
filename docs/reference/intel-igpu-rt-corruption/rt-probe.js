// 渲染目标稳定性探针 / 最小复现：只用裸 WebGL2，不依赖 Allay Motion 的引擎和 Three.js，不含任何素材（贴图都由这段代码生成）。
// 说明和实测次数见同目录的 README.md；这份文件同时被引擎测试宿主（tests/engine/harness）当作探针使用。
//
// 场景照搬物品提示框（045）出问题的那一帧（135 × 135 输出、2 × 2 超采样）：
// 每个子帧 gl.clear 之后，在 270 × 270 的视口里画一张九宫格底图、一张九宫格边框（16 × 16 纯色贴图，带 mipmap），
// 再画五行线性过滤的“文字”（固定种子生成的 alpha 图案），全部按 SRC_ALPHA / ONE_MINUS_SRC_ALPHA 混合；
// 然后把 2 × 2 平均后按 1/16 加进 135 × 135 的 RGBA16F 累积目标；16 个子帧之后转成 RGBA8 读回整帧。
// 场景完全静止，每一帧都应当逐字节相同；不同的帧说明渲染目标被写坏了（驱动或硬件的问题）。
//
// 默认用最灵敏的配置：场景目标是 RGBA8、分配成 272 × 272（视口仍是 270 × 270）。format: 'rgba16f'、alloc: 270
// 是引擎里的原样配置，也能复现，只是次数少得多。
//
// 经典脚本（不是模块），页面和 Worker 里都能用：定义全局函数 allayRtProbe(options)。
// options：
//   budgetMs    最多跑多少毫秒（默认 1500）
//   maxFrames   最多跑多少帧（默认不限）
//   stopAfter   不一致的帧够这么多就提前结束（默认不限）
//   format      'rgba8'（默认）或 'rgba16f'：场景目标的格式
//   alloc       场景目标分配的边长（默认 272）
//   subframes   每帧的子帧数（默认 16）
//   checkErrors 每个 GL 调用之后查 getError，并在每次绘制前确认采样的贴图不在当前帧缓冲上（会改变时序，只用来证明调用合规）
// 返回：{ renderer, frames, bad, distinct, ms, events, glError, errors, calls }
//   bad 是和出现最多的那种结果不同的帧数；distinct 是不同结果的种数（稳定的显卡上是 1）
(function (root) {
  'use strict';

  var W = 270;
  var H = 270;
  var AW = 135;
  var AH = 135;

  // 提示框在 270 × 270 视口里的窗口坐标（像素，原点在左下），和引擎记下的那一帧相同
  var BG = { x0: 234.25, x1: 266.25, y0: 245.25, y1: 266.25, sx: [236.5, 264.0], sy: [247.5, 264.0], border: 9 };
  var FRAME = { x0: 234.25, x1: 266.25, y0: 245.25, y1: 266.25, sx: [236.75, 263.75], sy: [247.75, 263.75], border: 10 };
  var TEXT = [
    { x0: 236.75, x1: 257.75, y0: 258.75, y1: 263.75, w: 21 },
    { x0: 236.75, x1: 253.75, y0: 255.75, y1: 260.75, w: 17 },
    { x0: 236.75, x1: 255.75, y0: 253.25, y1: 258.25, w: 19 },
    { x0: 236.75, x1: 263.75, y0: 248.25, y1: 253.25, w: 27 },
    { x0: 237.75, x1: 260.75, y0: 245.75, y1: 250.75, w: 23 },
  ];

  function allayRtProbe(options) {
    var o = options || {};
    var budgetMs = o.budgetMs === undefined ? 1500 : o.budgetMs;
    var maxFrames = o.maxFrames === undefined ? Infinity : o.maxFrames;
    var stopAfter = o.stopAfter === undefined ? Infinity : o.stopAfter;
    var sub = o.subframes || 16;
    var alloc = o.alloc || 272;
    var raw = new OffscreenCanvas(1, 1).getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!raw) return { renderer: 'none', frames: 0, bad: 0, distinct: 0, ms: 0, events: [], glError: 0, errors: ['WebGL2 is not available'], calls: 0 };
    if (!raw.getExtension('EXT_color_buffer_float')) return { renderer: 'unknown', frames: 0, bad: 0, distinct: 0, ms: 0, events: [], glError: 0, errors: ['EXT_color_buffer_float is not available'], calls: 0 };
    var info = raw.getExtension('WEBGL_debug_renderer_info');
    var renderer = String(info ? raw.getParameter(info.UNMASKED_RENDERER_WEBGL) : raw.getParameter(raw.RENDERER));

    var errors = [];
    var calls = 0;
    var gl = raw;
    if (o.checkErrors) {
      gl = new Proxy(raw, {
        get: function (target, prop) {
          var v = target[prop];
          if (typeof v !== 'function') return v;
          if (prop === 'getError') return v.bind(target);
          return function () {
            var r = v.apply(target, arguments);
            calls++;
            var e = target.getError();
            if (e !== target.NO_ERROR && errors.length < 20) errors.push(String(prop) + ' -> 0x' + e.toString(16));
            return r;
          };
        },
      });
    }

    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'compile failed');
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'position');
      gl.bindAttribLocation(p, 1, 'uv');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
      return p;
    }
    var QUAD_VS = '#version 300 es\nprecision highp float;\nin vec2 position; in vec2 uv; out vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }';
    var QUAD_FS = '#version 300 es\nprecision highp float;\nuniform sampler2D map; in vec2 vUv; out highp vec4 fragColor;\nvoid main() { fragColor = texture(map, vUv); }';
    var FULL_VS = '#version 300 es\nin vec2 position;\nvoid main() { gl_Position = vec4(position, 0.0, 1.0); }';
    // 贴图框和文字各用一个程序（引擎里 Three 也给它们生成两个程序）
    var pSprite = program(QUAD_VS, QUAD_FS);
    var pText = program(QUAD_VS, QUAD_FS);
    var pAcc = program(
      FULL_VS,
      '#version 300 es\nprecision highp float; precision highp sampler2D;\nuniform sampler2D tSrc; uniform float uWeight; out highp vec4 fragColor;\n' +
        'void main() { ivec2 b = ivec2(gl_FragCoord.xy) * 2; fragColor = (texelFetch(tSrc, b, 0) + texelFetch(tSrc, b + ivec2(1, 0), 0) + texelFetch(tSrc, b + ivec2(0, 1), 0) + texelFetch(tSrc, b + ivec2(1, 1), 0)) * (uWeight * 0.25); }',
    );
    var pResolve = program(
      FULL_VS,
      '#version 300 es\nprecision highp float; precision highp sampler2D;\nuniform sampler2D tSrc; out highp vec4 fragColor;\n' +
        'void main() { vec4 c = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0); float a = clamp(c.a, 0.0, 1.0); fragColor = vec4(clamp(c.rgb / max(a, 1e-5), 0.0, 1.0), a); }',
    );

    function target(w, h, internal, depth) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (depth) {
        var rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
      return { tex: tex, fb: fb };
    }
    var scene = target(alloc, alloc, o.format === 'rgba16f' ? gl.RGBA16F : gl.RGBA8, true);
    var accum = target(AW, AH, gl.RGBA16F, false);
    var out = target(AW, AH, gl.RGBA8, false);

    // 贴图：16 × 16 纯色（sRGB，带 mipmap）；“文字”：w × 5，alpha 是固定种子的伪随机图案，四周一圈透明
    function texture(w, h, pixel, mip) {
      var data = new Uint8Array(w * h * 4);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      var levels = mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, w, h);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mip ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }
    var seed = 12345;
    function rnd() {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    }
    var bgTex = texture(16, 16, function () { return [117, 186, 135, 255]; }, true);
    var frameTex = texture(16, 16, function () { return [142, 152, 180, 255]; }, true);
    var textTex = TEXT.map(function (t) {
      return texture(t.w, 5, function (x, y) {
        var edge = x === 0 || y === 0 || x === t.w - 1 || y === 4;
        return edge ? [0, 0, 0, 0] : [170, 170, 170, rnd() < 0.5 ? 255 : Math.floor(rnd() * 256)];
      }, false);
    });

    // 几何：视口里的窗口坐标 → 裁剪坐标；九宫格是 3 × 3 个四边形（16 个顶点、54 个索引）
    function clipX(x) { return (x / W) * 2 - 1; }
    function clipY(y) { return (y / H) * 2 - 1; }
    function mesh(positions, uvs, indices) {
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
      return { vao: vao, count: indices.length };
    }
    function nineSlice(s) {
      var xs = [s.x0, s.sx[0], s.sx[1], s.x1];
      var ys = [s.y0, s.sy[0], s.sy[1], s.y1];
      var us = [0, s.border / 16, 1 - s.border / 16, 1];
      var p = [];
      var uv = [];
      var idx = [];
      for (var j = 0; j < 4; j++) {
        for (var i = 0; i < 4; i++) {
          p.push(clipX(xs[i]), clipY(ys[j]));
          uv.push(us[i], us[j]);
        }
      }
      for (var jj = 0; jj < 3; jj++) {
        for (var ii = 0; ii < 3; ii++) {
          var a = jj * 4 + ii;
          idx.push(a, a + 1, a + 5, a, a + 5, a + 4);
        }
      }
      return mesh(p, uv, idx);
    }
    function quad(t) {
      return mesh([clipX(t.x0), clipY(t.y0), clipX(t.x1), clipY(t.y0), clipX(t.x1), clipY(t.y1), clipX(t.x0), clipY(t.y1)], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3]);
    }
    var draws = [
      { p: pSprite, tex: bgTex, m: nineSlice(BG) },
      { p: pSprite, tex: frameTex, m: nineSlice(FRAME) },
    ];
    for (var t = 0; t < TEXT.length; t++) draws.push({ p: pText, tex: textTex[t], m: quad(TEXT[t]) });
    var full = mesh([-1, -1, 3, -1, -1, 3], [0, 0, 0, 0, 0, 0], [0, 1, 2]);
    [pSprite, pText].forEach(function (p) {
      gl.useProgram(p);
      gl.uniform1i(gl.getUniformLocation(p, 'map'), 0);
    });
    gl.useProgram(pAcc);
    gl.uniform1i(gl.getUniformLocation(pAcc, 'tSrc'), 0);
    gl.uniform1f(gl.getUniformLocation(pAcc, 'uWeight'), 1 / sub);
    gl.useProgram(pResolve);
    gl.uniform1i(gl.getUniformLocation(pResolve, 'tSrc'), 0);

    // 所有会影响结果的状态都显式设好，不依赖默认值
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.disable(gl.SAMPLE_COVERAGE);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.disable(gl.DITHER);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.depthRange(0, 1);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);

    // checkErrors：采样的贴图不能挂在当前帧缓冲上（WebGL 本来就会报 INVALID_OPERATION，这里再显式核对）
    function checkFeedback(fb, tex) {
      if (!o.checkErrors) return;
      if (raw.getParameter(raw.FRAMEBUFFER_BINDING) !== fb) errors.push('unexpected framebuffer binding');
      if (raw.getFramebufferAttachmentParameter(raw.FRAMEBUFFER, raw.COLOR_ATTACHMENT0, raw.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === tex) errors.push('sampled texture is attached to the bound framebuffer');
    }

    // 按整帧的哈希分组：所有帧都应当是同一种；第 0 帧本身也可能是坏的，所以最后以出现最多的那一种为准
    var groups = {};
    var order = [];
    var frames = 0;
    var start = performance.now();
    var px = new Uint8Array(AW * AH * 4);
    while (frames < maxFrames && performance.now() - start < budgetMs) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
      gl.viewport(0, 0, AW, AH);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (var s = 0; s < sub; s++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
        gl.viewport(0, 0, W, H);
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        var cur = null;
        for (var d = 0; d < draws.length; d++) {
          var dr = draws[d];
          if (dr.p !== cur) {
            gl.useProgram(dr.p);
            cur = dr.p;
          }
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, dr.tex);
          checkFeedback(scene.fb, dr.tex);
          gl.bindVertexArray(dr.m.vao);
          gl.drawElements(gl.TRIANGLES, dr.m.count, gl.UNSIGNED_SHORT, 0);
        }
        gl.depthMask(true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
        gl.viewport(0, 0, AW, AH);
        gl.useProgram(pAcc);
        gl.bindTexture(gl.TEXTURE_2D, scene.tex);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
        gl.disable(gl.DEPTH_TEST);
        checkFeedback(accum.fb, scene.tex);
        gl.bindVertexArray(full.vao);
        gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
        gl.enable(gl.DEPTH_TEST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
      gl.viewport(0, 0, AW, AH);
      gl.disable(gl.BLEND);
      gl.useProgram(pResolve);
      gl.bindTexture(gl.TEXTURE_2D, accum.tex);
      gl.disable(gl.DEPTH_TEST);
      checkFeedback(out.fb, accum.tex);
      gl.bindVertexArray(full.vao);
      gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.readPixels(0, 0, AW, AH, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var h = 2166136261;
      for (var i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619);
      var key = (h >>> 0).toString(16);
      if (groups[key]) groups[key].count++;
      else {
        groups[key] = { count: 1, frame: frames, pixels: order.length < 16 ? px.slice() : null };
        order.push(key);
      }
      frames++;
      if (order.length > 1) {
        var most = 0;
        for (var g0 = 0; g0 < order.length; g0++) most = Math.max(most, groups[order[g0]].count);
        if (frames - most >= stopAfter) break;
      }
    }
    var major = order[0];
    for (var g = 1; g < order.length; g++) if (groups[order[g]].count > groups[major].count) major = order[g];
    var bad = frames - (major ? groups[major].count : 0);
    var events = [];
    var ref = major ? groups[major].pixels : null;
    for (var q = 0; q < order.length && events.length < 10; q++) {
      var other = groups[order[q]];
      if (order[q] === major || !other.pixels || !ref) continue;
      var n = 0;
      var sample = null;
      for (var j = 0; j < ref.length; j += 4) {
        if (other.pixels[j] !== ref[j] || other.pixels[j + 1] !== ref[j + 1] || other.pixels[j + 2] !== ref[j + 2] || other.pixels[j + 3] !== ref[j + 3]) {
          n++;
          if (!sample) sample = { x: (j / 4) % AW, y: AH - 1 - Math.floor(j / 4 / AW), expected: Array.from(ref.subarray(j, j + 4)), got: Array.from(other.pixels.subarray(j, j + 4)) };
        }
      }
      events.push({ frame: other.frame, count: other.count, pixels: n, sample: sample });
    }
    return { renderer: renderer, frames: frames, bad: bad, distinct: order.length, ms: Math.round(performance.now() - start), events: events, glError: raw.getError(), errors: errors, calls: calls };
  }

  root.allayRtProbe = allayRtProbe;
})(typeof self !== 'undefined' ? self : this);
