// Generated from frontend/*.ts by npm run build. Do not edit directly.
"use strict";
(() => {
  // frontend/focus.ts
  var root = document.documentElement;
  root.dataset.focusInput = "pointer";
  var navigationKeys = /* @__PURE__ */ new Set([
    "Tab",
    "Enter",
    " ",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Escape"
  ]);
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (navigationKeys.has(event.key)) root.dataset.focusInput = "keyboard";
    },
    { capture: true }
  );
  document.addEventListener(
    "pointerdown",
    () => {
      root.dataset.focusInput = "pointer";
    },
    { capture: true, passive: true }
  );

  // frontend/interaction.ts
  document.addEventListener(
    "dragstart",
    (event) => {
      const target = event.target;
      const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      const editor = element?.closest("input, textarea, [contenteditable]");
      if (editor?.isContentEditable) return;
      if (editor?.matches("input:not([type=file]), textarea")) {
        const field = editor;
        if (!field.disabled && !field.readOnly) return;
      }
      event.preventDefault();
    },
    { capture: true }
  );

  // frontend/dom.ts
  function required(selector, root2 = document) {
    const element = root2.querySelector(selector);
    if (!element) throw new Error(`Required element missing: ${selector}`);
    return element;
  }
  function message(error) {
    return error instanceof Error ? error.message : "Something went wrong. Try again.";
  }
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // frontend/http.ts
  var RequestError = class extends Error {
    status = 0;
    uncertain = false;
    retryAfter = null;
    code;
  };
  function requestError(error) {
    return error instanceof RequestError ? error : new RequestError(message(error));
  }
  async function request(url, options = {}, binary = false) {
    const { timeoutMilliseconds = 3e4, signal, ...init } = options;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMilliseconds);
    try {
      return await readResponse(url, { ...init, signal: controller.signal }, binary);
    } catch (caught) {
      if (timedOut) {
        const cause = requestError(caught);
        const error = new RequestError("The server took too long to respond. Check your connection.");
        error.status = cause.status;
        error.code = cause.code;
        error.retryAfter = cause.retryAfter;
        error.uncertain = cause.status < 400 || cause.uncertain;
        throw error;
      }
      throw caught;
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async function readResponse(url, options, binary) {
    let response;
    try {
      response = await fetch(url, { credentials: "same-origin", ...options });
    } catch {
      const error = new RequestError("Can\u2019t reach Go Click. Check your connection and try again.");
      error.uncertain = true;
      throw error;
    }
    let data;
    try {
      if (response.ok && binary) return await response.blob();
      data = await response.json();
      if (!isRecord(data)) throw new TypeError("Expected a JSON object");
    } catch {
      if (response.ok) {
        const error = new RequestError("Couldn\u2019t read the server\u2019s response.");
        error.status = response.status;
        error.uncertain = true;
        throw error;
      }
      data = {};
    }
    if (!isRecord(data)) throw new TypeError("Expected a JSON object");
    if (!response.ok) {
      const text = Array.isArray(data.errors) && data.errors.every((item) => typeof item === "string") ? data.errors.join(". ") : typeof data.error === "string" ? data.error : "Request failed. Try again.";
      const error = new RequestError(text);
      error.status = response.status;
      error.code = typeof data.code === "string" ? data.code : void 0;
      error.retryAfter = response.headers.get("Retry-After");
      error.uncertain = response.status >= 500 && error.code !== "authentication_busy";
      throw error;
    }
    return data;
  }

  // frontend/preferences.ts
  var gameSettings = (() => {
    const key = "goclick.settings.v1";
    const browser = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listeners = /* @__PURE__ */ new Set();
    let value = { motion: "auto", simulatedPing: 80 };
    function parse(raw) {
      const decoded = JSON.parse(raw || "{}");
      const saved = isRecord(decoded) ? decoded : {};
      return {
        motion: saved.motion === "on" || saved.motion === "off" ? saved.motion : "auto",
        simulatedPing: saved.simulatedPing === 0 || saved.simulatedPing === 250 || saved.simulatedPing === 800 ? saved.simulatedPing : 80
      };
    }
    try {
      value = parse(localStorage.getItem(key));
    } catch {
    }
    const motion = {
      get matches() {
        return value.motion === "on" || value.motion === "auto" && browser.matches;
      },
      addEventListener(type, callback) {
        if (type === "change") listeners.add(callback);
      }
    };
    let appliedMotion;
    function apply() {
      const matches = motion.matches;
      document.documentElement.dataset.reducedMotion = String(matches);
      if (matches === appliedMotion) return;
      appliedMotion = matches;
      for (const callback of listeners) callback({ matches });
    }
    browser.addEventListener("change", apply);
    window.addEventListener("storage", (event) => {
      if (event.key !== key) return;
      try {
        value = parse(event.newValue);
        apply();
      } catch {
      }
    });
    apply();
    return {
      motion,
      get value() {
        return { ...value };
      },
      update(patch) {
        value = parse(JSON.stringify({ ...value, ...patch }));
        apply();
        localStorage.setItem(key, JSON.stringify(value));
      },
      mode() {
        try {
          return localStorage.getItem("goclick.mode") === "local" ? "local" : "online";
        } catch {
          return "online";
        }
      },
      setMode(mode) {
        localStorage.setItem("goclick.mode", mode);
      }
    };
  })();
  var motionPreference = gameSettings.motion;

  // frontend/types.ts
  var counterKinds = [
    "click_count",
    "streak_counter_day",
    "streak_counter_month",
    "streak_counter_year"
  ];

  // frontend/local-game.ts
  var localGame = /* @__PURE__ */ (() => {
    const key = "goclick.local.v1";
    const kinds = counterKinds;
    function validate(counters) {
      if (!isRecord(counters)) throw new Error("Invalid local counters.");
      const result = {};
      for (const kind of kinds) {
        const entity = counters[kind];
        if (entity == null) {
          result[kind] = null;
          continue;
        }
        if (!isRecord(entity) || typeof entity.count !== "number" || !Number.isSafeInteger(entity.count) || entity.count < 0)
          throw new Error("Invalid local click or streak total.");
        const time = entity.modified_time;
        if (time != null && (typeof time !== "string" || !Number.isFinite(Date.parse(time))))
          throw new Error("Invalid local save timestamp.");
        result[kind] = {
          count: entity.count,
          modified_time: typeof time === "string" ? new Date(time).toISOString() : null
        };
      }
      return result;
    }
    function decode(raw) {
      const save = JSON.parse(raw);
      if (!isRecord(save) || save.format !== "goclick-local" || save.version !== 1)
        throw new Error("Choose a Go Click local save (version 1).");
      return validate(save.counters);
    }
    function read() {
      const raw = localStorage.getItem(key);
      return raw === null ? validate({}) : decode(raw);
    }
    function encode(counters) {
      return JSON.stringify(
        { format: "goclick-local", version: 1, counters: validate(counters) },
        null,
        2
      );
    }
    function write(counters) {
      const clean = validate(counters);
      localStorage.setItem(key, encode(clean));
      return clean;
    }
    function period(time, index) {
      const date = new Date(time);
      return index === 1 ? Math.floor(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 864e5
      ) : index === 2 ? date.getUTCFullYear() * 12 + date.getUTCMonth() : date.getUTCFullYear();
    }
    function increment(now = /* @__PURE__ */ new Date()) {
      const counters = read(), time = now.toISOString();
      for (const [index, kind] of kinds.entries()) {
        const old = counters[kind], count = old?.count ?? 0;
        let next = count + 1;
        if (index > 0) {
          const gap = old?.modified_time ? period(time, index) - period(old.modified_time, index) : Infinity;
          next = count === 0 || gap > 1 || gap < 0 ? 1 : gap === 0 ? count : count + 1;
        }
        counters[kind] = { count: next, modified_time: time };
      }
      return write(counters);
    }
    function change(operation) {
      return navigator.locks ? navigator.locks.request(key, operation) : Promise.resolve().then(operation);
    }
    return { key, read, encode, decode, validate, change, increment, replace: write };
  })();

  // frontend/button-3d.ts
  function createButtonRenderer(stage, button) {
    const canvas = required(".button-scene", stage);
    const rig = required(".button-rig", stage);
    const maybeGL = (() => {
      try {
        return canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
      } catch {
        return null;
      }
    })();
    if (!maybeGL) return { draw() {
    } };
    const gl = maybeGL;
    const vertexSource = `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    attribute float face;
    uniform mat3 rotation;
    uniform vec3 translation;
    uniform vec2 viewport;
    uniform float scale;
    uniform float recession;
    varying vec3 worldPosition;
    varying vec3 worldNormal;
    varying vec2 texCoord;
    varying float frontFace;
    void main() {
      worldPosition = rotation * vec3(position.xy * scale, position.z - recession)
        + translation;
      worldNormal = rotation * normalize(vec3(normal.xy / scale, normal.z));
      texCoord = uv;
      frontFace = face;
      float distance = 850. - worldPosition.z;
      gl_Position = vec4(worldPosition.x * 1700. / viewport.x,
        -worldPosition.y * 1700. / viewport.y,
        1.0010005 * distance - 2.0010005, distance);
    }`;
    const fragmentSource = `
    precision mediump float;
    uniform sampler2D lettering;
    uniform float shadow;
    uniform vec2 shadowCenter;
    uniform vec2 shadowSize;
    uniform float shadowBlur;
    uniform float press;
    uniform float flash;
    uniform float response;
    uniform float responseProgress;
    uniform vec3 responseColor;
    varying vec3 worldPosition;
    varying vec3 worldNormal;
    varying vec2 texCoord;
    varying float frontFace;
    void main() {
      if (shadow > .5) {
        vec2 q = abs(worldPosition.xy - shadowCenter) - shadowSize + vec2(24.);
        float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - 24.;
        float alpha = .24 * (1. - smoothstep(-shadowBlur, shadowBlur, d));
        gl_FragColor = vec4(.015, .018, .04, alpha);
        return;
      }
      vec3 n = normalize(worldNormal);
      vec3 light = normalize(vec3(-280., -350., 500.) - worldPosition);
      vec3 view = normalize(vec3(0., 0., 850.) - worldPosition);
      float diffuse = max(dot(n, light), 0.);
      float specular = pow(max(dot(n, normalize(light + view)), 0.), 64.);
      vec3 surface = mix(vec3(1., .77, .25), vec3(1., .55, .08), press * .88);
      vec3 gold = surface * (.52 + .70 * diffuse) * (1. - press * .09);
      gold += vec3(1., .94, .72) * specular * .38;
      gold += vec3(1., .88, .55) * flash * .55 * frontFace;
      // A response travels over the actual face, independently of press/release.
      // Keep most of the gold visible, with extra color around its outer edge.
      float edge = max(abs(texCoord.x - .5), abs(texCoord.y - .5)) * 2.;
      float rim = smoothstep(.72, .98, edge);
      float sweep = exp(-pow((texCoord.x - responseProgress) * 5., 2.));
      gold = mix(gold, responseColor, response * (.12 + .48 * rim + .30 * sweep) * frontFace);
      vec4 text = texture2D(lettering, texCoord);
      gold = mix(gold, text.rgb * (.78 + .22 * diffuse), text.a * frontFace);
      gl_FragColor = vec4(gold, 1.);
    }`;
    function shader(type, source) {
      const item = gl.createShader(type);
      if (!item) throw new Error("Button shader allocation failed");
      gl.shaderSource(item, source);
      gl.compileShader(item);
      if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
        gl.deleteShader(item);
        throw new Error("Button shader could not compile");
      }
      return item;
    }
    const uniformNames = [
      "rotation",
      "translation",
      "viewport",
      "scale",
      "recession",
      "shadow",
      "shadowCenter",
      "shadowSize",
      "shadowBlur",
      "lettering",
      "press",
      "flash",
      "response",
      "responseProgress",
      "responseColor"
    ];
    let program = null;
    let uniforms;
    const vertices = [];
    const rings = [
      { inset: 6, z: 18 },
      { inset: 0, z: 12 },
      { inset: 0, z: -12 },
      { inset: 4, z: -16 }
    ];
    function contour({ inset, z }) {
      const radius = 28 - inset, halfWidth = 130 - inset, halfHeight = 72 - inset;
      const points = [];
      for (const [cx, cy, angle] of [
        [halfWidth - radius, -halfHeight + radius, -90],
        [halfWidth - radius, halfHeight - radius, 0],
        [-halfWidth + radius, halfHeight - radius, 90],
        [-halfWidth + radius, -halfHeight + radius, 180]
      ]) {
        for (let step = 0; step <= 12; step++) {
          const a = (angle + step * 7.5) * Math.PI / 180;
          const nx = Math.cos(a), ny = Math.sin(a);
          points.push({ p: [cx + radius * nx, cy + radius * ny, z], n: [nx, ny] });
        }
      }
      return points;
    }
    function vertex(point, normal, front = 0) {
      vertices.push(...point, ...normal, (point[0] + 130) / 260, (point[1] + 72) / 144, front);
    }
    const contours = rings.map(contour), count = contours[0].length;
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      vertex([0, 0, 18], [0, 0, 1], 1);
      vertex(contours[0][i].p, [0, 0, 1], 1);
      vertex(contours[0][next].p, [0, 0, 1], 1);
      vertex([0, 0, -16], [0, 0, -1]);
      vertex(contours[3][next].p, [0, 0, -1]);
      vertex(contours[3][i].p, [0, 0, -1]);
      for (let ring = 0; ring < rings.length - 1; ring++) {
        const dz = rings[ring].z - rings[ring + 1].z;
        const bevel = rings[ring].inset - rings[ring + 1].inset;
        const length = Math.hypot(dz, bevel);
        const normal = (point) => [
          point.n[0] * dz / length,
          point.n[1] * dz / length,
          bevel / length
        ];
        const a = contours[ring][i], b = contours[ring + 1][i];
        const c = contours[ring + 1][next], d = contours[ring][next];
        vertex(a.p, normal(a));
        vertex(b.p, normal(b));
        vertex(c.p, normal(c));
        vertex(a.p, normal(a));
        vertex(c.p, normal(c));
        vertex(d.p, normal(d));
      }
    }
    const solidCount = vertices.length / 9;
    for (const point of [
      [-230, -180, -42],
      [230, -180, -42],
      [230, 180, -42],
      [-230, -180, -42],
      [230, 180, -42],
      [-230, 180, -42]
    ]) {
      vertex(point, [0, 0, 1]);
    }
    const label = document.createElement("canvas");
    label.width = 780;
    label.height = 432;
    const context = label.getContext("2d");
    if (!context) return { draw() {
    } };
    context.font = "700 114px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#432d0d";
    context.fillText(required(".button-label", button).textContent, 390, 222);
    function initialize() {
      let vertex2 = null, fragment = null, buffer = null, texture = null;
      try {
        program = gl.createProgram();
        if (!program) throw new Error("Button program allocation failed");
        vertex2 = shader(gl.VERTEX_SHADER, vertexSource);
        fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
        gl.attachShader(program, vertex2);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error("Button renderer could not link");
        buffer = gl.createBuffer();
        if (!buffer) throw new Error("Button buffer allocation failed");
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.useProgram(program);
        for (const [name, size, offset] of [
          ["position", 3, 0],
          ["normal", 3, 3],
          ["uv", 2, 6],
          ["face", 1, 8]
        ]) {
          const location = gl.getAttribLocation(program, name);
          if (location < 0) throw new Error("Button attribute unavailable");
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 36, offset * 4);
        }
        uniforms = Object.fromEntries(
          uniformNames.map((name) => [name, gl.getUniformLocation(program, name)])
        );
        texture = gl.createTexture();
        if (!texture) throw new Error("Button texture allocation failed");
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, label);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(uniforms.lettering, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.frontFace(gl.CW);
        gl.clearColor(0, 0, 0, 0);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("Button graphics setup failed");
        return true;
      } catch {
        if (program) gl.deleteProgram(program);
        if (buffer) gl.deleteBuffer(buffer);
        if (texture) gl.deleteTexture(texture);
        return false;
      } finally {
        if (vertex2) gl.deleteShader(vertex2);
        if (fragment) gl.deleteShader(fragment);
      }
    }
    if (!initialize()) return { draw() {
    } };
    let state = {
      x: 0,
      y: 0,
      rx: 0,
      ry: 0,
      press: 0,
      pop: 0,
      flash: 0,
      response: 0,
      responseProgress: 0,
      responseColor: [0.38, 0.84, 0.8]
    };
    let lost = false;
    function draw(next = state) {
      state = { ...next };
      if (lost) return;
      if (!stage.clientWidth || !stage.clientHeight) return;
      const bounds = stage.getBoundingClientRect();
      const gutter = Math.max(
        0,
        Math.min(40, bounds.left, document.documentElement.clientWidth - bounds.right)
      );
      stage.style.setProperty("--canvas-gutter", `${gutter.toFixed(3)}px`);
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const scale = button.offsetWidth / 260 * (1 + Math.max(-0.065, Math.min(0.1, state.pop || 0))), press = Math.max(-0.22, Math.min(1, state.press));
      const rx = state.rx * Math.PI / 180, ry = state.ry * Math.PI / 180;
      const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
      const recession = press * 24;
      const lowest = -Math.abs(cx * sy) * 130 * scale - Math.abs(sx) * 72 * scale + Math.min(cx * cy * (-16 - recession), cx * cy * (18 - recession));
      const lift = Math.max(0, -34 - lowest);
      rig.style.setProperty("--lift", `${lift.toFixed(3)}px`);
      gl.uniform2f(uniforms.viewport, width, height);
      gl.uniform1f(uniforms.press, Math.max(0, press));
      gl.uniform1f(uniforms.flash, state.flash || 0);
      gl.uniform1f(uniforms.response, state.response || 0);
      gl.uniform1f(uniforms.responseProgress, state.responseProgress || 0);
      gl.uniform3f(uniforms.responseColor, ...state.responseColor || [0.38, 0.84, 0.8]);
      const centerX = state.x - sy * recession, centerY = state.y + sx * cy * recession;
      const centerZ = lift - cx * cy * recession, clearance = 42 + centerZ;
      const projection = clearance / (500 - centerZ);
      gl.uniformMatrix3fv(uniforms.rotation, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
      gl.uniform3f(uniforms.translation, 0, 0, 0);
      gl.uniform1f(uniforms.scale, 1);
      gl.uniform1f(uniforms.shadow, 1);
      gl.uniform1f(uniforms.recession, 0);
      gl.uniform2f(
        uniforms.shadowCenter,
        centerX + (centerX + 280) * projection,
        centerY + (centerY + 350) * projection
      );
      gl.uniform2f(
        uniforms.shadowSize,
        126 * scale * (1 - Math.abs(sy) * 0.15),
        70 * scale * (1 - Math.abs(sx) * 0.15)
      );
      gl.uniform1f(uniforms.shadowBlur, 8 + clearance * 0.18);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, solidCount, 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.uniformMatrix3fv(uniforms.rotation, false, [
        cy,
        sx * sy,
        -cx * sy,
        0,
        cx,
        sx,
        sy,
        -sx * cy,
        cx * cy
      ]);
      gl.uniform3f(uniforms.translation, state.x, state.y, lift);
      gl.uniform1f(uniforms.recession, recession);
      gl.uniform1f(uniforms.scale, scale);
      gl.uniform1f(uniforms.shadow, 0);
      gl.drawArrays(gl.TRIANGLES, 0, solidCount);
      stage.classList.add("is-rendered");
    }
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
      stage.classList.remove("is-rendered");
      rig.style.removeProperty("--lift");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      lost = !initialize();
      if (!lost) draw(state);
    });
    const renderer = { draw };
    draw();
    return renderer;
  }

  // frontend/button.ts
  var tactileButtons = /* @__PURE__ */ new Map();
  for (const button of document.querySelectorAll("[data-tactile-button]")) {
    let paint2 = function() {
      rig.style.setProperty("--shift-x", `${current.x.toFixed(3)}px`);
      rig.style.setProperty("--shift-y", `${current.y.toFixed(3)}px`);
      rig.style.setProperty("--tilt-x", `${current.rx.toFixed(3)}deg`);
      rig.style.setProperty("--tilt-y", `${current.ry.toFixed(3)}deg`);
      rig.style.setProperty("--press", clamp(current.press, -0.22, 1).toFixed(3));
      rig.style.setProperty("--button-pop", (1 + clamp(current.pop, -0.065, 0.1)).toFixed(3));
      rig.style.setProperty(
        "--response-wash",
        `rgba(${current.responseColor.map((value) => Math.round(value * 255)).join(",")},${(current.response * 0.5).toFixed(3)})`
      );
      renderer?.draw(current);
    }, tick2 = function(time) {
      const dt = lastFrame ? clamp((time - lastFrame) / (1e3 / 60), 0.25, 2) : 1;
      lastFrame = time;
      let moving = false;
      for (const key of keys) {
        const press = key === "press";
        velocity[key] = (velocity[key] + (target[key] - current[key]) * (press ? 0.4 : 0.16) * dt) * Math.pow(press ? 0.6 : 0.64, dt);
        current[key] += velocity[key] * dt;
        if (Math.abs(target[key] - current[key]) > 2e-3 || Math.abs(velocity[key]) > 2e-3)
          moving = true;
        else {
          current[key] = target[key];
          velocity[key] = 0;
        }
      }
      current.flash *= Math.pow(0.68, dt);
      if (current.flash > 5e-3) moving = true;
      else current.flash = 0;
      if (responseStarted !== null) {
        current.responseProgress = clamp((time - responseStarted) / responseDuration, 0, 1);
        current.response = Math.pow(1 - current.responseProgress, 0.65);
        if (current.responseProgress < 1) moving = true;
        else responseStarted = null;
      }
      paint2();
      frame = moving && !document.hidden ? requestAnimationFrame(tick2) : 0;
      if (!frame) lastFrame = 0;
    }, animate2 = function() {
      if (reducedMotion.matches) {
        for (const key of keys) {
          current[key] = key === "press" ? target.press : 0;
          velocity[key] = 0;
        }
        current.flash = 0;
        paint2();
        return;
      }
      if (!frame && !document.hidden) frame = requestAnimationFrame(tick2);
    }, setPhase2 = function(next) {
      if (phase === next) return;
      phase = next;
      button.classList.toggle("is-pressed", phase !== "idle");
      stage.classList.toggle("is-pressed", phase !== "idle");
      stage.classList.toggle("is-held", phase === "held");
      button.dispatchEvent(new CustomEvent("buttonstate", { detail: phase }));
    }, begin2 = function() {
      window.clearTimeout(pulseTimer);
      window.clearTimeout(holdTimer);
      clearResponse2();
      target.press = current.press = 1;
      velocity.press = 0;
      target.pop = current.pop = reducedMotion.matches ? 0 : -0.045;
      velocity.pop = 0;
      current.flash = reducedMotion.matches ? 0 : 0.3;
      setPhase2("pressed");
      paint2();
      animate2();
      holdTimer = window.setTimeout(() => setPhase2("held"), 180);
    }, aim2 = function(event) {
      const rect = stage.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1, 1);
      const y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1, 1);
      target.rx = -y * 16;
      target.ry = x * 22;
      target.x = x * 3;
      target.y = y * 3;
      if (pointers.size) {
        const points = [...pointers.values()];
        target.x += clamp(
          points.reduce((sum, point) => sum + point.x - point.startX, 0) / points.length * 0.22,
          -16,
          16
        );
        target.y += clamp(
          points.reduce((sum, point) => sum + point.y - point.startY, 0) / points.length * 0.22,
          -12,
          12
        );
      }
      animate2();
    }, release2 = function(cancelled = false) {
      activeKey = null;
      window.clearTimeout(holdTimer);
      window.clearTimeout(pulseTimer);
      target.press = 0;
      target.pop = 0;
      velocity.press = cancelled || phase === "idle" ? 0 : -0.3;
      setPhase2("idle");
      animate2();
    }, reset2 = function(cancelled = true) {
      clearResponse2();
      const captured = [...pointers.keys()];
      pointers.clear();
      for (const id of captured) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
      release2(cancelled);
      for (const key of keys) target[key] = 0;
      animate2();
    }, clearResponse2 = function() {
      responseStarted = null;
      current.response = 0;
      current.responseProgress = 0;
      delete stage.dataset.response;
    }, respond2 = function(state, milliseconds = 0) {
      current.responseColor = state === "error" ? [1, 0.49, 0.47] : state === "slow" ? [0.64, 0.54, 1] : [0.38, 0.84, 0.8];
      stage.dataset.response = state;
      responseDuration = clamp(300 + milliseconds * 0.4, 320, 800);
      current.responseProgress = reducedMotion.matches ? 0.5 : 0;
      current.response = reducedMotion.matches ? 0.22 : 1;
      responseStarted = reducedMotion.matches ? null : performance.now();
      paint2();
      animate2();
    }, aimPointers2 = function() {
      if (!pointers.size) return;
      const points = [...pointers.values()];
      aim2({
        clientX: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        clientY: points.reduce((sum, point) => sum + point.y, 0) / points.length
      });
    }, burst2 = function() {
      if (reducedMotion.matches) return;
      current.flash = 1;
      current.pop = Math.max(current.pop, 0.045);
      velocity.pop = 0.035;
      paint2();
      animate2();
      while (effects.childElementCount > 32) effects.firstElementChild?.remove();
      const ring = document.createElement("span");
      ring.className = "click-ring";
      effects.append(ring);
      ring.animate(
        [
          { opacity: 0.7, transform: "translate(-50%, -50%) scale(.65)" },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.45)" }
        ],
        { duration: 360, easing: "cubic-bezier(.15,.7,.3,1)" }
      ).finished.then(
        () => ring.remove(),
        () => ring.remove()
      );
      for (let i = 0; i < 7; i++) {
        const particle = document.createElement("span");
        particle.className = "click-particle";
        const angle = i / 7 * Math.PI * 2 - Math.PI / 2, scale = button.offsetWidth / 260;
        const x = Math.cos(angle) * (115 + i % 3 * 4) * scale, y = Math.sin(angle) * 66 * scale;
        particle.style.setProperty(
          "--particle-color",
          ["var(--gold)", "var(--teal)", "var(--violet)"][i % 3]
        );
        effects.append(particle);
        particle.animate(
          [
            { opacity: 0, transform: `translate(${x * 0.95}px, ${y * 0.95}px) scale(.3)` },
            { opacity: 1, offset: 0.16 },
            {
              opacity: 0,
              transform: `translate(${x * 1.22}px, ${y * 1.28 - 16}px) rotate(${i * 45}deg) scale(.4)`
            }
          ],
          { duration: 420 + i * 15, easing: "cubic-bezier(.15,.65,.4,1)" }
        ).finished.then(
          () => particle.remove(),
          () => particle.remove()
        );
      }
    }, activateRelease2 = function(event) {
      activatingRelease = true;
      try {
        if (event)
          button.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              clientX: event.clientX,
              clientY: event.clientY,
              detail: 1
            })
          );
        else button.click();
      } finally {
        activatingRelease = false;
      }
    }, endPointer2 = function(event, cancelled = false) {
      if (!pointers.has(event.pointerId)) return;
      const rect = button.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      pointers.delete(event.pointerId);
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      if (!pointers.size) release2(cancelled || !inside);
      else aimPointers2();
      if (!cancelled && inside && !button.disabled) activateRelease2(event);
      if (!pointers.size && event.pointerType !== "mouse") {
        for (const key of ["x", "y", "rx", "ry"]) target[key] = 0;
        animate2();
      }
    };
    paint = paint2, tick = tick2, animate = animate2, setPhase = setPhase2, begin = begin2, aim = aim2, release = release2, reset = reset2, clearResponse = clearResponse2, respond = respond2, aimPointers = aimPointers2, burst = burst2, activateRelease = activateRelease2, endPointer = endPointer2;
    const maybeStage = button.closest(".button-stage");
    if (!maybeStage) throw new Error("Tactile button needs a stage");
    const stage = maybeStage;
    const rig = required(".button-rig", stage);
    const effects = document.createElement("div");
    effects.className = "button-effects";
    effects.setAttribute("aria-hidden", "true");
    stage.append(effects);
    const reducedMotion = motionPreference;
    const keys = ["x", "y", "rx", "ry", "press", "pop"];
    const current = {
      x: 0,
      y: 0,
      rx: 0,
      ry: 0,
      press: 0,
      pop: 0,
      flash: 0,
      response: 0,
      responseProgress: 0,
      responseColor: [0.38, 0.84, 0.8]
    };
    const target = { ...current }, velocity = { ...current };
    let renderer = null;
    let setupFrame = 0, frame = 0, lastFrame = 0;
    const pointers = /* @__PURE__ */ new Map();
    let activeKey = null;
    let activatingRelease = false;
    let pulseTimer = 0, holdTimer = 0, phase = "idle";
    let responseStarted = null;
    let responseDuration = 500;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    stage.addEventListener("pointermove", (event) => {
      if (button.disabled) return;
      const point = pointers.get(event.pointerId);
      if (point) {
        point.x = event.clientX;
        point.y = event.clientY;
        aimPointers2();
      } else if (!pointers.size && activeKey === null && event.pointerType === "mouse") aim2(event);
    });
    stage.addEventListener("pointerleave", () => {
      if (!pointers.size && activeKey === null) reset2(false);
    });
    button.addEventListener("pointerdown", (event) => {
      if (button.disabled || event.button !== 0 || activeKey !== null || pointers.has(event.pointerId))
        return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      button.focus({ preventScroll: true });
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY
      });
      if (pointers.size === 1) begin2();
      button.setPointerCapture(event.pointerId);
      aimPointers2();
    });
    button.addEventListener("pointerup", (event) => endPointer2(event));
    button.addEventListener("pointercancel", (event) => endPointer2(event, true));
    button.addEventListener("lostpointercapture", (event) => endPointer2(event, true));
    button.addEventListener("dragstart", (event) => event.preventDefault());
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("keydown", (event) => {
      if (button.disabled || event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (event.repeat || activeKey !== null || pointers.size) return;
      window.getSelection()?.removeAllRanges();
      activeKey = event.key;
      begin2();
    });
    button.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (event.key !== activeKey) return;
      release2();
      if (!button.disabled) activateRelease2();
    });
    button.addEventListener("blur", () => {
      if (activeKey !== null) reset2();
    });
    button.addEventListener("click", (event) => {
      if (!activatingRelease && (event.detail > 0 || event.pointerType)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (button.disabled) return;
      if (event.detail === 0 && !activatingRelease) {
        begin2();
        pulseTimer = window.setTimeout(() => release2(), 80);
      }
      burst2();
    });
    new MutationObserver(() => {
      if (button.disabled) reset2();
    }).observe(button, { attributes: true, attributeFilter: ["disabled"] });
    reducedMotion.addEventListener("change", () => {
      reset2();
      if (reducedMotion.matches) {
        for (const animation of effects.getAnimations({ subtree: true })) animation.cancel();
        effects.replaceChildren();
      }
    });
    window.addEventListener("blur", () => reset2());
    window.addEventListener("resize", () => reset2());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) reset2();
    });
    new ResizeObserver(() => {
      if (!renderer && !setupFrame && stage.clientWidth && stage.clientHeight) {
        setupFrame = requestAnimationFrame(() => {
          setupFrame = 0;
          if (!stage.clientWidth || !stage.clientHeight) return;
          renderer = createButtonRenderer(stage, button);
          paint2();
        });
      } else paint2();
    }).observe(stage);
    tactileButtons.set(button, { reset: reset2, respond: respond2 });
  }
  var paint;
  var tick;
  var animate;
  var setPhase;
  var begin;
  var aim;
  var release;
  var reset;
  var clearResponse;
  var respond;
  var aimPointers;
  var burst;
  var activateRelease;
  var endPointer;

  // frontend/click-feedback.ts
  var clickFeedback = (() => {
    const samples = [], live = /* @__PURE__ */ new Set();
    const average = () => samples.length ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : 150;
    function start(button, event, simulated = false) {
      const stage = button.closest(".button-stage");
      if (!stage) throw new Error("Click feedback needs a stage");
      const rect = stage.getBoundingClientRect();
      const face = button.getBoundingClientRect();
      const pointer = event.detail > 0;
      const x = Math.max(
        40,
        Math.min(rect.width - 40, (pointer ? event.clientX : face.left + face.width / 2) - rect.left)
      );
      const y = Math.max(
        24,
        Math.min(rect.height - 16, (pointer ? event.clientY : face.top + face.height / 2) - rect.top)
      );
      const popup = document.createElement("span"), score = document.createElement("strong"), timing = document.createElement("small");
      popup.className = "click-bonus";
      popup.dataset.state = "pending";
      popup.setAttribute("aria-hidden", "true");
      popup.style.left = `${x}px`;
      popup.style.top = `${y}px`;
      score.textContent = "+1";
      timing.textContent = "\u2026";
      popup.append(score, timing);
      required(".score-effects", stage).append(popup);
      const baseline = average();
      let animation = null;
      let removal = 0, settled = false;
      const slow = window.setTimeout(
        () => {
          if (!settled) {
            popup.dataset.state = "slow";
            timing.textContent = "waiting";
          }
        },
        Math.max(250, baseline * 1.6)
      );
      function remove() {
        settled = true;
        window.clearTimeout(slow);
        window.clearTimeout(removal);
        animation?.cancel();
        popup.remove();
        live.delete(handle);
      }
      const handle = {
        remove,
        reduce() {
          animation?.cancel();
          animation = null;
        },
        success(milliseconds) {
          if (settled) return;
          settled = true;
          window.clearTimeout(slow);
          const ms = Math.max(0, milliseconds);
          popup.dataset.state = ms > Math.max(250, baseline * 1.6) ? "slow" : ms < baseline * 0.7 ? "fast" : "saved";
          tactileButtons.get(button)?.respond(popup.dataset.state, ms);
          timing.textContent = `\u2713 ${Math.round(ms)} ms${simulated ? " \xB7 sim" : ""}`;
          popup.title = `Saved \xB7 ${Math.round(ms)} ms \xB7 recent average ${Math.round(baseline)} ms`;
          samples.push(ms);
          if (samples.length > 20) samples.shift();
          finish();
        },
        fail(uncertain = false) {
          if (settled) return;
          settled = true;
          window.clearTimeout(slow);
          popup.dataset.state = "error";
          tactileButtons.get(button)?.respond("error");
          score.textContent = uncertain ? "?" : "\xD7";
          timing.textContent = uncertain ? "unconfirmed" : "not saved";
          finish();
        }
      };
      function finish() {
        if (!motionPreference.matches)
          animation = popup.animate(
            [
              { transform: "translate(-50%, -115%) scale(1)", opacity: 0.85 },
              { transform: "translate(-50%, -135%) scale(1.06)", opacity: 0.85, offset: 0.18 },
              { transform: "translate(-50%, -220%) scale(.95)", opacity: 0 }
            ],
            { duration: 900, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
          );
        removal = window.setTimeout(remove, motionPreference.matches ? 800 : 950);
      }
      popup.title = `Awaiting save \xB7 recent average ${Math.round(baseline)} ms`;
      live.add(handle);
      while (live.size > 32) live.values().next().value?.remove();
      return handle;
    }
    motionPreference.addEventListener("change", () => {
      if (motionPreference.matches) for (const handle of live) handle.reduce();
    });
    return {
      start,
      reset() {
        for (const handle of live) handle.remove();
        samples.length = 0;
      }
    };
  })();

  // frontend/share.ts
  function formatStats(counters, local) {
    const number = new Intl.NumberFormat("en-US");
    const quantity = (count, unit) => `${number.format(count)} ${unit}${count === 1 ? "" : "s"}`;
    return [
      `Go Click${local ? " \xB7 offline" : ""}`,
      quantity(counters.click_count?.count ?? 0, local ? "local click" : "saved click"),
      `UTC streaks: ${quantity(counters.streak_counter_day?.count ?? 0, "day")} \xB7 ${quantity(counters.streak_counter_month?.count ?? 0, "month")} \xB7 ${quantity(counters.streak_counter_year?.count ?? 0, "year")}`
    ].join("\n");
  }
  var statsShare = (() => {
    const button = required("#share-stats");
    const status = required("#share-status");
    const dialog = required("#share-dialog");
    const text = required("#share-text");
    let generation = 0, busy = false;
    required("#close-share").addEventListener("click", () => dialog.close());
    return {
      reset() {
        generation++;
        busy = false;
        button.setAttribute("aria-busy", "false");
        status.textContent = "";
        text.value = "";
        if (dialog.open) dialog.close();
      },
      async copy(counters, local) {
        if (busy) return;
        busy = true;
        const current = generation;
        const summary = formatStats(counters, local);
        button.setAttribute("aria-busy", "true");
        status.textContent = "";
        try {
          await navigator.clipboard.writeText(summary);
          if (current === generation) status.textContent = "Stats copied.";
        } catch {
          if (current !== generation) return;
          text.value = summary;
          status.textContent = "Select and copy your stats from the dialog.";
          dialog.showModal();
          text.focus();
          text.select();
        } finally {
          if (current === generation) {
            busy = false;
            button.setAttribute("aria-busy", "false");
          }
        }
      }
    };
  })();

  // frontend/app.ts
  var views = {
    loading: required("#loading-view"),
    home: required("#home-view"),
    auth: required("#auth-view"),
    game: required("#game-view")
  };
  var loginForm = required("#login-form");
  var signupForm = required("#signup-form");
  var clickButton = required("#click-button");
  var counterCard = required("#counter-card");
  var retryGameButton = required("#retry-game-button");
  var retryBootButton = required("#retry-boot-button");
  var refreshCounterButton = required("#refresh-counter");
  var connection = required("#connection");
  var pendingIndicator = required("#pending-clicks");
  var currentView = "";
  var viewAnimation = null;
  var pingStateTimer = 0;
  var pendingIndicatorTimer = 0;
  var numberAnimations = /* @__PURE__ */ new WeakMap();
  motionPreference.addEventListener("change", () => {
    if (!motionPreference.matches) return;
    viewAnimation?.cancel();
    for (const id of ["click-count", "day-streak", "month-streak", "year-streak"])
      numberAnimations.get(required(`#${id}`))?.cancel();
  });
  var user = null;
  var localMode = gameSettings.mode() === "local";
  var lastOnlineCounters = null;
  var displayedCounters = {};
  var gameReady = false;
  var pendingClicks = 0;
  var localSaveReplacing = false;
  var localRefreshQueued = false;
  var localAcknowledgement = 0;
  var clickBatchFailed = false;
  var signingOut = false;
  var clickGeneration = 0;
  var counterLoad = null;
  var counterLoadOwner = null;
  var refreshQueued = false;
  var offline = navigator.onLine === false;
  var lastCounterSync = -Infinity;
  var maxPendingClicks = 6;
  function show(view) {
    const changed = view !== currentView;
    if (changed) {
      for (const controller of tactileButtons.values()) controller.reset();
      viewAnimation?.cancel();
    }
    currentView = view;
    if (changed) window.scrollTo(0, 0);
    const authenticated = view === "game";
    views.loading.hidden = view !== "loading";
    views.home.hidden = view !== "home";
    views.auth.hidden = view !== "login" && view !== "signup";
    views.game.hidden = !authenticated;
    loginForm.hidden = view !== "login";
    signupForm.hidden = view !== "signup";
    required("#guest-nav").hidden = authenticated || view === "loading";
    required("#user-nav").hidden = !authenticated || localMode;
    required("#local-nav").hidden = !authenticated || !localMode;
    if (changed && view !== "loading" && !motionPreference.matches) {
      const incoming = view === "login" ? loginForm : view === "signup" ? signupForm : views[view];
      viewAnimation = incoming.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" }
      );
    }
    if (view === "login") {
      showError("#login-error", "");
      resetPasswordVisibility(loginForm);
      required("#login-identifier").focus();
    }
    if (view === "signup") {
      showError("#signup-error", "");
      resetPasswordVisibility(signupForm);
      required("#signup-username").focus();
    }
  }
  function showError(id, message2, focus = false) {
    const element = required(id);
    element.textContent = message2;
    element.hidden = !message2;
    if (message2 && focus) element.focus();
  }
  function setConnection(milliseconds = null, state = "") {
    window.clearTimeout(pingStateTimer);
    if (Number.isFinite(milliseconds) && milliseconds !== null)
      required("#ping").textContent = `${Math.round(milliseconds)} ms`;
    const paintState = () => {
      connection.classList.toggle("is-loading", state === "loading" && (!offline || localMode));
      connection.classList.toggle("is-error", state === "error" || offline && !localMode);
      const status = offline && !localMode ? "Offline. Clicking paused" : state === "loading" ? "Request in progress" : state === "error" ? "Last request failed" : "No requests pending";
      connection.setAttribute("aria-label", `Ping ${required("#ping").textContent}. ${status}.`);
    };
    if (!state && connection.classList.contains("is-loading"))
      pingStateTimer = window.setTimeout(paintState, 220);
    else paintState();
  }
  function setSubmitting(form, submitting) {
    const button = required("button[type=submit]", form);
    button.disabled = submitting;
    button.textContent = submitting ? button.dataset.busyLabel ?? "Saving\u2026" : button.dataset.label ?? "Submit";
    form.setAttribute("aria-busy", String(submitting));
  }
  function resetPasswordVisibility(container) {
    container.querySelectorAll("[data-toggle-password]").forEach((button) => {
      const input = required(`#${button.dataset.togglePassword}`);
      input.type = "password";
      button.textContent = "Show";
      button.setAttribute("aria-label", "Show password");
    });
  }
  function api(url, options = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return request(url, { ...options, headers });
  }
  function setUser(nextUser) {
    const identityChanged = user?.id !== nextUser?.id;
    user = nextUser;
    if (identityChanged) lastOnlineCounters = null;
    required("#nav-username").textContent = user?.username ?? "";
    required("#game-username").textContent = user?.username ?? "";
    required("#game-player-id").textContent = user ? `#${user.id}` : "";
    required("#admin-link").hidden = !user?.admin;
    if (identityChanged) {
      resetClickState();
      renderCounters({}, true);
    }
  }
  function resetClickState() {
    clickGeneration++;
    counterLoad = null;
    counterLoadOwner = null;
    counterCard.setAttribute("aria-busy", "false");
    pendingClicks = 0;
    localRefreshQueued = false;
    updatePendingIndicator();
    clickBatchFailed = false;
    refreshQueued = false;
    window.clearTimeout(pingStateTimer);
    required("#ping").textContent = "\u2014 ms";
    connection.classList.remove("is-loading", "is-error");
    connection.setAttribute("aria-label", "Ping: no click measured yet");
    tactileButtons.get(clickButton)?.reset();
    clickFeedback.reset();
    statsShare.reset();
    updateGameControls();
  }
  function updateGameControls() {
    clickButton.disabled = !gameReady || offline && !localMode || signingOut || localMode && localSaveReplacing || !localMode && pendingClicks >= maxPendingClicks;
    refreshCounterButton.disabled = offline && !localMode || signingOut || pendingClicks > 0 || localMode && localSaveReplacing;
    refreshCounterButton.setAttribute(
      "aria-disabled",
      String(refreshCounterButton.disabled || !!counterLoad)
    );
    refreshCounterButton.setAttribute("aria-busy", String(!!counterLoad));
    required("#share-stats").disabled = !gameReady || signingOut || pendingClicks > 0 || !!counterLoad || localSaveReplacing;
    required("#network-notice").hidden = !offline || localMode;
    required("#local-mode-note").hidden = !localMode;
    required("#counter-label").textContent = localMode ? "Local clicks" : "Saved clicks";
    required(".connection-label").textContent = localMode ? "Sim ping" : "Ping";
    document.querySelectorAll("[data-play-local]").forEach((button) => {
      button.hidden = localMode;
      button.disabled = pendingClicks > 0 || signingOut || localSaveReplacing;
    });
    required("#leave-local").disabled = pendingClicks > 0 || localSaveReplacing;
    required("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0 || localSaveReplacing;
    for (const id of ["#restart-local", "#import-local", "#download-local", "#replace-local"])
      required(id).disabled = localSaveReplacing;
    if (localMode) {
      required("#game-username").textContent = "Offline play";
      required("#game-player-id").textContent = "this browser";
    }
  }
  function updatePendingIndicator() {
    if (pendingClicks === 0) {
      window.clearTimeout(pendingIndicatorTimer);
      pendingIndicatorTimer = 0;
      pendingIndicator.hidden = true;
      pendingIndicator.textContent = "";
      return;
    }
    pendingIndicator.textContent = `+${pendingClicks} pending`;
    if (pendingIndicator.hidden && !pendingIndicatorTimer)
      pendingIndicatorTimer = window.setTimeout(() => {
        pendingIndicatorTimer = 0;
        pendingIndicator.hidden = pendingClicks === 0;
      }, 180);
  }
  function animateNumber(element) {
    if (motionPreference.matches) return;
    numberAnimations.get(element)?.cancel();
    numberAnimations.set(
      element,
      element.animate(
        [
          { transform: "scale(1)", color: "var(--ink)" },
          { transform: "scale(1.08)", color: "var(--gold)", offset: 0.25 },
          { transform: "scale(1)", color: "var(--ink)" }
        ],
        { duration: 240, easing: "cubic-bezier(.2,.75,.3,1)" }
      )
    );
  }
  function renderCounters(data, allowDecrease = false) {
    const clicks = data.click_count;
    const displayedClicks = Number(required("#click-count").textContent);
    if (!allowDecrease && clicks && Number.isFinite(displayedClicks) && clicks.count < displayedClicks)
      return;
    displayedCounters = data;
    for (const [id, count] of [
      ["click-count", clicks?.count ?? 0],
      ["day-streak", data.streak_counter_day?.count ?? 0],
      ["month-streak", data.streak_counter_month?.count ?? 0],
      ["year-streak", data.streak_counter_year?.count ?? 0]
    ]) {
      const element = required(`#${id}`), changed = element.textContent !== String(count);
      element.textContent = String(count);
      if (changed && !allowDecrease) animateNumber(element);
    }
    required("#last-click").textContent = clicks?.modified_time ? `Last click ${new Date(clicks.modified_time).toLocaleString()}` : "No saved clicks yet.";
  }
  function openGame(initialCounters, verifyIdentity = false) {
    if (localMode) {
      openLocalGame();
      return Promise.resolve();
    }
    if (counterLoad) return counterLoad;
    if (pendingClicks > 0) {
      refreshQueued = true;
      return Promise.resolve();
    }
    let generation = clickGeneration;
    const focusButton = currentView === "login" || currentView === "signup";
    show("game");
    showError("#game-error", "");
    retryGameButton.hidden = true;
    gameReady = false;
    clickButton.disabled = true;
    if (!verifyIdentity) counterCard.setAttribute("aria-busy", "true");
    setConnection(null, "loading");
    const owner = {};
    counterLoadOwner = owner;
    const load = (async () => {
      try {
        const [nextUser, data] = verifyIdentity ? await Promise.all([api("/api/me"), api("/api/clicks")]) : [user, await (initialCounters ?? api("/api/clicks"))];
        if (generation !== clickGeneration) return;
        if (verifyIdentity) {
          const activeLoad = counterLoad;
          setUser(nextUser);
          counterLoad = activeLoad;
          generation = clickGeneration;
          counterLoadOwner = owner;
        }
        lastOnlineCounters = data;
        renderCounters(data, true);
        lastCounterSync = performance.now();
        gameReady = true;
        updateGameControls();
        if (focusButton && !clickButton.disabled) clickButton.focus();
        setConnection();
      } catch (caught) {
        const error = requestError(caught);
        if (generation !== clickGeneration) return;
        if (error.status === 401) {
          if (user && !signingOut) handleExpiredSession();
        } else {
          showError("#game-error", `Couldn\u2019t load your counter. ${error.message}`, !verifyIdentity);
          retryGameButton.hidden = false;
          setConnection(null, "error");
        }
      } finally {
        if (generation === clickGeneration) counterCard.setAttribute("aria-busy", "false");
        if (counterLoadOwner === owner) {
          counterLoad = null;
          counterLoadOwner = null;
        }
        updateGameControls();
      }
    })();
    counterLoad = load;
    updateGameControls();
    return load;
  }
  function refreshGame() {
    if (localMode) {
      if (currentView === "game") openLocalGame();
      return;
    }
    if (currentView !== "game" || !user || signingOut || offline || document.hidden) return;
    refreshQueued = false;
    return openGame(void 0, true);
  }
  window.addEventListener("offline", () => {
    offline = true;
    updateGameControls();
    if (!localMode) setConnection(null, "error");
  });
  window.addEventListener("online", () => {
    offline = false;
    updateGameControls();
    refreshGame();
  });
  function resumeGame() {
    if (gameReady && performance.now() - lastCounterSync < 15e3) return;
    refreshGame();
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resumeGame();
  });
  window.addEventListener("focus", resumeGame);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refreshGame();
  });
  function handleExpiredSession() {
    gameReady = false;
    setUser(null);
    show("login");
    showError("#login-error", "Your session expired. Sign in to keep clicking.", true);
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "home" && user) openGame();
      else if (view === "home" || view === "login" || view === "signup") show(view);
    });
  });
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = required(`#${button.dataset.togglePassword}`);
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.textContent = showing ? "Show" : "Hide";
      button.setAttribute("aria-label", `${showing ? "Show" : "Hide"} password`);
      input.focus();
    });
  });
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("#login-error", "");
    setSubmitting(loginForm, true);
    const generation = clickGeneration;
    try {
      const form = new FormData(loginForm);
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password")
        })
      });
      if (generation !== clickGeneration || currentView !== "login") return;
      loginForm.reset();
      setUser(result.user);
      await openGame();
    } catch (caught) {
      const error = requestError(caught);
      if (generation === clickGeneration && currentView === "login")
        showError("#login-error", error.message, true);
    } finally {
      setSubmitting(loginForm, false);
    }
  });
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("#signup-error", "");
    const form = new FormData(signupForm);
    if (form.get("password") !== form.get("password_confirmation")) {
      showError("#signup-error", "Passwords do not match.", true);
      required("#signup-password-confirmation").focus();
      return;
    }
    setSubmitting(signupForm, true);
    const generation = clickGeneration;
    try {
      const result = await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      if (generation !== clickGeneration || currentView !== "signup") return;
      signupForm.reset();
      setUser(result.user);
      await openGame();
    } catch (caught) {
      const error = requestError(caught);
      if (generation === clickGeneration && currentView === "signup")
        showError("#signup-error", error.message, true);
    } finally {
      setSubmitting(signupForm, false);
    }
  });
  var logoutButton = required("#logout-button");
  logoutButton.addEventListener("click", async () => {
    showError("#game-error", "");
    signingOut = true;
    gameReady = false;
    updateGameControls();
    logoutButton.disabled = true;
    try {
      await api("/api/auth/logout", { method: "DELETE" });
      setUser(null);
      show("home");
    } catch (caught) {
      const error = requestError(caught);
      gameReady = true;
      showError("#game-error", `Could not sign out: ${error.message}`, true);
    } finally {
      signingOut = false;
      logoutButton.disabled = false;
      updateGameControls();
    }
  });
  clickButton.addEventListener("click", async (event) => {
    if (localMode) {
      await clickLocal(event);
      return;
    }
    if (!gameReady || offline && !localMode || signingOut || !localMode && pendingClicks >= maxPendingClicks)
      return;
    if (pendingClicks === 0) {
      showError("#game-error", "");
      clickBatchFailed = false;
    }
    pendingClicks++;
    updatePendingIndicator();
    const feedback = clickFeedback.start(clickButton, event);
    updateGameControls();
    const started = performance.now();
    const generation = clickGeneration;
    setConnection(null, "loading");
    let saved = false;
    try {
      const data = await api("/api/clicks", { method: "POST" });
      if (generation !== clickGeneration) return;
      renderCounters(data);
      if ((data.click_count?.count ?? 0) >= (lastOnlineCounters?.click_count?.count ?? 0))
        lastOnlineCounters = data;
      feedback.success(performance.now() - started);
      saved = true;
    } catch (caught) {
      const error = requestError(caught);
      if (generation !== clickGeneration) return;
      feedback.fail(error.uncertain);
      if (error.status === 401) {
        if (user && !signingOut) handleExpiredSession();
        return;
      }
      clickBatchFailed = true;
      showError(
        "#game-error",
        error.status === 429 && error.retryAfter ? `Slow down for ${error.retryAfter} seconds.` : error.uncertain ? `Couldn\u2019t confirm your click. Reload your counter to check whether it saved. ${error.message}` : `Your click wasn\u2019t saved. ${error.message}`,
        true
      );
      if (error.uncertain) retryGameButton.hidden = false;
      setConnection(null, "error");
    } finally {
      if (generation === clickGeneration) {
        pendingClicks--;
        updatePendingIndicator();
        updateGameControls();
        if (!clickBatchFailed && pendingClicks > 0) {
          setConnection(null, "loading");
        } else if (!clickBatchFailed && saved) {
          setConnection(performance.now() - started);
        }
        if (pendingClicks === 0 && refreshQueued) refreshGame();
      }
    }
  });
  async function boot() {
    if (localMode) {
      openLocalGame();
      return;
    }
    const generation = clickGeneration;
    show("loading");
    views.loading.setAttribute("aria-busy", "true");
    required(".loading-spinner").hidden = false;
    required("#loading-message").textContent = "Loading your counter\u2026";
    retryBootButton.hidden = true;
    try {
      const counters = api("/api/clicks");
      counters.catch(() => {
      });
      const identity = await api("/api/me");
      if (generation !== clickGeneration || localMode) return;
      setUser(identity);
      await openGame(counters);
    } catch (caught) {
      const error = requestError(caught);
      if (generation !== clickGeneration || localMode) return;
      if (error.status === 401) {
        show("home");
        return;
      }
      required(".loading-spinner").hidden = true;
      required("#loading-message").textContent = error.message;
      retryBootButton.hidden = false;
      views.loading.setAttribute("aria-busy", "false");
      retryBootButton.focus();
    }
  }
  retryGameButton.addEventListener("click", refreshGame);
  refreshCounterButton.addEventListener("click", refreshGame);
  required("#share-stats").addEventListener("click", () => {
    if (!gameReady || signingOut || pendingClicks > 0 || counterLoad || localSaveReplacing) return;
    return statsShare.copy(displayedCounters, localMode);
  });
  retryBootButton.addEventListener("click", () => boot());
  var optionsDialog = required("#options-dialog");
  function optionsNotice(message2, error = false) {
    const notice = required("#options-status");
    notice.textContent = message2;
    notice.hidden = !message2;
    notice.classList.toggle("notice-error", error);
  }
  function updateOptions() {
    required("#motion-setting").value = gameSettings.value.motion;
    required("#simulated-ping").value = String(gameSettings.value.simulatedPing);
    required("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0 || localSaveReplacing;
    required("#copy-online-note").textContent = lastOnlineCounters ? `Copy the last loaded account progress for ${user?.username ?? "your account"}. This only replaces the local save.` : "Open your account counter first to make a copy. Copying only replaces the local save.";
    try {
      const data = localGame.read();
      required("#local-save-summary").textContent = `${data.click_count?.count ?? 0} clicks saved in this browser.`;
    } catch (caught) {
      const error = requestError(caught);
      required("#local-save-summary").textContent = `Local save unavailable. ${error.message}`;
    }
  }
  required("#options-button").addEventListener("click", () => {
    optionsNotice("");
    required("#replace-local").checked = false;
    updateOptions();
    optionsDialog.showModal();
  });
  required("#close-options").addEventListener("click", () => optionsDialog.close());
  function saveOption(patch) {
    try {
      gameSettings.update(patch);
      optionsNotice("Option saved.");
    } catch {
      optionsNotice(
        "Applied for this visit. Browser storage is unavailable, so this option could not be remembered.",
        true
      );
    }
  }
  required("#motion-setting").addEventListener("change", () => {
    const motion = required("#motion-setting").value;
    if (motion === "auto" || motion === "on" || motion === "off") saveOption({ motion });
  });
  required("#simulated-ping").addEventListener("change", () => {
    const simulatedPing = Number(required("#simulated-ping").value);
    if (simulatedPing === 0 || simulatedPing === 80 || simulatedPing === 250 || simulatedPing === 800)
      saveOption({ simulatedPing });
  });
  function openLocalGame(data) {
    show("game");
    showError("#game-error", "");
    retryGameButton.hidden = true;
    try {
      renderCounters(data ?? localGame.read(), true);
      gameReady = true;
      counterCard.setAttribute("aria-busy", "false");
      updateGameControls();
      setConnection();
    } catch (caught) {
      const error = requestError(caught);
      gameReady = false;
      updateGameControls();
      showError(
        "#game-error",
        `Couldn\u2019t load your local save. ${error.message} Open Options to import a copy or restart the local save.`,
        true
      );
    }
  }
  function startLocalGame() {
    if (pendingClicks > 0 || signingOut || localSaveReplacing) return;
    try {
      const data = localGame.read();
      gameSettings.setMode("local");
      localMode = true;
      gameReady = false;
      resetClickState();
      optionsDialog.close();
      openLocalGame(data);
      clickButton.focus();
    } catch (caught) {
      const error = requestError(caught);
      optionsNotice(`Couldn\u2019t open the local save. ${error.message}`, true);
      if (!optionsDialog.open) {
        updateOptions();
        optionsDialog.showModal();
      }
    }
  }
  document.querySelectorAll("[data-play-local]").forEach((button) => button.addEventListener("click", startLocalGame));
  required("#leave-local").addEventListener("click", () => {
    if (pendingClicks > 0 || localSaveReplacing) return;
    try {
      gameSettings.setMode("online");
    } catch {
      showError(
        "#game-error",
        "Browser storage is unavailable. Couldn\u2019t remember the mode change.",
        true
      );
      return;
    }
    localMode = false;
    gameReady = false;
    resetClickState();
    boot();
  });
  async function clickLocal(event) {
    if (!gameReady || localSaveReplacing) return;
    const feedback = clickFeedback.start(clickButton, event, true), generation = clickGeneration, acknowledgement = ++localAcknowledgement;
    const base = gameSettings.value.simulatedPing;
    const simulated = Math.round(base * (0.7 + Math.random() * 0.6));
    pendingClicks++;
    updateGameControls();
    setConnection(null, "loading");
    try {
      const data = await localGame.change(() => localGame.increment());
      if (generation !== clickGeneration) return;
      renderCounters(data);
      showError("#game-error", "");
      window.setTimeout(() => {
        if (generation !== clickGeneration) return;
        feedback.success(simulated);
        if (acknowledgement === localAcknowledgement) setConnection(simulated);
      }, simulated);
    } catch (caught) {
      const error = requestError(caught);
      if (generation !== clickGeneration) return;
      feedback.fail(false);
      setConnection(null, "error");
      showError(
        "#game-error",
        `Your local click wasn\u2019t saved. Browser storage may be full or unavailable. ${error.message}`,
        true
      );
    } finally {
      if (generation === clickGeneration) {
        pendingClicks--;
        updateGameControls();
        if (pendingClicks === 0 && localRefreshQueued) synchronizeLocalSave();
      }
    }
  }
  async function replaceLocalSave(operation, message2) {
    if (localSaveReplacing) return;
    if (!required("#replace-local").checked) {
      optionsNotice("Check \u201CAllow replacing my local save\u201D first.", true);
      return;
    }
    if (pendingClicks > 0) {
      optionsNotice("Wait for pending clicks to finish, then try again.", true);
      return;
    }
    localSaveReplacing = true;
    required("#replace-local").checked = false;
    updateGameControls();
    optionsNotice("Replacing the local save\u2026");
    try {
      await localGame.change(operation);
      if (localMode) {
        resetClickState();
        openLocalGame();
      }
      updateOptions();
      optionsNotice(message2);
    } catch (caught) {
      const error = requestError(caught);
      optionsNotice(`Local save was not replaced. ${error.message}`, true);
    } finally {
      localSaveReplacing = false;
      updateGameControls();
      if (localRefreshQueued) synchronizeLocalSave();
    }
  }
  required("#restart-local").addEventListener(
    "click",
    () => replaceLocalSave(() => localGame.replace({}), "Local save restarted.")
  );
  required("#copy-online-local").addEventListener("click", () => {
    if (!lastOnlineCounters) return;
    const snapshot = lastOnlineCounters;
    replaceLocalSave(
      () => localGame.replace(snapshot),
      "Account progress copied to the local save. Account progress is unchanged."
    );
  });
  required("#import-local").addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) {
      optionsNotice("Choose a local save smaller than 1 MiB.", true);
      return;
    }
    try {
      await replaceLocalSave(
        async () => localGame.replace(localGame.decode(await file.text())),
        "Local save imported."
      );
    } catch (caught) {
      const error = requestError(caught);
      optionsNotice(`Couldn\u2019t import this local save. ${error.message}`, true);
    }
  });
  required("#download-local").addEventListener("click", async () => {
    try {
      const saved = await localGame.change(() => localGame.encode(localGame.read()));
      const url = URL.createObjectURL(new Blob([saved], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "goclick-local.json";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 6e4);
      optionsNotice("Local save downloaded.");
    } catch (caught) {
      const error = requestError(caught);
      optionsNotice(`Couldn\u2019t download the local save. ${error.message}`, true);
    }
  });
  function synchronizeLocalSave() {
    if (!localMode) return;
    if (pendingClicks > 0 || localSaveReplacing) {
      localRefreshQueued = true;
      return;
    }
    resetClickState();
    openLocalGame();
  }
  window.addEventListener("storage", (event) => {
    if (event.key === localGame.key || event.key === null) synchronizeLocalSave();
  });
  boot();
})();
