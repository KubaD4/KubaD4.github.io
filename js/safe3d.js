/*! (c) 2026 Kuba Di Quattro. SAFE scroll stage — rights reserved. No reproduction, no adaptation, no text and data mining (Art. 4(3) Dir. (EU) 2019/790). LICENSE.txt */
/* SAFE stage: the project's exported vessel and stent-graft meshes,
   rendered live and choreographed by scroll progress (0..1).
   Mesh data comes from assets/safe-mesh.js (tools/build_mesh.py). */
(function () {
  'use strict';
  const { M, program, buffer, attribute, context, fit, hex } = window.GL;

  const MESH_VS = `
    attribute vec3 aPos;
    attribute vec3 aNormal;
    attribute float aDist;
    uniform mat4 uModel, uVP;
    varying vec3 vN, vW;
    varying float vDist;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      vW = w.xyz;
      vN = mat3(uModel) * aNormal;
      vDist = aDist;
      gl_Position = uVP * w;
    }`;

  const MESH_FS = `
    precision highp float;
    uniform vec3 uEye, uBase, uSignal, uTeal, uCream, uLight;
    uniform float uCut, uCutDir, uXray, uHeat, uAlpha, uEdge;
    varying vec3 vN, vW;
    varying float vDist;
    vec3 heat(float d) {                  // d: 0 (touching) .. 1 (25 mm or more)
      vec3 c = mix(uSignal, vec3(0.98, 0.72, 0.38), smoothstep(0.0, 0.16, d));
      c = mix(c, uTeal, smoothstep(0.16, 0.5, d));
      return mix(c, uCream * 0.82, smoothstep(0.5, 1.0, d));
    }
    void main() {
      float side = (vW.y - uCut) * uCutDir;
      if (side < 0.0) discard;
      vec3 n = normalize(vN);
      vec3 v = normalize(uEye - vW);
      if (!gl_FrontFacing) n = -n;
      if (dot(n, v) < 0.0) n = -n;
      float diff = max(dot(n, normalize(uLight)), 0.0);
      float hemi = 0.5 + 0.5 * n.y;
      float rim = pow(1.0 - max(dot(n, v), 0.0), 2.2);
      vec3 base = mix(uBase, heat(vDist), uHeat);
      vec3 col = base * (0.30 + 0.62 * diff + 0.16 * hemi) + rim * 0.22 * uCream;
      float spec = pow(max(dot(reflect(-normalize(uLight), n), v), 0.0), 28.0) * 0.18;
      col += spec;
      float a = mix(1.0, 0.05 + rim * 0.55, uXray) * uAlpha;
      // bright rim where the scan plane cuts the surface
      float edge = (1.0 - smoothstep(0.0, 0.012, side)) * uEdge;
      col = mix(col, uSignal * 1.2, edge);
      a = max(a, edge * uAlpha);
      gl_FragColor = vec4(col * a, a);
    }`;

  const LINE_VS = `
    attribute vec3 aPos;
    uniform mat4 uVP, uModel;
    void main() { gl_Position = uVP * uModel * vec4(aPos, 1.0); }`;
  const LINE_FS = `
    precision highp float;
    uniform vec3 uColor;
    uniform float uAlpha;
    void main() { gl_FragColor = vec4(uColor * uAlpha, uAlpha); }`;

  function decode(b64, Type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Type(bytes.buffer);
  }

  /* Model space: source z (long axis, mm) -> y up; centred on the stent. */
  function prepare(data) {
    const span = data.span, min = data.min;
    const out = {};
    const stentQ = decode(data.stent.v, Uint16Array);
    let c = [0, 0, 0], lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    const sc = stentQ.length / 3;
    for (let i = 0; i < stentQ.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = min[k] + (stentQ[i + k] / 65535) * span;
        c[k] += v / sc;
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      }
    }
    const scale = 1 / 120; // mm -> scene units
    out.scale = scale;
    out.center = c;
    out.stentZ = [lo[2], hi[2]];
    ['aorta', 'stent'].forEach((name) => {
      const q = decode(data[name].v, Uint16Array);
      const idx = decode(data[name].i, Uint16Array);
      const n = q.length / 3;
      const pos = new Float32Array(q.length);
      for (let i = 0; i < n; i++) {
        const x = min[0] + (q[i * 3] / 65535) * span;
        const y = min[1] + (q[i * 3 + 1] / 65535) * span;
        const z = min[2] + (q[i * 3 + 2] / 65535) * span;
        pos[i * 3] = (x - c[0]) * scale;
        pos[i * 3 + 1] = (z - c[2]) * scale;
        pos[i * 3 + 2] = (y - c[1]) * scale;
      }
      const nor = new Float32Array(q.length);
      for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f] * 3, b = idx[f + 1] * 3, d = idx[f + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, d]) { nor[k] += nx; nor[k + 1] += ny; nor[k + 2] += nz; }
      }
      for (let i = 0; i < nor.length; i += 3) {
        const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
        nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
      }
      let ylo = 1e9, yhi = -1e9;
      for (let i = 1; i < pos.length; i += 3) { ylo = Math.min(ylo, pos[i]); yhi = Math.max(yhi, pos[i]); }
      out[name] = { pos, nor, idx, count: idx.length, ylo, yhi };
      if (data[name].d) {
        const d8 = decode(data[name].d, Uint8Array);
        const d = new Float32Array(n);
        for (let i = 0; i < n; i++) d[i] = d8[i] / 255;
        out[name].dist = d;
      } else {
        out[name].dist = new Float32Array(n).fill(1);
      }
    });
    return out;
  }

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  function create(canvas, data, opts) {
    const gl = context(canvas, { antialias: true });
    if (!gl) return null;
    const mesh = prepare(data);
    const meshProg = program(gl, MESH_VS, MESH_FS);
    const lineProg = program(gl, LINE_VS, LINE_FS);

    const parts = {};
    ['aorta', 'stent'].forEach((name) => {
      const m = mesh[name];
      parts[name] = {
        pos: buffer(gl, m.pos),
        nor: buffer(gl, m.nor),
        dist: buffer(gl, m.dist),
        idx: buffer(gl, m.idx, gl.ELEMENT_ARRAY_BUFFER),
        count: m.count,
      };
    });

    // Reference planes: square outlines at stent top, middle and bottom.
    const s = mesh.scale;
    const planeY = [
      (mesh.stentZ[1] - mesh.center[2]) * s,
      0,
      (mesh.stentZ[0] - mesh.center[2]) * s,
    ];
    const planeMm = [mesh.stentZ[1], mesh.center[2], mesh.stentZ[0]];
    const R = 0.36;
    const square = new Float32Array([-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, R]);
    const squareBuf = buffer(gl, square);

    const colors = {
      base: hex('#e9e3d3'), signal: hex('#ef6234'), teal: hex('#3f8ea0'), cream: hex('#f1ede2'),
      planes: [hex('#7fb7c6'), hex('#ef6234'), hex('#b9a6e0')],
    };

    const state = {
      p: 0, yaw: 0, dragYaw: 0, dragPitch: 0, vel: 0, interactive: false,
      running: false, last: 0, time: 0, vp: M.identity(), eye: [0, 0, 3],
    };

    /* Scroll choreography, all derived from p. Step windows:
       01 .04-.24  02 .24-.40  03 .40-.58  04 .58-.76  05 .76-.94 */
    function pose(p) {
      const yTop = mesh.aorta.yhi + 0.02, yBottom = mesh.aorta.ylo - 0.02;
      const mid = (mesh.aorta.yhi + mesh.aorta.ylo) / 2;
      const close = smooth(0.4, 0.56, p);
      return {
        cut: lerp(yTop - 0.12, yBottom, smooth(0.04, 0.23, p)),
        scanAlpha: 1 - smooth(0.22, 0.25, p),
        planes: [0, 1, 2].map((i) => smooth(0.26 + i * 0.03, 0.3 + i * 0.03, p) * (1 - smooth(0.74, 0.79, p))),
        xray: smooth(0.42, 0.46, p) * (1 - smooth(0.57, 0.6, p)) + smooth(0.79, 0.85, p) * 0.75,
        stentCut: lerp(mesh.stent.yhi + 0.02, mesh.stent.ylo - 0.02, smooth(0.44, 0.56, p)),
        stentOn: (p > 0.43 && p < 0.6) || p > 0.79 ? 1 : 0,
        stentCream: smooth(0.6, 0.66, p),
        heat: smooth(0.59, 0.66, p),
        zoom: lerp(5.1, 3.0, close) + smooth(0.78, 0.88, p) * 0.35,
        target: lerp(mid, 0, close),
        pitch: 0.12 + smooth(0.24, 0.3, p) * 0.3 - smooth(0.4, 0.5, p) * 0.22 + smooth(0.6, 0.68, p) * 0.06,
        turn: p * Math.PI * 2.2,
      };
    }

    function draw() {
      fit(canvas, 1.75);
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const P = pose(state.p);
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      const pitch = P.pitch + state.dragPitch;
      const dist = P.zoom * (aspect < 0.8 ? 1.75 : 1);
      const eye = [0, P.target + Math.sin(pitch) * dist, Math.cos(pitch) * dist];
      state.eye = eye;
      const view = M.lookAt(eye, [0, P.target, 0], [0, 1, 0]);
      const proj = M.perspective(0.7, aspect, 0.05, 40);
      // keep the model in the right part of the stage on wide screens
      const shift = M.identity();
      shift[12] = aspect > 1.15 ? (opts.offset || 0.32) : 0;
      shift[13] = aspect > 1.15 ? 0 : -0.24;
      const vp = M.multiply(shift, M.multiply(proj, view));
      state.vp = vp;
      const model = M.rotationY(P.turn + state.yaw + state.dragYaw);
      state.model = model;

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);

      gl.useProgram(meshProg.p);
      const u = meshProg.u;
      gl.uniformMatrix4fv(u.uModel, false, model);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uEye, eye);
      gl.uniform3fv(u.uLight, [0.55, 0.85, 1.0]);
      gl.uniform3fv(u.uSignal, colors.signal);
      gl.uniform3fv(u.uTeal, colors.teal);
      gl.uniform3fv(u.uCream, colors.cream);

      const drawPart = (name, opt) => {
        const part = parts[name];
        attribute(gl, meshProg, 'aPos', part.pos, 3);
        attribute(gl, meshProg, 'aNormal', part.nor, 3);
        attribute(gl, meshProg, 'aDist', part.dist, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.idx);
        gl.uniform3fv(u.uBase, opt.base);
        gl.uniform1f(u.uCut, opt.cut);
        gl.uniform1f(u.uCutDir, 1);
        gl.uniform1f(u.uXray, opt.xray);
        gl.uniform1f(u.uHeat, opt.heat);
        gl.uniform1f(u.uAlpha, opt.alpha);
        gl.uniform1f(u.uEdge, opt.edge);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
      };

      if (P.stentOn) {
        gl.depthMask(true);
        const stentBase = colors.signal.map((c, i) => lerp(c, colors.cream[i], P.stentCream));
        drawPart('stent', { base: stentBase, cut: P.stentCut, xray: 0, heat: 0, alpha: 1, edge: 1 - P.stentCream });
      }
      // vessel: opaque while solid, depth-write off when x-ray
      gl.depthMask(P.xray < 0.02);
      drawPart('aorta', { base: colors.base, cut: P.cut, xray: P.xray, heat: P.heat, alpha: 1, edge: P.scanAlpha });
      gl.depthMask(true);

      // lines: scan plane + reference planes
      gl.useProgram(lineProg.p);
      gl.disable(gl.DEPTH_TEST);
      attribute(gl, lineProg, 'aPos', squareBuf, 3);
      gl.uniformMatrix4fv(lineProg.u.uVP, false, vp);
      const lineModel = (y, k) => {
        const sc = M.identity();
        sc[0] = sc[10] = k;
        sc[13] = y;
        return M.multiply(model, sc);
      };
      if (P.scanAlpha > 0.01) {
        gl.uniformMatrix4fv(lineProg.u.uModel, false, lineModel(P.cut, 1.15));
        gl.uniform3fv(lineProg.u.uColor, colors.cream);
        gl.uniform1f(lineProg.u.uAlpha, P.scanAlpha * 0.9);
        gl.drawArrays(gl.LINE_LOOP, 0, 4);
      }
      P.planes.forEach((k, i) => {
        if (k < 0.01) return;
        gl.uniformMatrix4fv(lineProg.u.uModel, false, lineModel(planeY[i], 0.4 + 0.6 * springOut(k)));
        gl.uniform3fv(lineProg.u.uColor, colors.planes[i]);
        gl.uniform1f(lineProg.u.uAlpha, Math.min(1, k * 1.5));
        gl.drawArrays(gl.LINE_LOOP, 0, 4);
      });

      if (opts.onFrame) opts.onFrame(api, P);
    }

    function springOut(t) {
      // closed-form underdamped step response, normalised to end at 1
      const z = 0.55, w = 11, wd = w * Math.sqrt(1 - z * z), x = t * 0.9;
      return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + (z * w / wd) * Math.sin(wd * x));
    }

    function tick(now) {
      if (!state.running) return;
      const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 0;
      state.last = now;
      state.time += dt;
      state.yaw += dt * 0.05;
      state.dragYaw += state.vel;
      state.vel *= 0.93;
      if (!state.interactive) state.dragPitch *= 0.9;
      draw();
      requestAnimationFrame(tick);
    }

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!state.interactive || e.pointerType === 'touch') return;
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      state.vel = (e.clientX - drag.x) * 0.006;
      state.dragPitch = Math.max(-0.5, Math.min(0.9, state.dragPitch + (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; canvas.classList.remove('is-dragging'); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    /* Project a model-space point to CSS px within the canvas. */
    function project(point) {
      const world = M.transform(state.model || M.identity(), point);
      const clip = M.transform(state.vp, world);
      return [(clip[0] * 0.5 + 0.5) * canvas.clientWidth, (1 - (clip[1] * 0.5 + 0.5)) * canvas.clientHeight, clip[2]];
    }

    const api = {
      planeY, planeMm, R, mesh,
      setProgress(p) { state.p = clamp01(p); if (!state.running) draw(); },
      setInteractive(v) { state.interactive = v; canvas.classList.toggle('is-interactive', v); },
      start() { if (state.running) return; state.running = true; state.last = 0; requestAnimationFrame(tick); },
      stop() { state.running = false; },
      draw, project, pose,
      cutMm(p) {
        const P = pose(p);
        return P.cut / s + mesh.center[2];
      },
    };
    draw();
    return api;
  }

  window.SafeStage = { create };
})();
