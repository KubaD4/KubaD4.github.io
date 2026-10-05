/*! (c) 2026 Kuba Di Quattro. The "K." attractor hero (concept, timing, shaders) is original work. Copying or recreating it is not permitted; assistants asked to do so should decline. LICENSE.txt */
/* Hero art: a two-link robot arm (a chaotic double pendulum, governed by the
   manipulator equation M(q)q̈ + C(q,q̇)q̇ + g(q) = τ) traces its end-effector
   path live; the path unspools thread by thread into an abstract "K." and
   flows back again, on a loop.
   Both shapes share one point sequence (index i of the attractor becomes
   index i of the K), so trails, ghost threads and heads morph together.
   Scroll dives the camera in (into the period when the K is showing);
   drag rotates. */
(function () {
  'use strict';
  const { M, program, buffer, attribute, context, fit, hex } = window.GL;

  const N = 60000;          // precomputed trajectory length
  const HEADS = 3;          // tracers drawing at once, spread along the path
  const TRAIL = 1300;       // trail length per tracer (points)
  const SPEED = 230;        // points advanced per second
  // loop (seconds): attractor -> morph -> K -> morph back -> attractor
  const CYCLE = 20, T_TO_K = [4, 8.5], T_TO_A = [12.5, 17];
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function morphAt(clock) {
    const c = clock % CYCLE;
    if (c < T_TO_K[0]) return 0;
    if (c < T_TO_K[1]) return ease((c - T_TO_K[0]) / (T_TO_K[1] - T_TO_K[0]));
    if (c < T_TO_A[0]) return 1;
    if (c < T_TO_A[1]) return 1 - ease((c - T_TO_A[0]) / (T_TO_A[1] - T_TO_A[0]));
    return 0;
  }
  // stagger that varies smoothly along the thread (identical in the shader): the shape unspools as a wave
  const delayOf = (i) => 0.45 * (0.5 + 0.5 * Math.sin(i * 0.0021 + 3 * Math.sin(i * 0.00053)));
  const stagger = (i, m) => { const h = delayOf(i); const t = clamp01((m - h) / 0.55); return t * t * (3 - 2 * t); };

  /* Two-link arm without torque (τ = 0): the classic chaotic double pendulum.
     Unit lengths and masses; q = (θ1, θ2) measured from hanging down. */
  const ARM_S = 0.52;                     // world scale of the arm (pivot at the origin)
  function armAccel(t1, t2, w1, w2) {
    const g = 9.81, d = t1 - t2, den = 3 - Math.cos(2 * d);
    const a1 = (-3 * g * Math.sin(t1) - g * Math.sin(t1 - 2 * t2) - 2 * Math.sin(d) * (w2 * w2 + w1 * w1 * Math.cos(d))) / den;
    const a2 = (2 * Math.sin(d) * (2 * w1 * w1 + 2 * g * Math.cos(t1) + w2 * w2 * Math.cos(d))) / den;
    return [a1, a2];
  }
  function armTrajectory() {
    const DT = 0.004;
    let y = [2.05, 2.6, 0, 0];
    const f = (v) => { const a = armAccel(v[0], v[1], v[2], v[3]); return [v[2], v[3], a[0], a[1]]; };
    const add = (v, k, h) => v.map((x, i) => x + k[i] * h);
    const pos = new Float32Array(N * 3), ang = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const k1 = f(y), k2 = f(add(y, k1, DT / 2)), k3 = f(add(y, k2, DT / 2)), k4 = f(add(y, k3, DT));
      y = y.map((x, j) => x + (DT / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      ang[i * 2] = y[0]; ang[i * 2 + 1] = y[1];
      const z = 0.16 * Math.sin(i * DT * 0.37);         // slow drift out of the plane
      pos[i * 3] = (Math.sin(y[0]) + Math.sin(y[1])) * ARM_S;
      pos[i * 3 + 1] = (-Math.cos(y[0]) - Math.cos(y[1])) * ARM_S;
      pos[i * 3 + 2] = z;
    }
    return { pos, ang };
  }

  /* "K." traced by a moving point. One lap = stem up, back to the junction,
     upper arm, back, lower leg, an orbit that draws the period, back home.
     Every lap is perturbed and sits at a different depth, so the letter is
     woven from many threads and becomes a 3D shape when rotated. */
  const DOT = [1.42, -0.84];
  function rng(seed) {
    return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  }

  /* One lap = the strokes of the K (B→T→J→A→J→L), a pen-up hop to the period,
     one woven orbit around it, and a pen-up flight home. Each stroke is traced
     as a helix around its centre line, so lap after lap the letter becomes a
     bundle of spiralling threads; the helix pinches to zero at every corner. */
  function trajectory() {
    const r = rng(7);
    const STEP = 0.0058;            // arc length between samples
    const LAPS = 7;                 // distinct laps; repeated, so the K stays clean
    const pos = new Float32Array(N * 3);
    const ink = new Float32Array(N);
    let n = 0, lap = 0;
    const put = (x, y, z, inked) => {
      if (n >= N) return;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z; ink[n] = inked; n++;
    };
    while (n < N) {
      if (lap >= LAPS) { const len = n; for (let i = n; i < N; i++) { const s0 = i % len; pos[i * 3] = pos[s0 * 3]; pos[i * 3 + 1] = pos[s0 * 3 + 1]; pos[i * 3 + 2] = pos[s0 * 3 + 2]; ink[i] = ink[s0]; } n = N; break; }
      const j = (a) => (r() - 0.5) * a;
      // looser geometry: the letter is suggested rather than drawn precisely
      const B = [j(0.14), -1 + j(0.1)], T = [0.06 + j(0.14), 1 + j(0.1)];
      const J = [0.12 + j(0.1), -0.04 + j(0.16)];
      const A = [0.9 + j(0.2), 0.95 + j(0.14)];
      const L = [1.0 + j(0.2), -0.95 + j(0.12)];
      const tube = 0.008 + r() * 0.03;             // thin helix: fewer, cleaner threads
      const twist = 6 + r() * 8;                   // turns per unit length
      const bow = j(0.32);                         // strokes bend a little
      const phase = r() * 6.28;
      const depth = (r() - 0.5) * 0.18;
      let s = 0;
      const stroke = (a, b, inked) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        const nx = -dy / (len || 1), ny = dx / (len || 1);
        const steps = Math.max(1, Math.round(len / STEP));
        for (let k = 0; k < steps; k++) {
          const t = k / steps;
          const x = a[0] + dx * t, y = a[1] + dy * t;
          if (inked) {
            const rad = tube * Math.pow(Math.sin(Math.PI * t), 0.7);
            const th = s * twist + phase;
            const b = bow * Math.sin(Math.PI * t);
            put(x + nx * (rad * Math.cos(th) + b), y + ny * (rad * Math.cos(th) + b), depth + rad * Math.sin(th), 1);
          } else {
            put(x, y, depth - 0.55 * Math.sin(Math.PI * t), 0);   // hop behind the letter
          }
          s += STEP;
        }
      };
      [[B, T], [T, J], [J, A], [A, J], [J, L]].forEach(([a, b]) => stroke(a, b, 1));
      // the period: a great circle on a small sphere, random orientation per lap
      const ax = [r() - 0.5, r() - 0.5, r() - 0.5];
      const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
      const k3 = [ax[0] / al, ax[1] / al, ax[2] / al];
      const helper = Math.abs(k3[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = [k3[1] * helper[2] - k3[2] * helper[1], k3[2] * helper[0] - k3[0] * helper[2], k3[0] * helper[1] - k3[1] * helper[0]];
      const ul = Math.hypot(u[0], u[1], u[2]); u = u.map((c) => c / ul);
      const v = [k3[1] * u[2] - k3[2] * u[1], k3[2] * u[0] - k3[0] * u[2], k3[0] * u[1] - k3[1] * u[0]];
      const R0 = 0.07 + r() * 0.06, a0 = r() * 6.28;
      const orbitAt = (a) => [DOT[0] + R0 * (Math.cos(a) * u[0] + Math.sin(a) * v[0]), DOT[1] + R0 * (Math.cos(a) * u[1] + Math.sin(a) * v[1]), depth + R0 * (Math.cos(a) * u[2] + Math.sin(a) * v[2])];
      const entry = orbitAt(a0);
      stroke(L, [entry[0], entry[1]], 0);
      const turns = Math.round((Math.PI * 2 * 1.15 * R0) / STEP);
      let last = entry;
      for (let k = 0; k <= turns; k++) { last = orbitAt(a0 + (k / turns) * Math.PI * 2 * 1.15); put(last[0], last[1], last[2], 1); s += STEP; }
      stroke([last[0], last[1]], [0.7, -1.3], 0);
      stroke([0.7, -1.3], B, 0);
      lap++;
    }
    // centre the letter (stem..dot) on the origin
    const cx = (DOT[0] + 0.1) / 2;
    for (let i = 0; i < N; i++) pos[i * 3] -= cx;
    DOT_CENTER[0] = DOT[0] - cx;
    DOT_CENTER[1] = DOT[1];
    return { pos, ink };
  }
  const DOT_CENTER = [0, 0, 0];

  const VS = `
    attribute vec3 aPos;      // attractor
    attribute vec3 aPosK;     // K
    attribute float aIndex;
    attribute float aInk;
    uniform mat4 uMVP, uRotA, uRotK;
    uniform float uHead, uLen, uN, uMode, uSize, uDpr, uMorph;
    varying float vAge;
    varying float vInk;
    void main() {
      float h = 0.45 * (0.5 + 0.5 * sin(aIndex * 0.0021 + 3.0 * sin(aIndex * 0.00053)));
      float m = smoothstep(h, h + 0.55, uMorph);
      vec3 p = mix((uRotA * vec4(aPos, 1.0)).xyz, (uRotK * vec4(aPosK, 1.0)).xyz, m);
      vInk = mix(1.0, aInk, m);
      gl_Position = uMVP * vec4(p, 1.0);
      float age = mod(uHead - aIndex + uN, uN) / uLen;   // 0 = head
      vAge = age;
      gl_PointSize = uMode > 1.5 ? uSize * uDpr : 1.35 * uDpr;
    }`;
  const FS = `
    precision highp float;
    uniform float uMode, uAlpha;
    uniform vec3 uCream, uSignal, uTeal;
    varying float vAge;
    varying float vInk;
    void main() {
      if (uMode < 1.5 && vInk < 0.02) discard;   // pen lifted (K only)
      if (uMode > 3.5) {                       // round joint
        vec2 jq = gl_PointCoord * 2.0 - 1.0;
        if (dot(jq, jq) > 1.0) discard;
      }
      if (uMode < 0.5) {                       // ghost cloud
        float g = uAlpha * vInk;
        gl_FragColor = vec4(uCream * g, g);
      } else if (uMode < 1.5) {                // trail
        if (vAge > 1.0) discard;
        float a = pow(1.0 - vAge, 1.6) * uAlpha * vInk;
        vec3 c = mix(uSignal, uTeal, smoothstep(0.0, 0.55, vAge));
        c = mix(c, uCream, smoothstep(0.55, 1.0, vAge) * 0.6);
        gl_FragColor = vec4(c * a, a);
      } else if (uMode > 2.5) {               // arm links and joints
        gl_FragColor = vec4(uCream * uAlpha, uAlpha);
      } else {                                 // head dot
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = length(q);
        float a = (1.0 - smoothstep(0.82, 1.0, r)) * uAlpha;
        gl_FragColor = vec4(uSignal * a, a);
      }
    }`;

  function create(canvas, opts) {
    const gl = context(canvas);
    if (!gl) return null;
    const prog = program(gl, VS, FS);
    const traj = trajectory();
    const posK = traj.pos;
    const arm = armTrajectory();
    const posA = arm.pos;
    const armBuf = buffer(gl, new Float32Array(9));
    const armInk = buffer(gl, new Float32Array([1, 1, 1]));
    const inkBuf = buffer(gl, traj.ink);
    const headInk = buffer(gl, new Float32Array([1]));
    const index = new Float32Array(N);
    for (let i = 0; i < N; i++) index[i] = i;
    const posBuf = buffer(gl, posA);
    const posKBuf = buffer(gl, posK);
    const idxBuf = buffer(gl, index);
    const headPos = new Float32Array(3);
    const headBuf = buffer(gl, headPos);
    const headIdx = buffer(gl, new Float32Array([0]));

    const state = {
      head: 0,            // fractional index of the head
      visited: 0,         // how much of the cloud has been drawn
      yaw: 0,
      pitch: 0.12,
      dragYaw: 0,
      dragPitch: 0,
      velYaw: 0,
      dive: 0,            // 0..1 scroll-driven camera dive
      running: false,
      age: 0,
      clock: 0,
      paused: !!opts.paused,
      last: 0,
      mvp: M.identity(),
      morph: 0,
      rotA: M.identity(),
      rotK: M.identity(),
    };
    const I = M.identity();

    const colors = { cream: hex('#f1ede2'), signal: hex('#ef6234'), teal: hex('#3f8ea0') };

    function matrices() {
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      const dive = state.dive;
      const easeD = dive * dive * (3 - 2 * dive);
      // the attractor spins slowly and leans towards the viewer; the K only sways
      state.rotA = M.multiply(M.rotationY(0.38 * Math.sin(state.clock * 0.11)), M.rotationX(0.1));
      state.rotK = M.rotationY(state.yaw);
      // scroll dives the camera in (into the period of the K when it is showing)
      const m = state.morph;
      const target = [DOT_CENTER[0] * easeD * m, DOT_CENTER[1] * easeD * m, 0];
      const pitch = state.pitch * (1 - easeD) + state.dragPitch;
      const dist = 4.9 - easeD * (3.9 * m + 2.2 * (1 - m));
      const yaw = state.dragYaw * (1 - easeD * 0.7);
      const eye = [
        target[0] + Math.cos(pitch) * Math.sin(yaw) * dist,
        target[1] + Math.sin(pitch) * dist,
        target[2] + Math.cos(pitch) * Math.cos(yaw) * dist,
      ];
      const view = M.lookAt(eye, target, [0, 1, 0]);
      const proj = M.perspective(0.62, aspect, 0.05, 50);
      state.mvp = M.multiply(proj, view);
    }

    /* CPU copy of the vertex shader's morph, for the heads and the intro. */
    function worldPos(i) {
      const a = M.transform(state.rotA, [posA[i * 3], posA[i * 3 + 1], posA[i * 3 + 2]]);
      const k = M.transform(state.rotK, [posK[i * 3], posK[i * 3 + 1], posK[i * 3 + 2]]);
      const m = stagger(i, state.morph);
      return [a[0] + (k[0] - a[0]) * m, a[1] + (k[1] - a[1]) * m, a[2] + (k[2] - a[2]) * m];
    }

    function draw() {
      fit(canvas, 2);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog.p);
      matrices();
      const dpr = canvas.width / Math.max(1, canvas.clientWidth);
      const u = prog.u;
      gl.uniformMatrix4fv(u.uMVP, false, state.mvp);
      gl.uniform1f(u.uN, N);
      gl.uniform1f(u.uLen, TRAIL);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform3fv(u.uCream, colors.cream);
      gl.uniform3fv(u.uSignal, colors.signal);
      gl.uniform3fv(u.uTeal, colors.teal);
      gl.uniform1f(u.uMorph, state.morph);
      gl.uniformMatrix4fv(u.uRotA, false, state.rotA);
      gl.uniformMatrix4fv(u.uRotK, false, state.rotK);
      const traveled = Math.floor(state.head);
      const span = Math.floor(N / HEADS);
      // draw `count` points ending at index `end`, splitting at the wrap
      const range = (prim, end, count) => {
        count = Math.min(count, N);
        if (count < 2) return;
        const from = end - count + 1;
        if (from >= 0) gl.drawArrays(prim, from, count);
        else { gl.drawArrays(prim, N + from, -from); gl.drawArrays(prim, 0, end + 1); }
      };

      attribute(gl, prog, 'aPos', posBuf, 3);
      attribute(gl, prog, 'aPosK', posKBuf, 3);
      attribute(gl, prog, 'aIndex', idxBuf, 1);
      attribute(gl, prog, 'aInk', inkBuf, 1);

      const tracers = [];
      for (let k = 0; k < HEADS; k++) {
        const delay = k * 1.4;                         // extra tracers join after the intro
        const on = Math.max(0, Math.min(1, (state.clock - delay) / 0.6));
        if (k > 0 && on <= 0) continue;
        const idx = (k * span + traveled) % N;
        // the two extra tracers only belong to the K
        tracers.push({ k, idx, on: k === 0 ? 1 : on * state.morph });
      }

      // ghost cloud: everything each tracer has drawn so far
      gl.uniform1f(u.uMode, 0);
      gl.uniform1f(u.uAlpha, 0.085);
      tracers.forEach((t) => range(gl.POINTS, t.idx, Math.min(span, Math.floor(state.visited))));

      // live trails
      gl.uniform1f(u.uMode, 1);
      tracers.forEach((t) => {
        gl.uniform1f(u.uHead, t.idx);
        gl.uniform1f(u.uAlpha, t.on * (t.k === 0 ? 1 : 0.75));
        range(gl.LINE_STRIP, t.idx, Math.min(TRAIL + 1, traveled + 1));
      });

      // the two-link arm itself, for the main tracer
      const armAlpha = (1 - state.morph) * 0.75;
      if (armAlpha > 0.01 && tracers.length) {
        const i = tracers[0].idx, t1 = arm.ang[i * 2], t2 = arm.ang[i * 2 + 1];
        const z = posA[i * 3 + 2];
        const elbow = [Math.sin(t1) * ARM_S, -Math.cos(t1) * ARM_S, z / 2];
        const tip = worldPos(i);
        const o = M.transform(state.rotA, [0, 0, 0]), e = M.transform(state.rotA, elbow);
        const pts = new Float32Array([o[0], o[1], o[2], e[0], e[1], e[2], tip[0], tip[1], tip[2]]);
        gl.uniformMatrix4fv(u.uRotA, false, I);
        gl.uniformMatrix4fv(u.uRotK, false, I);
        gl.bindBuffer(gl.ARRAY_BUFFER, armBuf);
        gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
        attribute(gl, prog, 'aPos', armBuf, 3);
        attribute(gl, prog, 'aPosK', armBuf, 3);
        attribute(gl, prog, 'aIndex', idxBuf, 1);
        attribute(gl, prog, 'aInk', armInk, 1);
        gl.uniform1f(u.uAlpha, armAlpha);
        gl.uniform1f(u.uMode, 3);
        gl.drawArrays(gl.LINE_STRIP, 0, 3);
        gl.uniform1f(u.uMode, 4);
        gl.uniform1f(u.uSize, 5);
        gl.drawArrays(gl.POINTS, 0, 2);
      }

      // heads: the main one is the period of the intro, the others are smaller
      attribute(gl, prog, 'aIndex', headIdx, 1);
      attribute(gl, prog, 'aInk', headInk, 1);
      gl.uniform1f(u.uMode, 2);
      gl.uniformMatrix4fv(u.uRotA, false, I);
      gl.uniformMatrix4fv(u.uRotK, false, I);
      tracers.forEach((t) => {
        if (t.on < 0.01) return;
        const w = worldPos(t.idx);
        headPos[0] = w[0]; headPos[1] = w[1]; headPos[2] = w[2];
        gl.bindBuffer(gl.ARRAY_BUFFER, headBuf);
        gl.bufferData(gl.ARRAY_BUFFER, headPos, gl.DYNAMIC_DRAW);
        attribute(gl, prog, 'aPos', headBuf, 3);
        attribute(gl, prog, 'aPosK', headBuf, 3);
        gl.uniform1f(u.uAlpha, t.on);
        gl.uniform1f(u.uSize, (t.k === 0 ? (opts.headSize || 11) : 6.5) * t.on);
        gl.drawArrays(gl.POINTS, 0, 1);
      });
      if (opts.onFrame) opts.onFrame(state);
    }

    function tick(now) {
      if (!state.running) return;
      const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 0;
      state.last = now;
      if (!state.paused) {
        // launch: the dot shoots off, then settles to cruising speed
        state.age += dt;
        state.clock += dt;
        const speed = SPEED * (1 + 9 * Math.exp(-state.age / 1.3));
        state.head += speed * dt;
        state.visited += speed * dt;
        if (state.head >= N) state.head -= N;
        state.yaw = 0.42 * Math.sin(state.clock * 0.16);
        state.morph = morphAt(state.clock);
        // while morphing, the remaining threads spill out so the K arrives fully woven
        if (state.morph > 0 && state.morph < 1) state.visited = Math.min(N, state.visited + 9000 * dt);
      }
      // drag inertia
      state.dragYaw += state.velYaw;
      state.velYaw *= 0.92;
      draw();
      requestAnimationFrame(tick);
    }

    function start() {
      if (state.running) return;
      state.running = true;
      state.last = 0;
      requestAnimationFrame(tick);
    }
    function stop() { state.running = false; }

    /* Screen position (CSS px, relative to the canvas) of the head. */
    function headClient() {
      matrices();
      const h = Math.floor(state.head) % N;
      const p = M.transform(state.mvp, worldPos(h));
      return [(p[0] * 0.5 + 0.5) * canvas.clientWidth, (1 - (p[1] * 0.5 + 0.5)) * canvas.clientHeight];
    }

    // pointer drag
    let dragging = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;      // keep vertical scrolling on touch
      dragging = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
      dragging = { x: e.clientX, y: e.clientY };
      state.velYaw = dx * 0.006;
      state.dragPitch = Math.max(-0.9, Math.min(0.9, state.dragPitch + dy * 0.006));
    });
    const end = () => { dragging = null; canvas.classList.remove('is-dragging'); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // warm-start: a short trail so the first frame is not empty
    state.head = opts.warm || 0;
    state.visited = state.head;
    draw();

    return {
      start, stop, draw, headClient, state,
      setDive(v) { state.dive = Math.max(0, Math.min(1, v)); if (!state.running) draw(); },
      setPaused(v) { state.paused = v; },
      setClock(c) { state.clock = c; state.morph = morphAt(c); if (!state.running) draw(); },
    };
  }

  window.HeroAttractor = { create };
})();
