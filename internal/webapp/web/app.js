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
  var sessionLock = "goclick.session";
  var cookieMutations = /* @__PURE__ */ new Set([
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/logout",
    "/api/auth/renew",
    "/api/admin/backups/restore"
  ]);
  var renewedExpiries = /* @__PURE__ */ new Map();
  var pendingRenewals = /* @__PURE__ */ new Set();
  function sessionLocks() {
    return typeof navigator === "undefined" ? void 0 : navigator.locks;
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
    let dispatched = false;
    try {
      const send = () => {
        dispatched = true;
        return readResponse(url, { ...init, signal: controller.signal }, binary);
      };
      const locks = sessionLocks();
      return locks && cookieMutations.has(url) ? await locks.request(sessionLock, { signal: controller.signal }, send) : await send();
    } catch (caught) {
      if (timedOut) {
        const cause = requestError(caught);
        const error = new RequestError("The server took too long to respond. Check your connection.");
        error.status = cause.status;
        error.code = cause.code;
        error.retryAfter = cause.retryAfter;
        error.uncertain = dispatched && (cause.status < 400 || cause.uncertain);
        throw error;
      }
      if (!dispatched) throw new RequestError("Request was cancelled before it was sent.");
      throw caught;
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  function renewSession(url, response) {
    if (cookieMutations.has(url) || !sessionLocks()) return;
    const user2 = response.headers?.get("X-GoClick-User-ID");
    const expires = response.headers?.get("X-GoClick-Session-Expires");
    if (!user2 || !expires || !/^[1-9]\d*$/.test(user2) || !/^\d+$/.test(expires)) return;
    const key = `${user2}:${expires}`;
    if (renewedExpiries.get(user2) === expires || pendingRenewals.has(key)) return;
    pendingRenewals.add(key);
    void request("/api/auth/renew", {
      method: "POST",
      headers: { "X-GoClick-User-ID": user2 },
      timeoutMilliseconds: 5e3
    }).then(() => renewedExpiries.set(user2, expires)).catch(() => {
    }).finally(() => pendingRenewals.delete(key));
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
      if (response.ok && binary) {
        const blob = await response.blob();
        renewSession(url, response);
        return blob;
      }
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
    renewSession(url, response);
    return data;
  }
  function retryAfterMilliseconds(value, now = Date.now()) {
    if (!value?.trim()) return 5e3;
    const text = value.trim();
    const delay = /^\d+$/.test(text) ? Number(text) * 1e3 : Date.parse(text) - now;
    return Number.isFinite(delay) ? Math.max(1e3, Math.min(864e5, delay)) : 5e3;
  }

  // frontend/preferences.ts
  var gameSettings = (() => {
    const key = "goclick.settings.v1";
    const browser = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listeners2 = /* @__PURE__ */ new Set();
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
        if (type === "change") listeners2.add(callback);
      }
    };
    let appliedMotion;
    function apply() {
      const matches = motion.matches;
      document.documentElement.dataset.reducedMotion = String(matches);
      if (matches === appliedMotion) return;
      appliedMotion = matches;
      for (const callback of listeners2) callback({ matches });
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
      if (navigator.locks) return navigator.locks.request(key, operation);
      if (typeof indexedDB === "undefined")
        return Promise.reject(new Error("This browser cannot safely coordinate the local save."));
      return new Promise((resolve, reject) => {
        const opening = indexedDB.open("goclick-local-locks", 1);
        let blocked = false;
        opening.onupgradeneeded = () => opening.result.createObjectStore("locks");
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () => {
          blocked = true;
          reject(new Error("Close other Go Click tabs, then try the local save again."));
        };
        opening.onsuccess = () => {
          const database = opening.result;
          if (blocked) {
            database.close();
            return;
          }
          let result;
          let failure;
          try {
            const transaction = database.transaction("locks", "readwrite");
            transaction.oncomplete = () => {
              database.close();
              resolve(result);
            };
            transaction.onabort = () => {
              database.close();
              reject(failure ?? transaction.error ?? new Error("Local save coordination failed."));
            };
            transaction.objectStore("locks").get(key).onsuccess = () => {
              try {
                result = operation();
              } catch (error) {
                failure = error;
                transaction.abort();
              }
            };
          } catch (error) {
            database.close();
            reject(error);
          }
        };
      });
    }
    return { key, read, encode, decode, validate, change, increment, replace: write };
  })();

  // frontend/button-geometry.ts
  function projectButtonPose(state, buttonWidth) {
    const scale = buttonWidth / 260 * (1 + Math.max(-0.065, Math.min(0.1, state.pop || 0)));
    const press = Math.max(-0.22, Math.min(1, state.press));
    const rx = state.rx * Math.PI / 180, ry = state.ry * Math.PI / 180;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const recession = press * 24;
    const lowest = -Math.abs(cx * sy) * 130 * scale - Math.abs(sx) * 72 * scale + Math.min(cx * cy * (-16 - recession), cx * cy * (18 - recession));
    const lift = Math.max(0, -34 - lowest);
    const front = 18 - recession;
    const distance = 850 - (lift + cx * cy * front);
    return {
      scale,
      recession,
      lift,
      cx,
      sx,
      cy,
      sy,
      x: state.x * distance / 850 - sy * front,
      y: state.y * distance / 850 + sx * cy * front,
      rotation: [cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]
    };
  }
  function projectButtonScene(state, buttonWidth, stage, viewport) {
    const pose = projectButtonPose(state, buttonWidth);
    const { scale, recession, lift, cx, sx, cy, sy } = pose;
    const centerX = pose.x - sy * recession, centerY = pose.y + sx * cy * recession;
    const centerZ = lift - cx * cy * recession, clearance = 42 + centerZ;
    const projection = clearance / (500 - centerZ);
    const shadow = {
      x: centerX + (centerX + 280) * projection,
      y: centerY + (centerY + 350) * projection,
      halfWidth: 126 * scale * (1 - Math.abs(sy) * 0.15),
      halfHeight: 70 * scale * (1 - Math.abs(sx) * 0.15),
      blur: 8 + clearance * 0.18
    };
    const groundScale = 850 / 892;
    let left = (shadow.x - shadow.halfWidth - shadow.blur) * groundScale;
    let right = (shadow.x + shadow.halfWidth + shadow.blur) * groundScale;
    let top = (shadow.y - shadow.halfHeight - shadow.blur) * groundScale;
    let bottom = (shadow.y + shadow.halfHeight + shadow.blur) * groundScale;
    for (const x of [-130 * scale, 130 * scale]) {
      for (const y of [-72 * scale, 72 * scale]) {
        for (const z of [-16 - recession, 18 - recession]) {
          const factor = 850 / (850 - (-cx * sy * x + sx * y + cx * cy * z + lift));
          const px = (cy * x + sy * z + pose.x) * factor;
          const py = (sx * sy * x + cx * y - sx * cy * z + pose.y) * factor;
          left = Math.min(left, px);
          right = Math.max(right, px);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
        }
      }
    }
    const originX = stage.left + stage.width / 2, originY = stage.top + stage.height / 2;
    const visibleLeft = Math.max(0, Math.min(viewport.width - 1, originX + left - 4));
    const visibleTop = Math.max(0, Math.min(viewport.height - 1, originY + top - 4));
    const visibleRight = Math.min(viewport.width, Math.max(visibleLeft + 1, originX + right + 4));
    const visibleBottom = Math.min(viewport.height, Math.max(visibleTop + 1, originY + bottom + 4));
    const width = Math.min(viewport.width, Math.ceil((visibleRight - visibleLeft + 32) / 64) * 64);
    const height = Math.min(viewport.height, Math.ceil((visibleBottom - visibleTop + 32) / 64) * 64);
    const frame = {
      left: Math.max(0, Math.min(viewport.width - width, Math.floor((visibleLeft - 16) / 16) * 16)),
      top: Math.max(0, Math.min(viewport.height - height, Math.floor((visibleTop - 16) / 16) * 16)),
      width,
      height
    };
    return {
      ...pose,
      shadow,
      frame,
      originX: originX - frame.left - frame.width / 2,
      originY: originY - frame.top - frame.height / 2
    };
  }

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
    uniform mediump float shadow;
    uniform vec2 origin;
    varying vec3 worldPosition;
    varying vec3 worldNormal;
    varying vec2 texCoord;
    varying float frontFace;
    void main() {
      if (shadow > .5) {
        // Full drawing-surface quad, reconstructed on the background plane.
        // Its bounds follow the projected shadow rather than a fixed world box.
        worldPosition = vec3((position.xy * viewport * .5 - origin) * (892. / 850.), -42.);
        worldNormal = vec3(0., 0., 1.);
        texCoord = uv;
        frontFace = 0.;
        gl_Position = vec4(position.x, -position.y, 0., 1.);
        return;
      }
      worldPosition = rotation * vec3(position.xy * scale, position.z - recession)
        + translation;
      worldNormal = rotation * normalize(vec3(normal.xy / scale, normal.z));
      texCoord = uv;
      frontFace = face;
      float distance = 850. - worldPosition.z;
      gl_Position = vec4((worldPosition.x * 1700. + origin.x * 2. * distance) / viewport.x,
        -(worldPosition.y * 1700. + origin.y * 2. * distance) / viewport.y,
        1.0010005 * distance - 2.0010005, distance);
    }`;
    const fragmentSource = `
    precision mediump float;
    uniform sampler2D surfaceAtlas;
    uniform mediump float shadow;
    uniform vec2 shadowCenter;
    uniform vec2 shadowSize;
    uniform float shadowBlur;
    uniform float copper;
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
      // A full-surface albedo and a separate authored emission mask share one
      // atlas with the lettering. Both are independent of the press material.
      vec4 material = texture2D(surfaceAtlas, vec2(texCoord.x, texCoord.y / 3.));
      float luminous = texture2D(surfaceAtlas, vec2(texCoord.x, (texCoord.y + 1.) / 3.)).a;
      vec3 copperMetal = vec3(.78, .36, .20);
      vec3 patina = vec3(.12, .26, .18);
      vec3 surface = mix(vec3(1., .77, .25), copperMetal, copper);
      surface *= .65 + .7 * material.r;
      vec3 gold = surface * (.52 + .70 * diffuse);
      vec3 reflected = reflect(-view, n);
      float band = exp(-pow((reflected.y + reflected.x * .45 + .05) * 24., 2.));
      float glint = pow(max(dot(n, normalize(light + view)), 0.), 100.);
      gold += vec3(1., .92, .79) * (specular * .38 + copper * (band * .38 + glint * .7));
      // Etched channels glow locally; the metal receives no blanket color wash.
      float pulse = .8 + .2 * exp(-pow((texCoord.x - responseProgress) * 5., 2.));
      float energy = min(1.4, copper * .38 + flash * .65 + response * .8 * pulse);
      vec3 lightColor = response > 0. ? responseColor : vec3(.22, .72, .46);
      float lit = clamp(luminous * energy * 1.8, 0., 1.) * frontFace;
      gold = mix(gold, lightColor * 1.3, lit);
      gold += lightColor * luminous * energy * .2 * frontFace;
      vec2 textCoord = vec2(texCoord.x, (texCoord.y + 2.) / 3.);
      vec4 text = texture2D(surfaceAtlas, textCoord);
      // The lettering is chemically darkened metal with a fine recessed edge,
      // so its reflections move with the face instead of looking like flat ink.
      vec3 inscription = mix(surface * .32, vec3(.055, .19, .12), copper);
      inscription *= .72 + .28 * diffuse;
      inscription += mix(vec3(.28, .19, .065), patina * .38, copper) * (specular * .38 + band * .24);
      float above = texture2D(surfaceAtlas, textCoord - vec2(1. / 780., 1. / 1296.)).a;
      float below = texture2D(surfaceAtlas, textCoord + vec2(1. / 780., 1. / 1296.)).a;
      float engraving = below - above;
      gold = mix(gold, inscription, text.a * frontFace);
      gold += vec3(1., .84, .49) * max(engraving, 0.) * .25 * frontFace;
      gold -= vec3(.14, .10, .04) * max(-engraving, 0.) * frontFace;
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
      "origin",
      "scale",
      "recession",
      "shadow",
      "shadowCenter",
      "shadowSize",
      "shadowBlur",
      "surfaceAtlas",
      "copper",
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
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0]
    ]) {
      vertex(point, [0, 0, 1]);
    }
    const label = document.createElement("canvas");
    label.width = 780;
    label.height = 1296;
    const context = label.getContext("2d");
    if (!context) return { draw() {
    } };
    const labelContext = context;
    const layers = [null, null];
    const lettering = required(".button-label", button);
    let paintedText = "";
    let paintedDirection = "ltr";
    function paintAtlas() {
      labelContext.clearRect(0, 0, 780, 1296);
      labelContext.fillStyle = "#808080";
      labelContext.fillRect(0, 0, 780, 432);
      if (layers[0]) labelContext.drawImage(layers[0], 0, 0, 780, 432);
      if (layers[1]) labelContext.drawImage(layers[1], 0, 432, 780, 432);
      paintedText = lettering.textContent;
      paintedDirection = lettering.dir === "rtl" ? "rtl" : "ltr";
      labelContext.direction = paintedDirection;
      labelContext.font = "700 114px system-ui, sans-serif";
      const width = labelContext.measureText(paintedText).width;
      if (width > 560) labelContext.font = `700 ${114 * 560 / width}px system-ui, sans-serif`;
      labelContext.textAlign = "center";
      labelContext.textBaseline = "middle";
      labelContext.fillStyle = "#fff";
      labelContext.fillText(paintedText, 390, 1086);
    }
    paintAtlas();
    let atlasTexture = null;
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
        gl.uniform1i(uniforms.surfaceAtlas, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.frontFace(gl.CW);
        gl.clearColor(0, 0, 0, 0);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("Button graphics setup failed");
        atlasTexture = texture;
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
      copper: 0,
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
      const direction = lettering.dir === "rtl" ? "rtl" : "ltr";
      if (paintedText !== lettering.textContent || paintedDirection !== direction) {
        try {
          paintAtlas();
          gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, label);
          if (gl.getError() !== gl.NO_ERROR) throw new Error("Lettering upload failed");
        } catch {
          lost = true;
          stage.classList.remove("is-rendered");
          return;
        }
      }
      const bounds = stage.getBoundingClientRect();
      const scene = projectButtonScene(state, button.offsetWidth, bounds, {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      });
      canvas.style.left = `${scene.frame.left - bounds.left}px`;
      canvas.style.top = `${scene.frame.top - bounds.top}px`;
      canvas.style.width = `${scene.frame.width}px`;
      canvas.style.height = `${scene.frame.height}px`;
      const width = scene.frame.width, height = scene.frame.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      rig.style.setProperty("--lift", `${scene.lift.toFixed(3)}px`);
      gl.uniform2f(uniforms.viewport, width, height);
      gl.uniform2f(uniforms.origin, scene.originX, scene.originY);
      gl.uniform1f(uniforms.copper, Math.max(0, Math.min(1, state.copper)));
      gl.uniform1f(uniforms.flash, state.flash || 0);
      gl.uniform1f(uniforms.response, state.response || 0);
      gl.uniform1f(uniforms.responseProgress, state.responseProgress || 0);
      gl.uniform3f(uniforms.responseColor, ...state.responseColor || [0.38, 0.84, 0.8]);
      gl.uniformMatrix3fv(uniforms.rotation, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
      gl.uniform3f(uniforms.translation, 0, 0, 0);
      gl.uniform1f(uniforms.scale, 1);
      gl.uniform1f(uniforms.shadow, 1);
      gl.uniform1f(uniforms.recession, 0);
      gl.uniform2f(uniforms.shadowCenter, scene.shadow.x, scene.shadow.y);
      gl.uniform2f(uniforms.shadowSize, scene.shadow.halfWidth, scene.shadow.halfHeight);
      gl.uniform1f(uniforms.shadowBlur, scene.shadow.blur);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, solidCount, 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.uniformMatrix3fv(uniforms.rotation, false, scene.rotation);
      gl.uniform3f(uniforms.translation, scene.x, scene.y, scene.lift);
      gl.uniform1f(uniforms.recession, scene.recession);
      gl.uniform1f(uniforms.scale, scene.scale);
      gl.uniform1f(uniforms.shadow, 0);
      gl.drawArrays(gl.TRIANGLES, 0, solidCount);
      stage.classList.add("is-rendered");
    }
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      lost = true;
      stage.classList.remove("is-rendered");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      paintAtlas();
      lost = !initialize();
      if (!lost) draw(state);
    });
    const sources = ["/button-material.svg", "/button-glow.svg"];
    for (const [index, source] of sources.entries()) {
      const image = new Image();
      image.onload = () => {
        try {
          layers[index] = image;
          paintAtlas();
          if (lost || !atlasTexture) return;
          gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, label);
          if (gl.getError() !== gl.NO_ERROR) throw new Error("Material texture upload failed");
          draw();
        } catch {
          lost = true;
          stage.classList.remove("is-rendered");
        }
      };
      image.src = source;
    }
    window.addEventListener("scroll", () => draw(), { passive: true });
    const renderer = { draw };
    draw();
    return renderer;
  }

  // frontend/button.ts
  var tactileButtons = /* @__PURE__ */ new Map();
  for (const button of document.querySelectorAll("[data-tactile-button]")) {
    let paint2 = function() {
      const pose = projectButtonPose(current, button.offsetWidth);
      rig.style.setProperty("--shift-x", `${pose.x.toFixed(3)}px`);
      rig.style.setProperty("--shift-y", `${pose.y.toFixed(3)}px`);
      rig.style.setProperty("--lift", `${pose.lift.toFixed(3)}px`);
      rig.style.setProperty("--tilt-x", `${current.rx.toFixed(3)}deg`);
      rig.style.setProperty("--tilt-y", `${current.ry.toFixed(3)}deg`);
      rig.style.setProperty("--press", String(current.press));
      rig.style.setProperty("--copper", current.copper.toFixed(3));
      rig.style.setProperty("--button-pop", (1 + clamp(current.pop, -0.065, 0.1)).toFixed(3));
      stage.style.setProperty(
        "--spark-color",
        `rgb(${current.responseColor.map((value) => Math.round(value * 255)).join(" ")})`
      );
      const glow = Math.min(
        1.4,
        current.copper * 0.38 + current.flash * 0.65 + current.response * 0.8
      );
      rig.style.setProperty("--glow-intensity", glow.toFixed(3));
      const glowColor = current.response > 0 ? current.responseColor : [0.22, 0.72, 0.46];
      rig.style.setProperty(
        "--glow-color",
        `rgb(${glowColor.map((value) => Math.round(value * 255)).join(" ")})`
      );
      renderer?.draw(current);
    }, tick2 = function(time) {
      const dt = lastFrame ? clamp((time - lastFrame) / (1e3 / 60), 0.25, 2) : 1;
      lastFrame = time;
      let moving = false;
      for (const key of keys) {
        const coasting = time < coastUntil && (key === "x" || key === "y");
        const from = key === "x" ? coastFromX : coastFromY;
        const springTarget = coasting ? target[key] + (from - target[key]) * Math.max(0, (coastUntil - time) / 80) : target[key];
        if (pointers.size && (key === "x" || key === "y")) {
          const movement = (target[key] - current[key]) * (1 - Math.exp(-0.4 * dt));
          current[key] += movement;
          velocity[key] = movement / dt;
        } else {
          velocity[key] = (velocity[key] + (springTarget - current[key]) * (coasting ? 0.045 : 0.16) * dt) * Math.pow(coasting ? 0.88 : 0.64, dt);
          current[key] += velocity[key] * dt;
        }
        if (Math.abs(target[key] - current[key]) > 2e-3 || Math.abs(velocity[key]) > 2e-3)
          moving = true;
        else {
          current[key] = target[key];
          velocity[key] = 0;
        }
      }
      if (releasedAt !== null) {
        const progress = clamp((time - releasedAt) / releaseDuration, 0, 1);
        current.copper = releaseCopper * Math.pow(1 - progress, 2);
        if (progress < 1) moving = true;
        else releasedAt = null;
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
          current[key] = 0;
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
      window.clearTimeout(holdTimer);
      clearResponse2();
      coastUntil = 0;
      pressedAt = performance.now();
      releasedAt = null;
      current.press = current.copper = 1;
      target.pop = reducedMotion.matches ? 0 : -0.045;
      current.pop = target.pop;
      velocity.pop = 0;
      current.flash = 0;
      setPhase2("pressed");
      if (reducedMotion.matches) {
        paint2();
        animate2();
      } else burst2(true);
      holdTimer = window.setTimeout(() => setPhase2("held"), 180);
    }, aim2 = function(event) {
      const rect = stage.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1, 1);
      const y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1, 1);
      target.rx = -y * 16;
      target.ry = x * 22;
      target.x = x * 4;
      target.y = y * 4;
      if (pointers.size) {
        const points = [...pointers.values()];
        target.x = dragFromX + points.reduce((sum, point) => sum + point.x - point.startX, 0) / points.length;
        target.y = dragFromY + points.reduce((sum, point) => sum + point.y - point.startY, 0) / points.length;
      }
      animate2();
    }, release2 = function(cancelled = false) {
      activeKey = null;
      window.clearTimeout(holdTimer);
      const wasPressed = phase !== "idle";
      const quick = performance.now() - pressedAt < 90;
      current.press = 0;
      target.pop = current.pop = velocity.pop = 0;
      releaseDuration = quick ? 70 : 110;
      releaseCopper = wasPressed && !cancelled && !reducedMotion.matches ? quick ? 0.72 : 1 : 0;
      current.copper = releaseCopper;
      releasedAt = releaseCopper ? performance.now() : null;
      current.flash = 0;
      setPhase2("idle");
      paint2();
      animate2();
    }, reset2 = function(cancelled = true) {
      clearResponse2();
      const captured = [...pointers.keys()];
      pointers.clear();
      for (const id of captured) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
      release2(cancelled);
      releasedAt = null;
      coastUntil = 0;
      current.copper = 0;
      for (const key of keys) target[key] = 0;
      animate2();
    }, clearResponse2 = function() {
      responseStarted = null;
      current.response = 0;
      current.responseProgress = 0;
      current.responseColor = [1, 0.78, 0.32];
      delete stage.dataset.response;
    }, respond2 = function(state, milliseconds = 0) {
      current.responseColor = state === "error" ? [1, 0.49, 0.47] : state === "slow" ? [0.64, 0.54, 1] : state === "limited" ? [1, 0.58, 0.26] : state === "pending" ? [1, 0.78, 0.32] : state === "fast" ? [0.38, 0.8, 0.65] : [0.35, 0.67, 0.94];
      stage.dataset.response = state;
      responseDuration = clamp(300 + milliseconds * 0.4, 320, 800);
      current.responseProgress = reducedMotion.matches ? 0.5 : 0;
      current.response = state === "pending" ? 0.18 : reducedMotion.matches ? 0.22 : 1;
      responseStarted = state === "pending" || reducedMotion.matches ? null : performance.now();
      paint2();
      animate2();
    }, aimPointers2 = function() {
      if (!pointers.size) return;
      const points = [...pointers.values()];
      aim2({
        clientX: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        clientY: points.reduce((sum, point) => sum + point.y, 0) / points.length
      });
    }, burst2 = function(press = false) {
      if (reducedMotion.matches) return;
      const quick = press || releaseDuration === 70;
      current.flash = press ? 0.72 : quick ? 0.85 : 0.55;
      if (!press) {
        current.pop = Math.max(current.pop, quick ? 0.065 : 0.04);
        velocity.pop = quick ? 0.035 : 0.022;
      }
      paint2();
      animate2();
      const count = press ? 8 : quick ? 12 : 8;
      while (effects.childElementCount > 64 - count) effects.firstElementChild?.remove();
      const width = button.offsetWidth, height = button.offsetHeight;
      for (let i = 0; i < count; i++) {
        const particle = document.createElement("span");
        particle.className = "click-particle";
        const side = i % 4, along = (Math.random() - 0.5) * 0.75;
        const nx = side === 1 ? 1 : side === 3 ? -1 : 0;
        const ny = side === 0 ? -1 : side === 2 ? 1 : 0;
        const x = current.x + (nx ? nx * width / 2 : along * width);
        const y = current.y + (ny ? ny * height / 2 : along * height);
        const drift = (press ? 12 : 22) + Math.random() * (press ? 18 : 28);
        effects.append(particle);
        particle.animate(
          [
            { opacity: 0.95, transform: `translate(${x}px, ${y}px) scale(${quick ? 1.3 : 1})` },
            { opacity: 0.6, offset: 0.22 },
            {
              opacity: 0,
              transform: `translate(${x + nx * drift + along * 15}px, ${y + ny * drift - (press ? 12 : 22)}px) scale(.35)`
            }
          ],
          {
            duration: press ? 520 + Math.random() * 260 : 850 + Math.random() * 650,
            easing: "cubic-bezier(.1,.5,.3,1)"
          }
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
      const point = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      if (!pointers.size) release2(cancelled || !inside);
      else aimPointers2();
      if (!cancelled && inside && !button.disabled) activateRelease2(event);
      if (!pointers.size && !cancelled && inside && !reducedMotion.matches && performance.now() - point.movedAt < 70 && Math.hypot(event.clientX - point.startX, event.clientY - point.startY) >= 14 && Math.hypot(point.vx, point.vy) >= 0.12) {
        coastUntil = performance.now() + 80;
        coastFromX = current.x;
        coastFromY = current.y;
        velocity.x = clamp(point.vx * 10, -14, 14);
        velocity.y = clamp(point.vy * 10, -14, 14);
      }
      const stageRect = stage.getBoundingClientRect();
      const overStage = event.clientX >= stageRect.left && event.clientX <= stageRect.left + stageRect.width && event.clientY >= stageRect.top && event.clientY <= stageRect.top + stageRect.height;
      if (!pointers.size && !cancelled && event.pointerType === "mouse" && overStage) aim2(event);
      else if (!pointers.size) {
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
    const keys = ["x", "y", "rx", "ry", "pop"];
    const current = {
      x: 0,
      y: 0,
      rx: 0,
      ry: 0,
      press: 0,
      copper: 0,
      pop: 0,
      flash: 0,
      response: 0,
      responseProgress: 0,
      responseColor: [0.35, 0.67, 0.94]
    };
    const target = { ...current }, velocity = { ...current };
    let renderer = null;
    let setupFrame = 0, frame = 0, lastFrame = 0;
    const pointers = /* @__PURE__ */ new Map();
    let dragFromX = 0, dragFromY = 0;
    let coastUntil = 0;
    let coastFromX = 0, coastFromY = 0;
    let activeKey = null;
    let activatingRelease = false;
    let pressedAt = 0, releasedAt = null, releaseCopper = 0, releaseDuration = 70, holdTimer = 0, phase = "idle";
    let responseStarted = null;
    let responseDuration = 500;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    stage.addEventListener("pointermove", (event) => {
      if (button.disabled) return;
      const point = pointers.get(event.pointerId);
      if (point) {
        const now = performance.now(), elapsed = now - point.movedAt;
        const dt = clamp(elapsed, 8, 50);
        point.vx = elapsed > 80 ? 0 : point.vx * 0.35 + (event.clientX - point.x) / dt * 0.65;
        point.vy = elapsed > 80 ? 0 : point.vy * 0.35 + (event.clientY - point.y) / dt * 0.65;
        point.movedAt = now;
        point.x = event.clientX;
        point.y = event.clientY;
        aimPointers2();
      } else if (!pointers.size && activeKey === null && event.pointerType === "mouse") aim2(event);
    });
    stage.addEventListener("pointerleave", () => {
      if (!pointers.size && activeKey === null && performance.now() >= coastUntil) reset2(false);
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
        startY: event.clientY,
        vx: 0,
        vy: 0,
        movedAt: performance.now()
      });
      if (pointers.size === 1) {
        dragFromX = current.x;
        dragFromY = current.y;
        velocity.x = velocity.y = 0;
        begin2();
      }
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
        release2();
      }
      burst2();
    });
    new MutationObserver(() => {
      if (button.disabled) reset2();
    }).observe(button, { attributes: true, attributeFilter: ["disabled"] });
    new MutationObserver(() => paint2()).observe(required(".button-label", button), {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["lang", "dir"]
    });
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
      tactileButtons.get(button)?.respond("pending");
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
        fail(uncertain = false, limited = false) {
          if (settled) return;
          settled = true;
          window.clearTimeout(slow);
          popup.dataset.state = limited ? "limited" : "error";
          tactileButtons.get(button)?.respond(limited ? "limited" : "error");
          score.textContent = limited ? "\u2026" : uncertain ? "?" : "\xD7";
          timing.textContent = limited ? "cooldown" : uncertain ? "unconfirmed" : "not saved";
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

  // frontend/messages.ts
  var english = {
    language: "Language",
    account: "Account",
    localGame: "Local game",
    languageHint: "Game language \xB7 remembered in this browser",
    languageVisit: "Game language \xB7 applied for this visit; browser storage is unavailable",
    skip: "Skip to content",
    game: "Play Go Click",
    savedClicks: "Saved clicks",
    localClicks: "Local clicks",
    click: "Click!",
    clickAction: "Click to increment score",
    lastClick: "Last click {time}",
    noClicks: "No saved clicks yet.",
    timezone: "Shown in your local time zone",
    refresh: "Refresh counter",
    share: "Share",
    shareHint: "Copy stats for sharing",
    ping: "Ping",
    simPing: "Sim ping",
    pingHint: "Round-trip time of the last successful click request. The border indicates pending requests or a save error.",
    pingStatus: "{ping}. {status}.",
    noPing: "Ping: no click measured yet",
    coolingStatus: "Server cooldown. Clicking paused",
    offlineStatus: "Offline. Clicking paused",
    loadingStatus: "Request in progress",
    failedStatus: "Last request failed",
    idleStatus: "No requests pending",
    pending: "+{count} pending",
    cooldown: "Cooling down",
    seconds: "{count}s",
    streaks: "Streaks",
    streakLabel: "Click streaks",
    days: "days",
    months: "months",
    years: "years",
    networkNotice: "You\u2019re offline. Clicking is paused. Your saved progress will refresh when you reconnect.",
    localMode: "Offline \xB7 local save",
    offline: "Offline",
    backOnline: "Back online",
    signOut: "Sign out",
    admin: "Admin",
    options: "Options",
    motion: "Turn on motion effects",
    motionHint: "Reduced motion is on. Turn on motion effects.",
    reload: "Reload counter",
    controls: "Press with a mouse or touch, then release inside the button. Each finger counts separately. With the button focused, Space or Enter adds one click on release. Holding never adds extra clicks.",
    loadError: "Couldn\u2019t load your counter. Try reloading it.",
    unconfirmedClick: "Couldn\u2019t confirm your click. Reload your counter to check whether it saved.",
    unsavedClick: "Your click wasn\u2019t saved. Check your connection and try again.",
    localLoadError: "Couldn\u2019t load your local save. Open Options to import a copy or restart the local save.",
    localClickError: "Your local click wasn\u2019t saved. Browser storage may be full or unavailable.",
    signOutError: "Could not sign out. Please try again.",
    shareTitle: "Share stats",
    done: "Done",
    shareInstructions: "Choose what to include. Changing an option updates the preview; copy again to share the customized text.",
    include: "Include",
    siteLink: "Site link",
    clickTotal: "Click total",
    shareDataNote: "Click totals are cumulative. Daily and weekly totals are not part of the current counter summary.",
    preview: "Preview",
    statsToShare: "Stats to share",
    copyText: "Copy text",
    copied: "Stats copied.",
    clipboardUnavailable: "Clipboard unavailable. Select and copy the preview text.",
    statsClicks: "{label}: {count}",
    statsStreaks: "UTC streaks: {day} \xB7 {month} \xB7 {year}",
    playLink: "Play: {url}"
  };
  var translations = {
    "zh-Hans": {
      language: "\u8BED\u8A00",
      account: "\u8D26\u6237",
      localGame: "\u672C\u5730\u6E38\u620F",
      languageHint: "\u6E38\u620F\u8BED\u8A00 \xB7 \u4FDD\u5B58\u5728\u6B64\u6D4F\u89C8\u5668\u4E2D",
      languageVisit: "\u6E38\u620F\u8BED\u8A00 \xB7 \u4EC5\u672C\u6B21\u8BBF\u95EE\u6709\u6548\uFF1B\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528",
      skip: "\u8DF3\u8F6C\u5230\u5185\u5BB9",
      game: "\u73A9 Go Click",
      savedClicks: "\u5DF2\u4FDD\u5B58\u7684\u70B9\u51FB",
      localClicks: "\u672C\u5730\u70B9\u51FB",
      click: "\u70B9\u51FB\uFF01",
      clickAction: "\u70B9\u51FB\u589E\u52A0\u5206\u6570",
      lastClick: "\u4E0A\u6B21\u70B9\u51FB\uFF1A{time}",
      noClicks: "\u5C1A\u65E0\u5DF2\u4FDD\u5B58\u7684\u70B9\u51FB\u3002",
      timezone: "\u6309\u60A8\u7684\u672C\u5730\u65F6\u533A\u663E\u793A",
      refresh: "\u5237\u65B0\u8BA1\u6570",
      share: "\u5206\u4EAB",
      shareHint: "\u590D\u5236\u7EDF\u8BA1\u4EE5\u5206\u4EAB",
      ping: "\u5EF6\u8FDF",
      simPing: "\u6A21\u62DF\u5EF6\u8FDF",
      pingHint: "\u4E0A\u6B21\u6210\u529F\u70B9\u51FB\u8BF7\u6C42\u7684\u5F80\u8FD4\u65F6\u95F4\u3002\u8FB9\u6846\u8868\u793A\u5F85\u5904\u7406\u8BF7\u6C42\u6216\u4FDD\u5B58\u9519\u8BEF\u3002",
      pingStatus: "{ping}\u3002{status}\u3002",
      noPing: "\u5EF6\u8FDF\uFF1A\u5C1A\u672A\u6D4B\u91CF\u70B9\u51FB",
      coolingStatus: "\u670D\u52A1\u5668\u51B7\u5374\u4E2D\u3002\u70B9\u51FB\u5DF2\u6682\u505C",
      offlineStatus: "\u7F51\u7EDC\u5DF2\u65AD\u5F00\u3002\u70B9\u51FB\u5DF2\u6682\u505C",
      loadingStatus: "\u8BF7\u6C42\u5904\u7406\u4E2D",
      failedStatus: "\u4E0A\u6B21\u8BF7\u6C42\u5931\u8D25",
      idleStatus: "\u65E0\u5F85\u5904\u7406\u8BF7\u6C42",
      pending: "+{count} \u5F85\u4FDD\u5B58",
      cooldown: "\u51B7\u5374\u4E2D",
      seconds: "{count}\u79D2",
      streaks: "\u8FDE\u7EED\u8BB0\u5F55",
      streakLabel: "\u8FDE\u7EED\u70B9\u51FB\u8BB0\u5F55",
      days: "\u5929",
      months: "\u4E2A\u6708",
      years: "\u5E74",
      networkNotice: "\u7F51\u7EDC\u5DF2\u65AD\u5F00\uFF0C\u70B9\u51FB\u5DF2\u6682\u505C\u3002\u91CD\u65B0\u8FDE\u63A5\u540E\u5C06\u5237\u65B0\u5DF2\u4FDD\u5B58\u7684\u8FDB\u5EA6\u3002",
      localMode: "\u79BB\u7EBF \xB7 \u672C\u5730\u5B58\u6863",
      offline: "\u79BB\u7EBF",
      backOnline: "\u8FD4\u56DE\u5728\u7EBF\u6A21\u5F0F",
      signOut: "\u9000\u51FA\u767B\u5F55",
      admin: "\u7BA1\u7406",
      options: "\u9009\u9879",
      motion: "\u5F00\u542F\u52A8\u753B\u6548\u679C",
      motionHint: "\u5DF2\u5F00\u542F\u51CF\u5C11\u52A8\u6001\u6548\u679C\u3002\u70B9\u51FB\u5F00\u542F\u52A8\u753B\u3002",
      reload: "\u91CD\u65B0\u52A0\u8F7D\u8BA1\u6570",
      controls: "\u7528\u9F20\u6807\u6216\u89E6\u6478\u6309\u4E0B\uFF0C\u7136\u540E\u5728\u6309\u94AE\u5185\u677E\u5F00\u3002\u6BCF\u6839\u624B\u6307\u5355\u72EC\u8BA1\u6570\u3002\u6309\u94AE\u83B7\u5F97\u7126\u70B9\u540E\uFF0C\u677E\u5F00\u7A7A\u683C\u952E\u6216\u56DE\u8F66\u952E\u53EF\u589E\u52A0\u4E00\u6B21\u70B9\u51FB\u3002\u6309\u4F4F\u4E0D\u4F1A\u589E\u52A0\u989D\u5916\u70B9\u51FB\u3002",
      loadError: "\u65E0\u6CD5\u52A0\u8F7D\u8BA1\u6570\uFF0C\u8BF7\u91CD\u8BD5\u3002",
      unconfirmedClick: "\u65E0\u6CD5\u786E\u8BA4\u70B9\u51FB\u3002\u8BF7\u91CD\u65B0\u52A0\u8F7D\u8BA1\u6570\u4EE5\u68C0\u67E5\u662F\u5426\u5DF2\u4FDD\u5B58\u3002",
      unsavedClick: "\u70B9\u51FB\u672A\u4FDD\u5B58\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002",
      localLoadError: "\u65E0\u6CD5\u52A0\u8F7D\u672C\u5730\u5B58\u6863\u3002\u8BF7\u5728\u9009\u9879\u4E2D\u5BFC\u5165\u526F\u672C\u6216\u91CD\u65B0\u5F00\u59CB\u3002",
      localClickError: "\u672C\u5730\u70B9\u51FB\u672A\u4FDD\u5B58\u3002\u6D4F\u89C8\u5668\u5B58\u50A8\u53EF\u80FD\u5DF2\u6EE1\u6216\u4E0D\u53EF\u7528\u3002",
      signOutError: "\u65E0\u6CD5\u9000\u51FA\u767B\u5F55\uFF0C\u8BF7\u91CD\u8BD5\u3002",
      shareTitle: "\u5206\u4EAB\u7EDF\u8BA1",
      done: "\u5B8C\u6210",
      shareInstructions: "\u9009\u62E9\u8981\u5305\u542B\u7684\u5185\u5BB9\u3002\u66F4\u6539\u9009\u9879\u5C06\u66F4\u65B0\u9884\u89C8\uFF1B\u8BF7\u518D\u6B21\u590D\u5236\u4EE5\u5206\u4EAB\u4FEE\u6539\u540E\u7684\u6587\u672C\u3002",
      include: "\u5305\u542B",
      siteLink: "\u7F51\u7AD9\u94FE\u63A5",
      clickTotal: "\u70B9\u51FB\u603B\u6570",
      shareDataNote: "\u70B9\u51FB\u603B\u6570\u4E3A\u7D2F\u8BA1\u503C\u3002\u5F53\u524D\u6458\u8981\u4E0D\u5305\u542B\u6BCF\u65E5\u548C\u6BCF\u5468\u603B\u6570\u3002",
      preview: "\u9884\u89C8",
      statsToShare: "\u8981\u5206\u4EAB\u7684\u7EDF\u8BA1",
      copyText: "\u590D\u5236\u6587\u672C",
      copied: "\u7EDF\u8BA1\u5DF2\u590D\u5236\u3002",
      clipboardUnavailable: "\u526A\u8D34\u677F\u4E0D\u53EF\u7528\u3002\u8BF7\u9009\u62E9\u5E76\u590D\u5236\u9884\u89C8\u6587\u672C\u3002",
      statsClicks: "{label}\uFF1A{count}",
      statsStreaks: "UTC \u8FDE\u7EED\u8BB0\u5F55\uFF1A{day} \xB7 {month} \xB7 {year}",
      playLink: "\u5F00\u59CB\u6E38\u620F\uFF1A{url}"
    },
    es: {
      language: "Idioma",
      account: "Cuenta",
      localGame: "Juego local",
      languageHint: "Idioma del juego \xB7 se guarda en este navegador",
      languageVisit: "Idioma del juego \xB7 aplicado en esta visita; almacenamiento no disponible",
      skip: "Saltar al contenido",
      game: "Jugar a Go Click",
      savedClicks: "Clics guardados",
      localClicks: "Clics locales",
      click: "\xA1Clic!",
      clickAction: "Haz clic para sumar un punto",
      lastClick: "\xDAltimo clic: {time}",
      noClicks: "A\xFAn no hay clics guardados.",
      timezone: "Se muestra en tu zona horaria local",
      refresh: "Actualizar contador",
      share: "Compartir",
      shareHint: "Copiar estad\xEDsticas para compartir",
      ping: "Latencia",
      simPing: "Latencia simulada",
      pingHint: "Tiempo de ida y vuelta del \xFAltimo clic guardado. El borde indica solicitudes pendientes o un error al guardar.",
      pingStatus: "{ping}. {status}.",
      noPing: "Latencia: a\xFAn no se ha medido ning\xFAn clic",
      coolingStatus: "Pausa del servidor. Clics en pausa",
      offlineStatus: "Sin conexi\xF3n. Clics en pausa",
      loadingStatus: "Solicitud en curso",
      failedStatus: "La \xFAltima solicitud fall\xF3",
      idleStatus: "No hay solicitudes pendientes",
      pending: "+{count} pendientes",
      cooldown: "En pausa",
      seconds: "{count} s",
      streaks: "Rachas",
      streakLabel: "Rachas de clics",
      days: "d\xEDas",
      months: "meses",
      years: "a\xF1os",
      networkNotice: "No tienes conexi\xF3n. Los clics est\xE1n en pausa. Tu progreso guardado se actualizar\xE1 al reconectarte.",
      localMode: "Sin conexi\xF3n \xB7 guardado local",
      offline: "Sin conexi\xF3n",
      backOnline: "Volver al modo en l\xEDnea",
      signOut: "Cerrar sesi\xF3n",
      admin: "Administraci\xF3n",
      options: "Opciones",
      motion: "Activar efectos de movimiento",
      motionHint: "El movimiento reducido est\xE1 activado. Activar efectos de movimiento.",
      reload: "Recargar contador",
      controls: "Pulsa con el rat\xF3n o el dedo y suelta dentro del bot\xF3n. Cada dedo cuenta por separado. Con el bot\xF3n enfocado, Espacio o Intro a\xF1ade un clic al soltar. Mantener pulsado no a\xF1ade clics.",
      loadError: "No se pudo cargar el contador. Intenta recargarlo.",
      unconfirmedClick: "No se pudo confirmar el clic. Recarga el contador para comprobar si se guard\xF3.",
      unsavedClick: "Tu clic no se guard\xF3. Comprueba tu conexi\xF3n e int\xE9ntalo de nuevo.",
      localLoadError: "No se pudo cargar el guardado local. Abre Opciones para importar una copia o reiniciarlo.",
      localClickError: "Tu clic local no se guard\xF3. El almacenamiento del navegador puede estar lleno o no disponible.",
      signOutError: "No se pudo cerrar sesi\xF3n. Int\xE9ntalo de nuevo.",
      shareTitle: "Compartir estad\xEDsticas",
      done: "Listo",
      shareInstructions: "Elige qu\xE9 incluir. Al cambiar una opci\xF3n se actualiza la vista previa; vuelve a copiar para compartir el texto personalizado.",
      include: "Incluir",
      siteLink: "Enlace al sitio",
      clickTotal: "Total de clics",
      shareDataNote: "Los totales de clics son acumulativos. El resumen actual no incluye totales diarios ni semanales.",
      preview: "Vista previa",
      statsToShare: "Estad\xEDsticas para compartir",
      copyText: "Copiar texto",
      copied: "Estad\xEDsticas copiadas.",
      clipboardUnavailable: "Portapapeles no disponible. Selecciona y copia el texto de la vista previa.",
      statsClicks: "{label}: {count}",
      statsStreaks: "Rachas UTC: {day} \xB7 {month} \xB7 {year}",
      playLink: "Jugar: {url}"
    },
    ar: {
      language: "\u0627\u0644\u0644\u063A\u0629",
      account: "\u0627\u0644\u062D\u0633\u0627\u0628",
      localGame: "\u0644\u0639\u0628\u0629 \u0645\u062D\u0644\u064A\u0629",
      languageHint: "\u0644\u063A\u0629 \u0627\u0644\u0644\u0639\u0628\u0629 \xB7 \u062A\u064F\u062D\u0641\u0638 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u062A\u0635\u0641\u062D",
      languageVisit: "\u0644\u063A\u0629 \u0627\u0644\u0644\u0639\u0628\u0629 \xB7 \u0645\u0637\u0628\u0651\u0642\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0632\u064A\u0627\u0631\u0629\u061B \u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u063A\u064A\u0631 \u0645\u062A\u0627\u062D",
      skip: "\u0627\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u062D\u062A\u0648\u0649",
      game: "\u0627\u0644\u0639\u0628 Go Click",
      savedClicks: "\u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629",
      localClicks: "\u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0627\u0644\u0645\u062D\u0644\u064A\u0629",
      click: "\u0627\u0646\u0642\u0631!",
      clickAction: "\u0627\u0646\u0642\u0631 \u0644\u0625\u0636\u0627\u0641\u0629 \u0646\u0642\u0637\u0629",
      lastClick: "\u0622\u062E\u0631 \u0646\u0642\u0631\u0629: {time}",
      noClicks: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u0642\u0631\u0627\u062A \u0645\u062D\u0641\u0648\u0638\u0629 \u0628\u0639\u062F.",
      timezone: "\u064A\u064F\u0639\u0631\u0636 \u0628\u062A\u0648\u0642\u064A\u062A\u0643 \u0627\u0644\u0645\u062D\u0644\u064A",
      refresh: "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0639\u062F\u0627\u062F",
      share: "\u0645\u0634\u0627\u0631\u0643\u0629",
      shareHint: "\u0646\u0633\u062E \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A \u0644\u0645\u0634\u0627\u0631\u0643\u062A\u0647\u0627",
      ping: "\u0632\u0645\u0646 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629",
      simPing: "\u0632\u0645\u0646 \u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0645\u062D\u0627\u0643\u0649",
      pingHint: "\u0645\u062F\u0629 \u0622\u062E\u0631 \u0637\u0644\u0628 \u0646\u0642\u0631\u0629 \u0646\u0627\u062C\u062D \u0630\u0647\u0627\u0628\u064B\u0627 \u0648\u0625\u064A\u0627\u0628\u064B\u0627. \u064A\u0634\u064A\u0631 \u0627\u0644\u0625\u0637\u0627\u0631 \u0625\u0644\u0649 \u0637\u0644\u0628\u0627\u062A \u0645\u0639\u0644\u0651\u0642\u0629 \u0623\u0648 \u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u062D\u0641\u0638.",
      pingStatus: "{ping}. {status}.",
      noPing: "\u0632\u0645\u0646 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629: \u0644\u0645 \u062A\u064F\u0642\u064E\u0633 \u0623\u064A \u0646\u0642\u0631\u0629 \u0628\u0639\u062F",
      coolingStatus: "\u0627\u0644\u062E\u0627\u062F\u0645 \u0641\u064A \u0641\u062A\u0631\u0629 \u0627\u0646\u062A\u0638\u0627\u0631. \u0627\u0644\u0646\u0642\u0631 \u0645\u062A\u0648\u0642\u0641 \u0645\u0624\u0642\u062A\u064B\u0627",
      offlineStatus: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644. \u0627\u0644\u0646\u0642\u0631 \u0645\u062A\u0648\u0642\u0641 \u0645\u0624\u0642\u062A\u064B\u0627",
      loadingStatus: "\u062C\u0627\u0631\u064D \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0637\u0644\u0628",
      failedStatus: "\u0641\u0634\u0644 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0623\u062E\u064A\u0631",
      idleStatus: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0637\u0644\u0628\u0627\u062A \u0645\u0639\u0644\u0651\u0642\u0629",
      pending: "+{count} \u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631",
      cooldown: "\u0641\u062A\u0631\u0629 \u0627\u0646\u062A\u0638\u0627\u0631",
      seconds: "{count} \u062B",
      streaks: "\u0633\u0644\u0627\u0633\u0644 \u0645\u062A\u062A\u0627\u0644\u064A\u0629",
      streakLabel: "\u0633\u0644\u0627\u0633\u0644 \u0627\u0644\u0646\u0642\u0631 \u0627\u0644\u0645\u062A\u062A\u0627\u0644\u064A\u0629",
      days: "\u0623\u064A\u0627\u0645",
      months: "\u0623\u0634\u0647\u0631",
      years: "\u0633\u0646\u0648\u0627\u062A",
      networkNotice: "\u0623\u0646\u062A \u063A\u064A\u0631 \u0645\u062A\u0635\u0644. \u0627\u0644\u0646\u0642\u0631 \u0645\u062A\u0648\u0642\u0641 \u0645\u0624\u0642\u062A\u064B\u0627. \u0633\u064A\u064F\u062D\u062F\u064E\u0651\u062B \u062A\u0642\u062F\u0645\u0643 \u0627\u0644\u0645\u062D\u0641\u0648\u0638 \u0639\u0646\u062F \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644.",
      localMode: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644 \xB7 \u062D\u0641\u0638 \u0645\u062D\u0644\u064A",
      offline: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644",
      backOnline: "\u0627\u0644\u0639\u0648\u062F\u0629 \u0644\u0644\u0627\u062A\u0635\u0627\u0644",
      signOut: "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C",
      admin: "\u0627\u0644\u0625\u062F\u0627\u0631\u0629",
      options: "\u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A",
      motion: "\u062A\u0641\u0639\u064A\u0644 \u062A\u0623\u062B\u064A\u0631\u0627\u062A \u0627\u0644\u062D\u0631\u0643\u0629",
      motionHint: "\u062A\u0642\u0644\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0629 \u0645\u0641\u0639\u0651\u0644. \u062A\u0641\u0639\u064A\u0644 \u062A\u0623\u062B\u064A\u0631\u0627\u062A \u0627\u0644\u062D\u0631\u0643\u0629.",
      reload: "\u0625\u0639\u0627\u062F\u0629 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0639\u062F\u0627\u062F",
      controls: "\u0627\u0636\u063A\u0637 \u0628\u0627\u0644\u0641\u0623\u0631\u0629 \u0623\u0648 \u0628\u0627\u0644\u0644\u0645\u0633\u060C \u062B\u0645 \u0623\u0641\u0644\u062A \u062F\u0627\u062E\u0644 \u0627\u0644\u0632\u0631. \u064A\u064F\u062D\u0633\u0628 \u0643\u0644 \u0625\u0635\u0628\u0639 \u0639\u0644\u0649 \u062D\u062F\u0629. \u0639\u0646\u062F \u062A\u0631\u0643\u064A\u0632 \u0627\u0644\u0632\u0631\u060C \u062A\u0636\u064A\u0641 \u0645\u0633\u0627\u0641\u0629 \u0623\u0648 \u0625\u062F\u062E\u0627\u0644 \u0646\u0642\u0631\u0629 \u0639\u0646\u062F \u0627\u0644\u0625\u0641\u0644\u0627\u062A. \u0627\u0644\u0636\u063A\u0637 \u0627\u0644\u0645\u0637\u0648\u0651\u0644 \u0644\u0627 \u064A\u0636\u064A\u0641 \u0646\u0642\u0631\u0627\u062A.",
      loadError: "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0639\u062F\u0627\u062F. \u062D\u0627\u0648\u0644 \u0625\u0639\u0627\u062F\u0629 \u062A\u062D\u0645\u064A\u0644\u0647.",
      unconfirmedClick: "\u062A\u0639\u0630\u0651\u0631 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0646\u0642\u0631\u0629. \u0623\u0639\u062F \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0639\u062F\u0627\u062F \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u062D\u0641\u0638\u0647\u0627.",
      unsavedClick: "\u0644\u0645 \u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0646\u0642\u0631\u0629. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u062A\u0635\u0627\u0644\u0643 \u0648\u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u064B\u0627.",
      localLoadError: "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A. \u0627\u0641\u062A\u062D \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0646\u0633\u062E\u0629 \u0623\u0648 \u0628\u062F\u0621 \u062D\u0641\u0638 \u062C\u062F\u064A\u062F.",
      localClickError: "\u0644\u0645 \u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0646\u0642\u0631\u0629 \u0645\u062D\u0644\u064A\u064B\u0627. \u0642\u062F \u062A\u0643\u0648\u0646 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0645\u0645\u062A\u0644\u0626\u0629 \u0623\u0648 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629.",
      signOutError: "\u062A\u0639\u0630\u0651\u0631 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u064B\u0627.",
      shareTitle: "\u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A",
      done: "\u062A\u0645",
      shareInstructions: "\u0627\u062E\u062A\u0631 \u0645\u0627 \u062A\u0631\u064A\u062F \u062A\u0636\u0645\u064A\u0646\u0647. \u064A\u0624\u062F\u064A \u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u062E\u064A\u0627\u0631 \u0625\u0644\u0649 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629\u061B \u0627\u0646\u0633\u062E \u0645\u062C\u062F\u062F\u064B\u0627 \u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u062E\u0635\u0651\u0635.",
      include: "\u062A\u0636\u0645\u064A\u0646",
      siteLink: "\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0648\u0642\u0639",
      clickTotal: "\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0646\u0642\u0631\u0627\u062A",
      shareDataNote: "\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0646\u0642\u0631\u0627\u062A \u062A\u0631\u0627\u0643\u0645\u064A. \u0644\u0627 \u064A\u062A\u0636\u0645\u0646 \u0627\u0644\u0645\u0644\u062E\u0635 \u0627\u0644\u062D\u0627\u0644\u064A \u0645\u062C\u0627\u0645\u064A\u0639 \u064A\u0648\u0645\u064A\u0629 \u0623\u0648 \u0623\u0633\u0628\u0648\u0639\u064A\u0629.",
      preview: "\u0645\u0639\u0627\u064A\u0646\u0629",
      statsToShare: "\u0625\u062D\u0635\u0627\u0621\u0627\u062A \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629",
      copyText: "\u0646\u0633\u062E \u0627\u0644\u0646\u0635",
      copied: "\u062A\u0645 \u0646\u0633\u062E \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A.",
      clipboardUnavailable: "\u0627\u0644\u062D\u0627\u0641\u0638\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629. \u062D\u062F\u0651\u062F \u0646\u0635 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0648\u0627\u0646\u0633\u062E\u0647.",
      statsClicks: "{label}: {count}",
      statsStreaks: "\u0627\u0644\u0633\u0644\u0627\u0633\u0644 \u0628\u062A\u0648\u0642\u064A\u062A UTC: {day} \xB7 {month} \xB7 {year}",
      playLink: "\u0627\u0644\u0639\u0628: {url}"
    },
    hi: {
      language: "\u092D\u093E\u0937\u093E",
      account: "\u0916\u093E\u0924\u093E",
      localGame: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0916\u0947\u0932",
      languageHint: "\u0916\u0947\u0932 \u0915\u0940 \u092D\u093E\u0937\u093E \xB7 \u0907\u0938 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u092E\u0947\u0902 \u092F\u093E\u0926 \u0930\u0916\u0940 \u091C\u093E\u090F\u0917\u0940",
      languageVisit: "\u0916\u0947\u0932 \u0915\u0940 \u092D\u093E\u0937\u093E \xB7 \u0907\u0938 \u092C\u093E\u0930 \u0932\u093E\u0917\u0942; \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u0938\u094D\u091F\u094B\u0930\u0947\u091C \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948",
      skip: "\u0938\u093E\u092E\u0917\u094D\u0930\u0940 \u092A\u0930 \u091C\u093E\u090F\u0901",
      game: "Go Click \u0916\u0947\u0932\u0947\u0902",
      savedClicks: "\u0938\u0939\u0947\u091C\u0947 \u0917\u090F \u0915\u094D\u0932\u093F\u0915",
      localClicks: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0915\u094D\u0932\u093F\u0915",
      click: "\u0915\u094D\u0932\u093F\u0915!",
      clickAction: "\u0905\u0902\u0915 \u092C\u0922\u093C\u093E\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0947\u0902",
      lastClick: "\u092A\u093F\u091B\u0932\u093E \u0915\u094D\u0932\u093F\u0915: {time}",
      noClicks: "\u0905\u092D\u0940 \u0915\u094B\u0908 \u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u093E \u0928\u0939\u0940\u0902 \u0917\u092F\u093E \u0939\u0948\u0964",
      timezone: "\u0906\u092A\u0915\u0947 \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u092E\u092F \u0915\u094D\u0937\u0947\u0924\u094D\u0930 \u092E\u0947\u0902 \u0926\u093F\u0916\u093E\u092F\u093E \u0917\u092F\u093E \u0939\u0948",
      refresh: "\u0915\u093E\u0909\u0902\u091F\u0930 \u0930\u0940\u092B\u093C\u094D\u0930\u0947\u0936 \u0915\u0930\u0947\u0902",
      share: "\u0938\u093E\u091D\u093E \u0915\u0930\u0947\u0902",
      shareHint: "\u0938\u093E\u091D\u093E \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0906\u0901\u0915\u0921\u093C\u0947 \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902",
      ping: "\u092A\u093F\u0902\u0917",
      simPing: "\u0938\u093F\u092E\u094D\u092F\u0941\u0932\u0947\u091F\u0947\u0921 \u092A\u093F\u0902\u0917",
      pingHint: "\u092A\u093F\u091B\u0932\u0947 \u0938\u092B\u0932 \u0915\u094D\u0932\u093F\u0915 \u0905\u0928\u0941\u0930\u094B\u0927 \u0915\u093E \u0906\u0928\u0947-\u091C\u093E\u0928\u0947 \u0915\u093E \u0938\u092E\u092F\u0964 \u092C\u0949\u0930\u094D\u0921\u0930 \u0932\u0902\u092C\u093F\u0924 \u0905\u0928\u0941\u0930\u094B\u0927 \u092F\u093E \u0938\u0939\u0947\u091C\u0928\u0947 \u0915\u0940 \u0924\u094D\u0930\u0941\u091F\u093F \u0926\u093F\u0916\u093E\u0924\u093E \u0939\u0948\u0964",
      pingStatus: "{ping}\u0964 {status}\u0964",
      noPing: "\u092A\u093F\u0902\u0917: \u0905\u092D\u0940 \u0915\u093F\u0938\u0940 \u0915\u094D\u0932\u093F\u0915 \u0915\u093E \u0938\u092E\u092F \u0928\u0939\u0940\u0902 \u092E\u093E\u092A\u093E \u0917\u092F\u093E",
      coolingStatus: "\u0938\u0930\u094D\u0935\u0930 \u0935\u093F\u0930\u093E\u092E\u0964 \u0915\u094D\u0932\u093F\u0915 \u0930\u0941\u0915\u0947 \u0939\u0941\u090F \u0939\u0948\u0902",
      offlineStatus: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928\u0964 \u0915\u094D\u0932\u093F\u0915 \u0930\u0941\u0915\u0947 \u0939\u0941\u090F \u0939\u0948\u0902",
      loadingStatus: "\u0905\u0928\u0941\u0930\u094B\u0927 \u091C\u093E\u0930\u0940 \u0939\u0948",
      failedStatus: "\u092A\u093F\u091B\u0932\u093E \u0905\u0928\u0941\u0930\u094B\u0927 \u0935\u093F\u092B\u0932 \u0939\u0941\u0906",
      idleStatus: "\u0915\u094B\u0908 \u0932\u0902\u092C\u093F\u0924 \u0905\u0928\u0941\u0930\u094B\u0927 \u0928\u0939\u0940\u0902",
      pending: "+{count} \u0932\u0902\u092C\u093F\u0924",
      cooldown: "\u0935\u093F\u0930\u093E\u092E \u091C\u093E\u0930\u0940",
      seconds: "{count} \u0938\u0947\u0915\u0902\u0921",
      streaks: "\u0932\u0917\u093E\u0924\u093E\u0930 \u0916\u0947\u0932\u0928\u0947 \u0915\u093E \u0915\u094D\u0930\u092E",
      streakLabel: "\u0932\u0917\u093E\u0924\u093E\u0930 \u0915\u094D\u0932\u093F\u0915 \u0915\u0947 \u0915\u094D\u0930\u092E",
      days: "\u0926\u093F\u0928",
      months: "\u092E\u0939\u0940\u0928\u0947",
      years: "\u0935\u0930\u094D\u0937",
      networkNotice: "\u0906\u092A \u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0939\u0948\u0902\u0964 \u0915\u094D\u0932\u093F\u0915 \u0930\u0941\u0915\u0947 \u0939\u0941\u090F \u0939\u0948\u0902\u0964 \u0926\u094B\u092C\u093E\u0930\u093E \u091C\u0941\u0921\u093C\u0928\u0947 \u092A\u0930 \u0938\u0939\u0947\u091C\u0940 \u0917\u0908 \u092A\u094D\u0930\u0917\u0924\u093F \u0930\u0940\u092B\u093C\u094D\u0930\u0947\u0936 \u0939\u094B\u0917\u0940\u0964",
      localMode: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \xB7 \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935",
      offline: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928",
      backOnline: "\u0911\u0928\u0932\u093E\u0907\u0928 \u0932\u094C\u091F\u0947\u0902",
      signOut: "\u0938\u093E\u0907\u0928 \u0906\u0909\u091F \u0915\u0930\u0947\u0902",
      admin: "\u0935\u094D\u092F\u0935\u0938\u094D\u0925\u093E\u092A\u0928",
      options: "\u0935\u093F\u0915\u0932\u094D\u092A",
      motion: "\u092E\u094B\u0936\u0928 \u0907\u092B\u093C\u0947\u0915\u094D\u091F \u091A\u093E\u0932\u0942 \u0915\u0930\u0947\u0902",
      motionHint: "\u0915\u092E \u0917\u0924\u093F \u091A\u093E\u0932\u0942 \u0939\u0948\u0964 \u092E\u094B\u0936\u0928 \u0907\u092B\u093C\u0947\u0915\u094D\u091F \u091A\u093E\u0932\u0942 \u0915\u0930\u0947\u0902\u0964",
      reload: "\u0915\u093E\u0909\u0902\u091F\u0930 \u092B\u093F\u0930 \u0938\u0947 \u0932\u094B\u0921 \u0915\u0930\u0947\u0902",
      controls: "\u092E\u093E\u0909\u0938 \u092F\u093E \u0938\u094D\u092A\u0930\u094D\u0936 \u0938\u0947 \u0926\u092C\u093E\u090F\u0901, \u092B\u093F\u0930 \u092C\u091F\u0928 \u0915\u0947 \u0905\u0902\u0926\u0930 \u091B\u094B\u0921\u093C\u0947\u0902\u0964 \u0939\u0930 \u0909\u0901\u0917\u0932\u0940 \u0905\u0932\u0917 \u0917\u093F\u0928\u0940 \u091C\u093E\u0924\u0940 \u0939\u0948\u0964 \u092C\u091F\u0928 \u092A\u0930 \u092B\u093C\u094B\u0915\u0938 \u0939\u094B\u0928\u0947 \u092A\u0930 \u0938\u094D\u092A\u0947\u0938 \u092F\u093E \u090F\u0902\u091F\u0930 \u091B\u094B\u0921\u093C\u0928\u0947 \u0938\u0947 \u090F\u0915 \u0915\u094D\u0932\u093F\u0915 \u091C\u0941\u0921\u093C\u0924\u093E \u0939\u0948\u0964 \u0926\u092C\u093E\u090F \u0930\u0916\u0928\u0947 \u0938\u0947 \u0905\u0924\u093F\u0930\u093F\u0915\u094D\u0924 \u0915\u094D\u0932\u093F\u0915 \u0928\u0939\u0940\u0902 \u091C\u0941\u0921\u093C\u0924\u0947\u0964",
      loadError: "\u0915\u093E\u0909\u0902\u091F\u0930 \u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u0941\u0906\u0964 \u092B\u093F\u0930 \u0938\u0947 \u0932\u094B\u0921 \u0915\u0930\u0947\u0902\u0964",
      unconfirmedClick: "\u0915\u094D\u0932\u093F\u0915 \u0915\u0940 \u092A\u0941\u0937\u094D\u091F\u093F \u0928\u0939\u0940\u0902 \u0939\u0941\u0908\u0964 \u0938\u0939\u0947\u091C\u093E \u0917\u092F\u093E \u092F\u093E \u0928\u0939\u0940\u0902, \u091C\u093E\u0901\u091A\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0915\u093E\u0909\u0902\u091F\u0930 \u092B\u093F\u0930 \u0938\u0947 \u0932\u094B\u0921 \u0915\u0930\u0947\u0902\u0964",
      unsavedClick: "\u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u093E \u0928\u0939\u0940\u0902 \u0917\u092F\u093E\u0964 \u0915\u0928\u0947\u0915\u094D\u0936\u0928 \u091C\u093E\u0901\u091A\u0947\u0902 \u0914\u0930 \u092B\u093F\u0930 \u0915\u094B\u0936\u093F\u0936 \u0915\u0930\u0947\u0902\u0964",
      localLoadError: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u0941\u0906\u0964 \u0935\u093F\u0915\u0932\u094D\u092A \u0916\u094B\u0932\u0915\u0930 \u092A\u094D\u0930\u0924\u093F \u0906\u092F\u093E\u0924 \u0915\u0930\u0947\u0902 \u092F\u093E \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0926\u094B\u092C\u093E\u0930\u093E \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902\u0964",
      localClickError: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u093E \u0928\u0939\u0940\u0902 \u0917\u092F\u093E\u0964 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u0938\u094D\u091F\u094B\u0930\u0947\u091C \u092D\u0930\u093E \u092F\u093E \u0905\u0928\u0941\u092A\u0932\u092C\u094D\u0927 \u0939\u094B \u0938\u0915\u0924\u093E \u0939\u0948\u0964",
      signOutError: "\u0938\u093E\u0907\u0928 \u0906\u0909\u091F \u0928\u0939\u0940\u0902 \u0939\u0941\u0906\u0964 \u092B\u093F\u0930 \u0915\u094B\u0936\u093F\u0936 \u0915\u0930\u0947\u0902\u0964",
      shareTitle: "\u0906\u0901\u0915\u0921\u093C\u0947 \u0938\u093E\u091D\u093E \u0915\u0930\u0947\u0902",
      done: "\u0939\u094B \u0917\u092F\u093E",
      shareInstructions: "\u091A\u0941\u0928\u0947\u0902 \u0915\u093F \u0915\u094D\u092F\u093E \u0936\u093E\u092E\u093F\u0932 \u0915\u0930\u0928\u093E \u0939\u0948\u0964 \u0935\u093F\u0915\u0932\u094D\u092A \u092C\u0926\u0932\u0928\u0947 \u092A\u0930 \u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928 \u092C\u0926\u0932\u0947\u0917\u093E; \u0938\u093E\u091D\u093E \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u092B\u093F\u0930 \u0938\u0947 \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902\u0964",
      include: "\u0936\u093E\u092E\u093F\u0932 \u0915\u0930\u0947\u0902",
      siteLink: "\u0938\u093E\u0907\u091F \u0932\u093F\u0902\u0915",
      clickTotal: "\u0915\u0941\u0932 \u0915\u094D\u0932\u093F\u0915",
      shareDataNote: "\u0915\u0941\u0932 \u0915\u094D\u0932\u093F\u0915 \u0938\u0902\u091A\u092F\u0940 \u0939\u0948\u0902\u0964 \u092E\u094C\u091C\u0942\u0926\u093E \u0938\u093E\u0930\u093E\u0902\u0936 \u092E\u0947\u0902 \u0926\u0948\u0928\u093F\u0915 \u0914\u0930 \u0938\u093E\u092A\u094D\u0924\u093E\u0939\u093F\u0915 \u0915\u0941\u0932 \u0936\u093E\u092E\u093F\u0932 \u0928\u0939\u0940\u0902 \u0939\u0948\u0902\u0964",
      preview: "\u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928",
      statsToShare: "\u0938\u093E\u091D\u093E \u0915\u093F\u090F \u091C\u093E\u0928\u0947 \u0935\u093E\u0932\u0947 \u0906\u0901\u0915\u0921\u093C\u0947",
      copyText: "\u091F\u0947\u0915\u094D\u0938\u094D\u091F \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902",
      copied: "\u0906\u0901\u0915\u0921\u093C\u0947 \u0915\u0949\u092A\u0940 \u0939\u094B \u0917\u090F\u0964",
      clipboardUnavailable: "\u0915\u094D\u0932\u093F\u092A\u092C\u094B\u0930\u094D\u0921 \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964 \u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928 \u0915\u093E \u091F\u0947\u0915\u094D\u0938\u094D\u091F \u091A\u0941\u0928\u0915\u0930 \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902\u0964",
      statsClicks: "{label}: {count}",
      statsStreaks: "UTC \u0915\u094D\u0930\u092E: {day} \xB7 {month} \xB7 {year}",
      playLink: "\u0916\u0947\u0932\u0947\u0902: {url}"
    },
    id: {
      language: "Bahasa",
      account: "Akun",
      localGame: "Permainan lokal",
      languageHint: "Bahasa permainan \xB7 disimpan di peramban ini",
      languageVisit: "Bahasa permainan \xB7 berlaku untuk kunjungan ini; penyimpanan tidak tersedia",
      skip: "Lewati ke konten",
      game: "Main Go Click",
      savedClicks: "Klik tersimpan",
      localClicks: "Klik lokal",
      click: "Klik!",
      clickAction: "Klik untuk menambah skor",
      lastClick: "Klik terakhir: {time}",
      noClicks: "Belum ada klik tersimpan.",
      timezone: "Ditampilkan dalam zona waktu lokal Anda",
      refresh: "Muat ulang penghitung",
      share: "Bagikan",
      shareHint: "Salin statistik untuk dibagikan",
      ping: "Ping",
      simPing: "Ping simulasi",
      pingHint: "Waktu pulang pergi permintaan klik terakhir yang berhasil. Bingkai menunjukkan permintaan tertunda atau kesalahan penyimpanan.",
      pingStatus: "{ping}. {status}.",
      noPing: "Ping: belum ada klik yang diukur",
      coolingStatus: "Jeda server. Klik dijeda",
      offlineStatus: "Luring. Klik dijeda",
      loadingStatus: "Permintaan sedang diproses",
      failedStatus: "Permintaan terakhir gagal",
      idleStatus: "Tidak ada permintaan tertunda",
      pending: "+{count} tertunda",
      cooldown: "Sedang jeda",
      seconds: "{count} dtk",
      streaks: "Rentetan",
      streakLabel: "Rentetan klik",
      days: "hari",
      months: "bulan",
      years: "tahun",
      networkNotice: "Anda sedang luring. Klik dijeda. Progres tersimpan akan diperbarui saat tersambung kembali.",
      localMode: "Luring \xB7 simpanan lokal",
      offline: "Luring",
      backOnline: "Kembali daring",
      signOut: "Keluar",
      admin: "Admin",
      options: "Opsi",
      motion: "Aktifkan efek gerakan",
      motionHint: "Gerakan terbatas aktif. Aktifkan efek gerakan.",
      reload: "Muat ulang penghitung",
      controls: "Tekan dengan tetikus atau sentuhan, lalu lepaskan di dalam tombol. Setiap jari dihitung terpisah. Saat tombol terfokus, melepas Spasi atau Enter menambah satu klik. Menahan tidak menambah klik.",
      loadError: "Penghitung tidak dapat dimuat. Coba muat ulang.",
      unconfirmedClick: "Klik tidak dapat dikonfirmasi. Muat ulang penghitung untuk memeriksa apakah tersimpan.",
      unsavedClick: "Klik Anda tidak tersimpan. Periksa koneksi dan coba lagi.",
      localLoadError: "Simpanan lokal tidak dapat dimuat. Buka Opsi untuk mengimpor salinan atau memulai ulang.",
      localClickError: "Klik lokal tidak tersimpan. Penyimpanan peramban mungkin penuh atau tidak tersedia.",
      signOutError: "Tidak dapat keluar. Silakan coba lagi.",
      shareTitle: "Bagikan statistik",
      done: "Selesai",
      shareInstructions: "Pilih yang ingin disertakan. Mengubah opsi memperbarui pratinjau; salin lagi untuk membagikan teks yang disesuaikan.",
      include: "Sertakan",
      siteLink: "Tautan situs",
      clickTotal: "Total klik",
      shareDataNote: "Total klik bersifat kumulatif. Total harian dan mingguan tidak termasuk dalam ringkasan saat ini.",
      preview: "Pratinjau",
      statsToShare: "Statistik untuk dibagikan",
      copyText: "Salin teks",
      copied: "Statistik disalin.",
      clipboardUnavailable: "Papan klip tidak tersedia. Pilih dan salin teks pratinjau.",
      statsClicks: "{label}: {count}",
      statsStreaks: "Rentetan UTC: {day} \xB7 {month} \xB7 {year}",
      playLink: "Main: {url}"
    },
    "pt-BR": {
      language: "Idioma",
      account: "Conta",
      localGame: "Jogo local",
      languageHint: "Idioma do jogo \xB7 salvo neste navegador",
      languageVisit: "Idioma do jogo \xB7 aplicado nesta visita; armazenamento indispon\xEDvel",
      skip: "Pular para o conte\xFAdo",
      game: "Jogar Go Click",
      savedClicks: "Cliques salvos",
      localClicks: "Cliques locais",
      click: "Clique!",
      clickAction: "Clique para aumentar a pontua\xE7\xE3o",
      lastClick: "\xDAltimo clique: {time}",
      noClicks: "Nenhum clique salvo ainda.",
      timezone: "Exibido no seu fuso hor\xE1rio local",
      refresh: "Atualizar contador",
      share: "Compartilhar",
      shareHint: "Copiar estat\xEDsticas para compartilhar",
      ping: "Ping",
      simPing: "Ping simulado",
      pingHint: "Tempo de ida e volta da \xFAltima solicita\xE7\xE3o de clique bem-sucedida. A borda indica solicita\xE7\xF5es pendentes ou erro ao salvar.",
      pingStatus: "{ping}. {status}.",
      noPing: "Ping: nenhum clique medido ainda",
      coolingStatus: "Pausa do servidor. Cliques pausados",
      offlineStatus: "Sem conex\xE3o. Cliques pausados",
      loadingStatus: "Solicita\xE7\xE3o em andamento",
      failedStatus: "A \xFAltima solicita\xE7\xE3o falhou",
      idleStatus: "Nenhuma solicita\xE7\xE3o pendente",
      pending: "+{count} pendentes",
      cooldown: "Em pausa",
      seconds: "{count} s",
      streaks: "Sequ\xEAncias",
      streakLabel: "Sequ\xEAncias de cliques",
      days: "dias",
      months: "meses",
      years: "anos",
      networkNotice: "Voc\xEA est\xE1 sem conex\xE3o. Os cliques est\xE3o pausados. Seu progresso salvo ser\xE1 atualizado ao reconectar.",
      localMode: "Offline \xB7 save local",
      offline: "Offline",
      backOnline: "Voltar ao modo online",
      signOut: "Sair",
      admin: "Administra\xE7\xE3o",
      options: "Op\xE7\xF5es",
      motion: "Ativar efeitos de movimento",
      motionHint: "Movimento reduzido ativado. Ativar efeitos de movimento.",
      reload: "Recarregar contador",
      controls: "Pressione com o mouse ou toque e solte dentro do bot\xE3o. Cada dedo conta separadamente. Com o bot\xE3o em foco, soltar Espa\xE7o ou Enter adiciona um clique. Segurar n\xE3o adiciona cliques.",
      loadError: "N\xE3o foi poss\xEDvel carregar o contador. Tente recarregar.",
      unconfirmedClick: "N\xE3o foi poss\xEDvel confirmar seu clique. Recarregue o contador para verificar se foi salvo.",
      unsavedClick: "Seu clique n\xE3o foi salvo. Verifique sua conex\xE3o e tente novamente.",
      localLoadError: "N\xE3o foi poss\xEDvel carregar o save local. Abra Op\xE7\xF5es para importar uma c\xF3pia ou reiniciar.",
      localClickError: "Seu clique local n\xE3o foi salvo. O armazenamento do navegador pode estar cheio ou indispon\xEDvel.",
      signOutError: "N\xE3o foi poss\xEDvel sair. Tente novamente.",
      shareTitle: "Compartilhar estat\xEDsticas",
      done: "Conclu\xEDdo",
      shareInstructions: "Escolha o que incluir. Alterar uma op\xE7\xE3o atualiza a pr\xE9via; copie novamente para compartilhar o texto personalizado.",
      include: "Incluir",
      siteLink: "Link do site",
      clickTotal: "Total de cliques",
      shareDataNote: "O total de cliques \xE9 acumulativo. Totais di\xE1rios e semanais n\xE3o fazem parte do resumo atual.",
      preview: "Pr\xE9via",
      statsToShare: "Estat\xEDsticas para compartilhar",
      copyText: "Copiar texto",
      copied: "Estat\xEDsticas copiadas.",
      clipboardUnavailable: "\xC1rea de transfer\xEAncia indispon\xEDvel. Selecione e copie o texto da pr\xE9via.",
      statsClicks: "{label}: {count}",
      statsStreaks: "Sequ\xEAncias UTC: {day} \xB7 {month} \xB7 {year}",
      playLink: "Jogar: {url}"
    },
    fr: {
      language: "Langue",
      account: "Compte",
      localGame: "Partie locale",
      languageHint: "Langue du jeu \xB7 m\xE9moris\xE9e dans ce navigateur",
      languageVisit: "Langue du jeu \xB7 appliqu\xE9e pour cette visite ; stockage indisponible",
      skip: "Aller au contenu",
      game: "Jouer \xE0 Go Click",
      savedClicks: "Clics enregistr\xE9s",
      localClicks: "Clics locaux",
      click: "Cliquez !",
      clickAction: "Cliquer pour ajouter un point",
      lastClick: "Dernier clic : {time}",
      noClicks: "Aucun clic enregistr\xE9 pour le moment.",
      timezone: "Affich\xE9 dans votre fuseau horaire local",
      refresh: "Actualiser le compteur",
      share: "Partager",
      shareHint: "Copier les statistiques \xE0 partager",
      ping: "Latence",
      simPing: "Latence simul\xE9e",
      pingHint: "Dur\xE9e aller-retour de la derni\xE8re requ\xEAte de clic r\xE9ussie. La bordure indique les requ\xEAtes en attente ou une erreur de sauvegarde.",
      pingStatus: "{ping}. {status}.",
      noPing: "Latence : aucun clic mesur\xE9",
      coolingStatus: "Pause du serveur. Clics suspendus",
      offlineStatus: "Hors ligne. Clics suspendus",
      loadingStatus: "Requ\xEAte en cours",
      failedStatus: "La derni\xE8re requ\xEAte a \xE9chou\xE9",
      idleStatus: "Aucune requ\xEAte en attente",
      pending: "+{count} en attente",
      cooldown: "En pause",
      seconds: "{count} s",
      streaks: "S\xE9ries",
      streakLabel: "S\xE9ries de clics",
      days: "jours",
      months: "mois",
      years: "ans",
      networkNotice: "Vous \xEAtes hors ligne. Les clics sont suspendus. Votre progression sera actualis\xE9e \xE0 la reconnexion.",
      localMode: "Hors ligne \xB7 sauvegarde locale",
      offline: "Hors ligne",
      backOnline: "Revenir en ligne",
      signOut: "Se d\xE9connecter",
      admin: "Administration",
      options: "Options",
      motion: "Activer les effets de mouvement",
      motionHint: "Les animations sont r\xE9duites. Activer les effets de mouvement.",
      reload: "Recharger le compteur",
      controls: "Appuyez avec la souris ou le doigt, puis rel\xE2chez dans le bouton. Chaque doigt compte s\xE9par\xE9ment. Quand le bouton a le focus, rel\xE2cher Espace ou Entr\xE9e ajoute un clic. Maintenir n\u2019ajoute pas de clics.",
      loadError: "Impossible de charger le compteur. R\xE9essayez.",
      unconfirmedClick: "Impossible de confirmer le clic. Rechargez le compteur pour v\xE9rifier son enregistrement.",
      unsavedClick: "Votre clic n\u2019a pas \xE9t\xE9 enregistr\xE9. V\xE9rifiez votre connexion et r\xE9essayez.",
      localLoadError: "Impossible de charger la sauvegarde locale. Ouvrez Options pour importer une copie ou recommencer.",
      localClickError: "Votre clic local n\u2019a pas \xE9t\xE9 enregistr\xE9. Le stockage du navigateur est peut-\xEAtre plein ou indisponible.",
      signOutError: "Impossible de se d\xE9connecter. R\xE9essayez.",
      shareTitle: "Partager les statistiques",
      done: "Termin\xE9",
      shareInstructions: "Choisissez les \xE9l\xE9ments \xE0 inclure. Modifier une option actualise l\u2019aper\xE7u ; copiez \xE0 nouveau pour partager le texte personnalis\xE9.",
      include: "Inclure",
      siteLink: "Lien du site",
      clickTotal: "Total des clics",
      shareDataNote: "Le total des clics est cumulatif. Le r\xE9sum\xE9 actuel n\u2019inclut pas de totaux quotidiens ou hebdomadaires.",
      preview: "Aper\xE7u",
      statsToShare: "Statistiques \xE0 partager",
      copyText: "Copier le texte",
      copied: "Statistiques copi\xE9es.",
      clipboardUnavailable: "Presse-papiers indisponible. S\xE9lectionnez et copiez le texte de l\u2019aper\xE7u.",
      statsClicks: "{label} : {count}",
      statsStreaks: "S\xE9ries UTC : {day} \xB7 {month} \xB7 {year}",
      playLink: "Jouer : {url}"
    },
    ja: {
      language: "\u8A00\u8A9E",
      account: "\u30A2\u30AB\u30A6\u30F3\u30C8",
      localGame: "\u30ED\u30FC\u30AB\u30EB\u30B2\u30FC\u30E0",
      languageHint: "\u30B2\u30FC\u30E0\u306E\u8A00\u8A9E \xB7 \u3053\u306E\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58",
      languageVisit: "\u30B2\u30FC\u30E0\u306E\u8A00\u8A9E \xB7 \u4ECA\u56DE\u306E\u307F\u9069\u7528\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093",
      skip: "\u672C\u6587\u3078\u79FB\u52D5",
      game: "Go Click \u3092\u30D7\u30EC\u30A4",
      savedClicks: "\u4FDD\u5B58\u6E08\u307F\u30AF\u30EA\u30C3\u30AF",
      localClicks: "\u30ED\u30FC\u30AB\u30EB\u30AF\u30EA\u30C3\u30AF",
      click: "\u30AF\u30EA\u30C3\u30AF\uFF01",
      clickAction: "\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u30B9\u30B3\u30A2\u3092\u5897\u3084\u3059",
      lastClick: "\u6700\u5F8C\u306E\u30AF\u30EA\u30C3\u30AF\uFF1A{time}",
      noClicks: "\u4FDD\u5B58\u6E08\u307F\u30AF\u30EA\u30C3\u30AF\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002",
      timezone: "\u304A\u4F4F\u307E\u3044\u306E\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3\u3067\u8868\u793A",
      refresh: "\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u66F4\u65B0",
      share: "\u5171\u6709",
      shareHint: "\u5171\u6709\u7528\u306B\u8A18\u9332\u3092\u30B3\u30D4\u30FC",
      ping: "\u5FDC\u7B54\u6642\u9593",
      simPing: "\u6A21\u64EC\u5FDC\u7B54\u6642\u9593",
      pingHint: "\u6700\u5F8C\u306B\u6210\u529F\u3057\u305F\u30AF\u30EA\u30C3\u30AF\u8981\u6C42\u306E\u5F80\u5FA9\u6642\u9593\u3002\u67A0\u306F\u51E6\u7406\u4E2D\u306E\u8981\u6C42\u3084\u4FDD\u5B58\u30A8\u30E9\u30FC\u3092\u793A\u3057\u307E\u3059\u3002",
      pingStatus: "{ping}\u3002{status}\u3002",
      noPing: "\u5FDC\u7B54\u6642\u9593\uFF1A\u307E\u3060\u8A08\u6E2C\u3057\u3066\u3044\u307E\u305B\u3093",
      coolingStatus: "\u30B5\u30FC\u30D0\u30FC\u306E\u5F85\u6A5F\u6642\u9593\u4E2D\u3002\u30AF\u30EA\u30C3\u30AF\u3092\u4E00\u6642\u505C\u6B62",
      offlineStatus: "\u672A\u63A5\u7D9A\u3002\u30AF\u30EA\u30C3\u30AF\u3092\u4E00\u6642\u505C\u6B62",
      loadingStatus: "\u30EA\u30AF\u30A8\u30B9\u30C8\u51E6\u7406\u4E2D",
      failedStatus: "\u6700\u5F8C\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u306B\u5931\u6557",
      idleStatus: "\u51E6\u7406\u4E2D\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u306F\u3042\u308A\u307E\u305B\u3093",
      pending: "+{count} \u4FDD\u5B58\u5F85\u3061",
      cooldown: "\u5F85\u6A5F\u4E2D",
      seconds: "{count}\u79D2",
      streaks: "\u9023\u7D9A\u8A18\u9332",
      streakLabel: "\u30AF\u30EA\u30C3\u30AF\u306E\u9023\u7D9A\u8A18\u9332",
      days: "\u65E5",
      months: "\u304B\u6708",
      years: "\u5E74",
      networkNotice: "\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u3059\u3002\u30AF\u30EA\u30C3\u30AF\u306F\u4E00\u6642\u505C\u6B62\u4E2D\u3067\u3059\u3002\u518D\u63A5\u7D9A\u3059\u308B\u3068\u4FDD\u5B58\u6E08\u307F\u306E\u9032\u884C\u72B6\u6CC1\u3092\u66F4\u65B0\u3057\u307E\u3059\u3002",
      localMode: "\u30AA\u30D5\u30E9\u30A4\u30F3 \xB7 \u30ED\u30FC\u30AB\u30EB\u4FDD\u5B58",
      offline: "\u30AA\u30D5\u30E9\u30A4\u30F3",
      backOnline: "\u30AA\u30F3\u30E9\u30A4\u30F3\u306B\u623B\u308B",
      signOut: "\u30ED\u30B0\u30A2\u30A6\u30C8",
      admin: "\u7BA1\u7406",
      options: "\u8A2D\u5B9A",
      motion: "\u52D5\u304D\u306E\u52B9\u679C\u3092\u6709\u52B9\u306B\u3059\u308B",
      motionHint: "\u52D5\u304D\u3092\u6291\u3048\u308B\u8A2D\u5B9A\u3067\u3059\u3002\u52D5\u304D\u306E\u52B9\u679C\u3092\u6709\u52B9\u306B\u3057\u307E\u3059\u3002",
      reload: "\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u518D\u8AAD\u307F\u8FBC\u307F",
      controls: "\u30DE\u30A6\u30B9\u3084\u30BF\u30C3\u30C1\u3067\u62BC\u3057\u3001\u30DC\u30BF\u30F3\u306E\u5185\u5074\u3067\u96E2\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u6307\u3054\u3068\u306B\u6570\u3048\u307E\u3059\u3002\u30DC\u30BF\u30F3\u306B\u30D5\u30A9\u30FC\u30AB\u30B9\u304C\u3042\u308B\u3068\u304D\u306F\u3001\u30B9\u30DA\u30FC\u30B9\u307E\u305F\u306F Enter \u3092\u96E2\u3059\u30681\u30AF\u30EA\u30C3\u30AF\u52A0\u7B97\u3057\u307E\u3059\u3002\u9577\u62BC\u3057\u3067\u306F\u5897\u3048\u307E\u305B\u3093\u3002",
      loadError: "\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      unconfirmedClick: "\u30AF\u30EA\u30C3\u30AF\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u4FDD\u5B58\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      unsavedClick: "\u30AF\u30EA\u30C3\u30AF\u306F\u4FDD\u5B58\u3055\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      localLoadError: "\u30ED\u30FC\u30AB\u30EB\u4FDD\u5B58\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u8A2D\u5B9A\u3067\u30B3\u30D4\u30FC\u3092\u30A4\u30F3\u30DD\u30FC\u30C8\u3059\u308B\u304B\u3001\u4FDD\u5B58\u3092\u30EA\u30BB\u30C3\u30C8\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      localClickError: "\u30ED\u30FC\u30AB\u30EB\u30AF\u30EA\u30C3\u30AF\u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u306E\u4FDD\u5B58\u9818\u57DF\u304C\u3044\u3063\u3071\u3044\u304B\u3001\u5229\u7528\u3067\u304D\u306A\u3044\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002",
      signOutError: "\u30ED\u30B0\u30A2\u30A6\u30C8\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      shareTitle: "\u8A18\u9332\u3092\u5171\u6709",
      done: "\u5B8C\u4E86",
      shareInstructions: "\u542B\u3081\u308B\u5185\u5BB9\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044\u3002\u8A2D\u5B9A\u3092\u5909\u3048\u308B\u3068\u30D7\u30EC\u30D3\u30E5\u30FC\u304C\u66F4\u65B0\u3055\u308C\u307E\u3059\u3002\u5171\u6709\u3059\u308B\u524D\u306B\u518D\u5EA6\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      include: "\u542B\u3081\u308B\u5185\u5BB9",
      siteLink: "\u30B5\u30A4\u30C8\u306E\u30EA\u30F3\u30AF",
      clickTotal: "\u5408\u8A08\u30AF\u30EA\u30C3\u30AF\u6570",
      shareDataNote: "\u30AF\u30EA\u30C3\u30AF\u6570\u306F\u7D2F\u8A08\u3067\u3059\u3002\u73FE\u5728\u306E\u6982\u8981\u306B\u306F\u65E5\u5225\u30FB\u9031\u5225\u306E\u5408\u8A08\u306F\u542B\u307E\u308C\u307E\u305B\u3093\u3002",
      preview: "\u30D7\u30EC\u30D3\u30E5\u30FC",
      statsToShare: "\u5171\u6709\u3059\u308B\u8A18\u9332",
      copyText: "\u30C6\u30AD\u30B9\u30C8\u3092\u30B3\u30D4\u30FC",
      copied: "\u8A18\u9332\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002",
      clipboardUnavailable: "\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u30D7\u30EC\u30D3\u30E5\u30FC\u306E\u30C6\u30AD\u30B9\u30C8\u3092\u9078\u629E\u3057\u3066\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      statsClicks: "{label}\uFF1A{count}",
      statsStreaks: "UTC \u9023\u7D9A\u8A18\u9332\uFF1A{day} \xB7 {month} \xB7 {year}",
      playLink: "\u30D7\u30EC\u30A4\uFF1A{url}"
    },
    ru: {
      language: "\u042F\u0437\u044B\u043A",
      account: "\u0410\u043A\u043A\u0430\u0443\u043D\u0442",
      localGame: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u0430\u044F \u0438\u0433\u0440\u0430",
      languageHint: "\u042F\u0437\u044B\u043A \u0438\u0433\u0440\u044B \xB7 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435",
      languageVisit: "\u042F\u0437\u044B\u043A \u0438\u0433\u0440\u044B \xB7 \u043F\u0440\u0438\u043C\u0435\u043D\u0451\u043D \u043D\u0430 \u044D\u0442\u043E\u0442 \u0440\u0430\u0437; \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E",
      skip: "\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u043C\u0443",
      game: "\u0418\u0433\u0440\u0430\u0442\u044C \u0432 Go Click",
      savedClicks: "\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u043A\u043B\u0438\u043A\u0438",
      localClicks: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u043A\u043B\u0438\u043A\u0438",
      click: "\u0416\u043C\u0438!",
      clickAction: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043E\u0447\u043A\u043E",
      lastClick: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043A\u043B\u0438\u043A: {time}",
      noClicks: "\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0445 \u043A\u043B\u0438\u043A\u043E\u0432 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.",
      timezone: "\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u0432 \u0432\u0430\u0448\u0435\u043C \u0447\u0430\u0441\u043E\u0432\u043E\u043C \u043F\u043E\u044F\u0441\u0435",
      refresh: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0447\u0451\u0442\u0447\u0438\u043A",
      share: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F",
      shareHint: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443 \u0434\u043B\u044F \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438",
      ping: "\u041F\u0438\u043D\u0433",
      simPing: "\u0421\u0438\u043C\u0443\u043B\u044F\u0446\u0438\u044F \u043F\u0438\u043D\u0433\u0430",
      pingHint: "\u0412\u0440\u0435\u043C\u044F \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0433\u043E \u0443\u0441\u043F\u0435\u0448\u043D\u043E\u0433\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u043A\u043B\u0438\u043A\u0430. \u0420\u0430\u043C\u043A\u0430 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u044B \u0438\u043B\u0438 \u043E\u0448\u0438\u0431\u043A\u0443 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F.",
      pingStatus: "{ping}. {status}.",
      noPing: "\u041F\u0438\u043D\u0433: \u043A\u043B\u0438\u043A\u043E\u0432 \u0435\u0449\u0451 \u043D\u0435 \u0438\u0437\u043C\u0435\u0440\u0435\u043D\u043E",
      coolingStatus: "\u0421\u0435\u0440\u0432\u0435\u0440\u043D\u0430\u044F \u043F\u0430\u0443\u0437\u0430. \u041A\u043B\u0438\u043A\u0438 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B",
      offlineStatus: "\u041D\u0435\u0442 \u0441\u0435\u0442\u0438. \u041A\u043B\u0438\u043A\u0438 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B",
      loadingStatus: "\u0417\u0430\u043F\u0440\u043E\u0441 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",
      failedStatus: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D",
      idleStatus: "\u041D\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0445 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432",
      pending: "+{count} \u043E\u0436\u0438\u0434\u0430\u044E\u0442",
      cooldown: "\u041F\u0430\u0443\u0437\u0430",
      seconds: "{count} \u0441",
      streaks: "\u0421\u0435\u0440\u0438\u0438",
      streakLabel: "\u0421\u0435\u0440\u0438\u0438 \u043A\u043B\u0438\u043A\u043E\u0432",
      days: "\u0434\u043D\u0438",
      months: "\u043C\u0435\u0441\u044F\u0446\u044B",
      years: "\u0433\u043E\u0434\u044B",
      networkNotice: "\u041D\u0435\u0442 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F. \u041A\u043B\u0438\u043A\u0438 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B. \u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F.",
      localMode: "\u041E\u0444\u043B\u0430\u0439\u043D \xB7 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435",
      offline: "\u041E\u0444\u043B\u0430\u0439\u043D",
      backOnline: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u043E\u043D\u043B\u0430\u0439\u043D",
      signOut: "\u0412\u044B\u0439\u0442\u0438",
      admin: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435",
      options: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
      motion: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u044D\u0444\u0444\u0435\u043A\u0442\u044B \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F",
      motionHint: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0435 \u0443\u043C\u0435\u043D\u044C\u0448\u0435\u043D\u043E. \u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u044D\u0444\u0444\u0435\u043A\u0442\u044B \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F.",
      reload: "\u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0447\u0451\u0442\u0447\u0438\u043A",
      controls: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043C\u044B\u0448\u044C\u044E \u0438\u043B\u0438 \u043F\u0430\u043B\u044C\u0446\u0435\u043C \u0438 \u043E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u0432\u043D\u0443\u0442\u0440\u0438 \u043A\u043D\u043E\u043F\u043A\u0438. \u041A\u0430\u0436\u0434\u044B\u0439 \u043F\u0430\u043B\u0435\u0446 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E. \u041F\u0440\u0438 \u0444\u043E\u043A\u0443\u0441\u0435 \u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0435 \u043E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u041F\u0440\u043E\u0431\u0435\u043B \u0438\u043B\u0438 Enter \u0434\u043B\u044F \u043E\u0434\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u043A\u0430. \u0423\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435 \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u043A\u043B\u0438\u043A\u043E\u0432.",
      loadError: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0447\u0451\u0442\u0447\u0438\u043A. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.",
      unconfirmedClick: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u043A\u043B\u0438\u043A. \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0441\u0447\u0451\u0442\u0447\u0438\u043A, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435.",
      unsavedClick: "\u041A\u043B\u0438\u043A \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0443.",
      localLoadError: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438, \u0447\u0442\u043E\u0431\u044B \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u043F\u0438\u044E \u0438\u043B\u0438 \u043D\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E.",
      localClickError: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u043B\u0438\u043A \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D. \u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043E \u0438\u043B\u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.",
      signOutError: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u0439\u0442\u0438. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.",
      shareTitle: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u043E\u0439",
      done: "\u0413\u043E\u0442\u043E\u0432\u043E",
      shareInstructions: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435, \u0447\u0442\u043E \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442 \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440; \u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u0437\u0430\u043D\u043E\u0432\u043E \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439.",
      include: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C",
      siteLink: "\u0421\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u0441\u0430\u0439\u0442",
      clickTotal: "\u0412\u0441\u0435\u0433\u043E \u043A\u043B\u0438\u043A\u043E\u0432",
      shareDataNote: "\u0427\u0438\u0441\u043B\u043E \u043A\u043B\u0438\u043A\u043E\u0432 \u043D\u0430\u043A\u043E\u043F\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435. \u0418\u0442\u043E\u0433\u0438 \u0437\u0430 \u0434\u0435\u043D\u044C \u0438 \u043D\u0435\u0434\u0435\u043B\u044E \u043D\u0435 \u0432\u0445\u043E\u0434\u044F\u0442 \u0432 \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0441\u0432\u043E\u0434\u043A\u0443.",
      preview: "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440",
      statsToShare: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0434\u043B\u044F \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438",
      copyText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u0435\u043A\u0441\u0442",
      copied: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430.",
      clipboardUnavailable: "\u0411\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u0412\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u0438 \u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430.",
      statsClicks: "{label}: {count}",
      statsStreaks: "\u0421\u0435\u0440\u0438\u0438 UTC: {day} \xB7 {month} \xB7 {year}",
      playLink: "\u0418\u0433\u0440\u0430\u0442\u044C: {url}"
    },
    de: {
      language: "Sprache",
      account: "Konto",
      localGame: "Lokales Spiel",
      languageHint: "Spielsprache \xB7 wird in diesem Browser gespeichert",
      languageVisit: "Spielsprache \xB7 f\xFCr diesen Besuch \xFCbernommen; Browserspeicher nicht verf\xFCgbar",
      skip: "Zum Inhalt springen",
      game: "Go Click spielen",
      savedClicks: "Gespeicherte Klicks",
      localClicks: "Lokale Klicks",
      click: "Klick!",
      clickAction: "Klicken, um den Punktestand zu erh\xF6hen",
      lastClick: "Letzter Klick: {time}",
      noClicks: "Noch keine Klicks gespeichert.",
      timezone: "Anzeige in deiner lokalen Zeitzone",
      refresh: "Z\xE4hler aktualisieren",
      share: "Teilen",
      shareHint: "Statistik zum Teilen kopieren",
      ping: "Ping",
      simPing: "Simulierter Ping",
      pingHint: "Umlaufzeit der letzten erfolgreichen Klickanfrage. Der Rand zeigt ausstehende Anfragen oder einen Speicherfehler an.",
      pingStatus: "{ping}. {status}.",
      noPing: "Ping: noch kein Klick gemessen",
      coolingStatus: "Serverpause. Klicken pausiert",
      offlineStatus: "Offline. Klicken pausiert",
      loadingStatus: "Anfrage l\xE4uft",
      failedStatus: "Letzte Anfrage fehlgeschlagen",
      idleStatus: "Keine ausstehenden Anfragen",
      pending: "+{count} ausstehend",
      cooldown: "Pause",
      seconds: "{count} s",
      streaks: "Serien",
      streakLabel: "Klickserien",
      days: "Tage",
      months: "Monate",
      years: "Jahre",
      networkNotice: "Du bist offline. Klicken ist pausiert. Dein gespeicherter Fortschritt wird beim Verbinden aktualisiert.",
      localMode: "Offline \xB7 lokaler Spielstand",
      offline: "Offline",
      backOnline: "Zur\xFCck zum Onlinespiel",
      signOut: "Abmelden",
      admin: "Verwaltung",
      options: "Optionen",
      motion: "Bewegungseffekte aktivieren",
      motionHint: "Reduzierte Bewegung ist aktiv. Bewegungseffekte aktivieren.",
      reload: "Z\xE4hler neu laden",
      controls: "Mit Maus oder Finger dr\xFCcken und innerhalb des Buttons loslassen. Jeder Finger z\xE4hlt einzeln. Bei fokussiertem Button z\xE4hlt das Loslassen von Leertaste oder Enter als Klick. Halten erzeugt keine weiteren Klicks.",
      loadError: "Der Z\xE4hler konnte nicht geladen werden. Lade ihn erneut.",
      unconfirmedClick: "Der Klick konnte nicht best\xE4tigt werden. Lade den Z\xE4hler neu, um die Speicherung zu pr\xFCfen.",
      unsavedClick: "Dein Klick wurde nicht gespeichert. Pr\xFCfe deine Verbindung und versuche es erneut.",
      localLoadError: "Der lokale Spielstand konnte nicht geladen werden. \xD6ffne die Optionen, um eine Kopie zu importieren oder neu zu beginnen.",
      localClickError: "Dein lokaler Klick wurde nicht gespeichert. Der Browserspeicher ist m\xF6glicherweise voll oder nicht verf\xFCgbar.",
      signOutError: "Abmelden fehlgeschlagen. Versuche es erneut.",
      shareTitle: "Statistik teilen",
      done: "Fertig",
      shareInstructions: "W\xE4hle aus, was enthalten sein soll. \xC4nderungen aktualisieren die Vorschau. Kopiere den angepassten Text erneut zum Teilen.",
      include: "Einbeziehen",
      siteLink: "Link zur Website",
      clickTotal: "Klickzahl",
      shareDataNote: "Die Klickzahl ist kumulativ. Tages- und Wochensummen sind in der aktuellen \xDCbersicht nicht enthalten.",
      preview: "Vorschau",
      statsToShare: "Statistik zum Teilen",
      copyText: "Text kopieren",
      copied: "Statistik kopiert.",
      clipboardUnavailable: "Zwischenablage nicht verf\xFCgbar. Markiere und kopiere den Vorschautext.",
      statsClicks: "{label}: {count}",
      statsStreaks: "UTC-Serien: {day} \xB7 {month} \xB7 {year}",
      playLink: "Spielen: {url}"
    }
  };

  // frontend/i18n.ts
  var languages = [
    { code: "en", name: "English", dir: "ltr" },
    { code: "zh-Hans", name: "\u7B80\u4F53\u4E2D\u6587", dir: "ltr" },
    { code: "es", name: "Espa\xF1ol", dir: "ltr" },
    { code: "ar", name: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", dir: "rtl" },
    { code: "hi", name: "\u0939\u093F\u0928\u094D\u0926\u0940", dir: "ltr" },
    { code: "id", name: "Bahasa Indonesia", dir: "ltr" },
    { code: "pt-BR", name: "Portugu\xEAs", dir: "ltr" },
    { code: "fr", name: "Fran\xE7ais", dir: "ltr" },
    { code: "ja", name: "\u65E5\u672C\u8A9E", dir: "ltr" },
    { code: "ru", name: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", dir: "ltr" },
    { code: "de", name: "Deutsch", dir: "ltr" }
  ];
  var languageStorageKey = "goclick.language.v1";
  var language = "en";
  var listeners = /* @__PURE__ */ new Set();
  function supportedLanguage(value) {
    return languages.find((item) => item.code === value)?.code;
  }
  function preferredLanguage(saved, preferences) {
    const explicit = supportedLanguage(saved);
    if (explicit) return explicit;
    for (const preference of preferences) {
      const base = preference.toLowerCase().split("-")[0];
      const match = languages.find((item) => item.code.toLowerCase().split("-")[0] === base);
      if (match) return match.code;
    }
    return "en";
  }
  function currentLanguage() {
    return language;
  }
  function languageDirection(code = language) {
    return languages.find((item) => item.code === code)?.dir ?? "ltr";
  }
  function message2(key, parameters = {}, code = language) {
    const messages = code === "en" ? english : translations[code];
    return messages[key].replace(
      /\{(\w+)\}/g,
      (token, name) => Object.hasOwn(parameters, name) ? String(parameters[name]) : token
    );
  }
  function formatNumber(value, code = language) {
    return new Intl.NumberFormat(code).format(value);
  }
  function formatUnit(value, unit, code = language) {
    return new Intl.NumberFormat(code, { style: "unit", unit, unitDisplay: "long" }).format(value);
  }
  function onLanguageChange(listener) {
    listeners.add(listener);
  }
  function setLanguage(code) {
    if (language === code) return;
    language = code;
    for (const listener of listeners) listener();
  }
  function rememberLanguage(code) {
    setLanguage(code);
    try {
      localStorage.setItem(languageStorageKey, code);
      return true;
    } catch {
      return false;
    }
  }
  function readLanguage() {
    let saved = null;
    try {
      saved = localStorage.getItem(languageStorageKey);
    } catch {
    }
    return preferredLanguage(saved, navigator.languages ?? []);
  }
  function translatePage() {
    for (const attribute of ["text", "title", "aria-label"]) {
      const selector = attribute === "text" ? "data-i18n" : `data-i18n-${attribute}`;
      for (const element of document.querySelectorAll(`[${selector}]`)) {
        const key = element.getAttribute(selector);
        if (!key || !Object.hasOwn(english, key)) continue;
        const text = message2(key);
        if (attribute === "text") element.textContent = text;
        else element.setAttribute(attribute, text);
        element.lang = language;
      }
    }
    for (const element of document.querySelectorAll("[data-game-language]")) {
      element.lang = language;
      element.dir = languageDirection();
    }
  }
  function createButtonLanguage(initial) {
    let current = initial;
    let previous = null;
    let heat = 0;
    return {
      reset(code) {
        current = code;
        previous = null;
        heat = 0;
      },
      click(now, selected, random = Math.random) {
        if (previous !== null) {
          const gap = Math.max(0, now - previous);
          heat *= Math.exp(-gap / 900);
          if (gap < 350) heat = Math.min(1, heat + 0.12);
        }
        previous = now;
        if (random() < 0.02 + 0.06 * heat) {
          const choices = languages.filter((item) => item.code !== current && item.code !== selected);
          current = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))].code;
        }
        return current;
      }
    };
  }

  // frontend/share.ts
  function formatShareText(counters, local, options, siteUrl = typeof window === "undefined" ? "" : window.location?.origin ?? "") {
    const lines = [`Go Click${local ? ` \xB7 ${message2("offline")}` : ""}`];
    if (options.clicks)
      lines.push(
        message2("statsClicks", {
          label: message2(local ? "localClicks" : "savedClicks"),
          count: formatNumber(counters.click_count?.count ?? 0)
        })
      );
    if (options.streaks) {
      lines.push(
        message2("statsStreaks", {
          day: formatUnit(counters.streak_counter_day?.count ?? 0, "day"),
          month: formatUnit(counters.streak_counter_month?.count ?? 0, "month"),
          year: formatUnit(counters.streak_counter_year?.count ?? 0, "year")
        })
      );
    }
    if (options.siteLink && siteUrl) lines.push(message2("playLink", { url: siteUrl }));
    return lines.join("\n");
  }
  var statsShare = (() => {
    const button = required("#share-stats");
    const status = required("#share-status");
    const dialog = required("#share-dialog");
    const text = required("#share-text");
    const copyButton = required("#copy-share-text");
    const options = {
      siteLink: required("#include-share-link"),
      clicks: required("#include-share-clicks"),
      streaks: required("#include-share-streaks")
    };
    let generation = 0, feedbackTimer = 0, clearTimer = 0, busy = false, currentStats = null;
    let announcement = null;
    function announce(key) {
      announcement = key;
      const message3 = key ? message2(key) : "";
      window.clearTimeout(feedbackTimer);
      window.clearTimeout(clearTimer);
      status.textContent = message3;
      status.setAttribute("data-visible", String(!!message3));
      if (!message3) return;
      feedbackTimer = window.setTimeout(() => {
        status.setAttribute("data-visible", "false");
        clearTimer = window.setTimeout(() => {
          status.textContent = "";
          announcement = null;
        }, 400);
      }, 2200);
    }
    function selectedOptions() {
      return {
        siteLink: options.siteLink.checked,
        clicks: options.clicks.checked,
        streaks: options.streaks.checked
      };
    }
    function updatePreview() {
      text.lang = currentLanguage();
      if (currentStats)
        text.value = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
    }
    async function copyCurrent(openDialog) {
      if (busy || !currentStats) return;
      busy = true;
      const current = generation;
      const summary = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
      text.value = summary;
      text.lang = currentLanguage();
      button.setAttribute("aria-busy", "true");
      copyButton.setAttribute("aria-busy", "true");
      announce(null);
      let clipboardWrite;
      try {
        clipboardWrite = navigator.clipboard.writeText(summary);
      } catch {
        clipboardWrite = Promise.reject(new Error("Clipboard unavailable"));
      }
      if (openDialog && !dialog.open) dialog.showModal();
      try {
        await clipboardWrite;
        if (current === generation) announce("copied");
      } catch {
        if (current !== generation) return;
        announce("clipboardUnavailable");
        text.focus();
        text.select();
      } finally {
        if (current === generation) {
          busy = false;
          button.setAttribute("aria-busy", "false");
          copyButton.setAttribute("aria-busy", "false");
        }
      }
    }
    onLanguageChange(() => {
      updatePreview();
      if (announcement) status.textContent = message2(announcement);
    });
    required("#close-share").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) dialog.close();
    });
    copyButton.addEventListener("click", () => void copyCurrent(false));
    for (const option of Object.values(options)) option.addEventListener("change", updatePreview);
    return {
      reset() {
        generation++;
        busy = false;
        currentStats = null;
        window.clearTimeout(feedbackTimer);
        window.clearTimeout(clearTimer);
        button.setAttribute("aria-busy", "false");
        copyButton.setAttribute("aria-busy", "false");
        announce(null);
        text.value = "";
        if (dialog.open) dialog.close();
      },
      copy(counters, local) {
        currentStats = { counters, local };
        return copyCurrent(true);
      }
    };
  })();

  // frontend/timestamp.ts
  function parseStoredTimestamp(value) {
    const parts = value.match(
      /^(?<day>\d{4}-\d{2}-\d{2})(?<separator>T| +)(?<hour>\d{1,2}):(?<minute>\d{2}):(?<second>\d{2})(?:[.,](?<fraction>\d+))?(?<zone>Z|[+-]\d{2}:\d{2})?$/
    )?.groups;
    if (!parts || parts.separator === "T" !== Boolean(parts.zone)) return /* @__PURE__ */ new Date(NaN);
    const normalized = `${parts.day}T${parts.hour?.padStart(2, "0")}:${parts.minute}:${parts.second}.${(parts.fraction ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    const instant = new Date(normalized);
    if (Number.isNaN(instant.getTime()) || instant.toISOString() !== normalized) return /* @__PURE__ */ new Date(NaN);
    let offset = 0;
    if (parts.zone && parts.zone !== "Z") {
      const hours = Number(parts.zone.slice(1, 3));
      const minutes = Number(parts.zone.slice(4, 6));
      if (hours > 24 || minutes > 60) return /* @__PURE__ */ new Date(NaN);
      offset = (hours * 60 + minutes) * 6e4 * (parts.zone[0] === "+" ? 1 : -1);
    }
    return new Date(instant.getTime() - offset);
  }

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
  var buttonLanguage = createButtonLanguage(currentLanguage());
  var buttonLabel = required(".button-label", clickButton);
  var counterCard = required("#counter-card");
  var retryGameButton = required("#retry-game-button");
  var retryBootButton = required("#retry-boot-button");
  var refreshCounterButton = required("#refresh-counter");
  var motionShortcut = required("#motion-shortcut");
  var connection = required("#connection");
  var pendingIndicator = required("#pending-clicks");
  var currentView = "";
  var lastGameError = null;
  var connectionState = "";
  var lastPing = null;
  var viewAnimation = null;
  var pingStateTimer = 0;
  var pendingIndicatorTimer = 0;
  var numberAnimations = /* @__PURE__ */ new WeakMap();
  function updateMotionShortcut() {
    motionShortcut.hidden = !motionPreference.matches;
  }
  updateMotionShortcut();
  motionPreference.addEventListener("change", () => {
    updateMotionShortcut();
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
  var authenticating = false;
  var clickGeneration = 0;
  var identityEpoch = 0;
  var counterLoad = null;
  var counterLoadOwner = null;
  var refreshQueued = false;
  var offline = navigator.onLine === false;
  var maxPendingClicks = 6;
  var cooldownUntil = 0;
  var cooldownTimer = 0;
  var coolingDown = () => !localMode && performance.now() < cooldownUntil;
  function paintCooldown() {
    window.clearTimeout(cooldownTimer);
    const remaining = cooldownUntil - performance.now();
    const active = !localMode && remaining > 0;
    required("#play-status").hidden = !active;
    required("#cooldown-time").textContent = active ? `\xB7 ${message2("seconds", { count: formatNumber(Math.ceil(remaining / 1e3)) })}` : "";
    if (active) cooldownTimer = window.setTimeout(paintCooldown, Math.min(1e3, remaining));
    else cooldownUntil = 0;
    updateGameControls();
    setConnection(null, pendingClicks ? "loading" : "");
  }
  function startCooldown(retryAfter) {
    cooldownUntil = Math.max(cooldownUntil, performance.now() + retryAfterMilliseconds(retryAfter));
    paintCooldown();
  }
  function show(view) {
    const changed = view !== currentView;
    if (changed) {
      for (const controller of tactileButtons.values()) controller.reset();
      viewAnimation?.cancel();
    }
    currentView = view;
    document.documentElement.lang = view === "game" ? currentLanguage() : "en";
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
  function showError(id, message3, focus = false) {
    if (id === "#game-error") lastGameError = null;
    const element = required(id);
    element.textContent = message3;
    element.hidden = !message3;
    if (message3 && focus) element.focus();
  }
  function showGameError(key, focus = false) {
    showError("#game-error", message2(key), focus);
    lastGameError = key;
  }
  function paintButtonLanguage(code) {
    buttonLabel.textContent = message2("click", {}, code);
    buttonLabel.lang = code;
    buttonLabel.dir = languageDirection(code);
  }
  function setConnection(milliseconds = null, state = "") {
    connectionState = state;
    window.clearTimeout(pingStateTimer);
    if (Number.isFinite(milliseconds) && milliseconds !== null) lastPing = Math.round(milliseconds);
    required("#ping").textContent = lastPing === null ? "\u2014 ms" : `${formatNumber(lastPing)} ms`;
    const paintState = () => {
      const cooling = coolingDown();
      connection.classList.toggle("is-limited", cooling);
      connection.classList.toggle(
        "is-loading",
        !cooling && state === "loading" && (!offline || localMode)
      );
      connection.classList.toggle(
        "is-error",
        !cooling && (state === "error" || offline && !localMode)
      );
      const status = cooling ? message2("coolingStatus") : offline && !localMode ? message2("offlineStatus") : state === "loading" ? message2("loadingStatus") : state === "error" ? message2("failedStatus") : message2("idleStatus");
      connection.setAttribute(
        "aria-label",
        message2("pingStatus", {
          ping: `${message2(localMode ? "simPing" : "ping")} ${required("#ping").textContent}`,
          status
        })
      );
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
  async function readGameState() {
    const generation = clickGeneration;
    for (; ; ) {
      const epoch = identityEpoch;
      try {
        const state = await api("/api/game");
        if (epoch === identityEpoch || generation !== clickGeneration) return state;
      } catch (error) {
        if (epoch === identityEpoch || generation !== clickGeneration) throw error;
      }
    }
  }
  function setUser(nextUser) {
    const identityChanged = user?.id !== nextUser?.id;
    user = nextUser;
    if (identityChanged) lastOnlineCounters = null;
    required("#nav-username").textContent = user?.username ?? "";
    required("#admin-link").hidden = !user?.admin;
    if (identityChanged) {
      required("#replace-local").checked = false;
      resetClickState();
      renderCounters({}, true);
      if (optionsDialog.open) updateOptions();
    }
  }
  function resetClickState() {
    clickGeneration++;
    cooldownUntil = 0;
    window.clearTimeout(cooldownTimer);
    required("#play-status").hidden = true;
    required("#cooldown-time").textContent = "";
    counterLoad = null;
    counterLoadOwner = null;
    counterCard.setAttribute("aria-busy", "false");
    pendingClicks = 0;
    localRefreshQueued = false;
    updatePendingIndicator();
    clickBatchFailed = false;
    refreshQueued = false;
    window.clearTimeout(pingStateTimer);
    lastPing = null;
    connectionState = "";
    required("#ping").textContent = "\u2014 ms";
    connection.classList.remove("is-loading", "is-error", "is-limited");
    connection.setAttribute("aria-label", message2("noPing"));
    tactileButtons.get(clickButton)?.reset();
    clickFeedback.reset();
    statsShare.reset();
    updateGameControls();
  }
  function updateGameControls() {
    clickButton.disabled = !gameReady || offline && !localMode || signingOut || authenticating && !localMode || localMode && localSaveReplacing || !localMode && pendingClicks >= maxPendingClicks;
    clickButton.setAttribute("aria-disabled", String(clickButton.disabled || coolingDown()));
    refreshCounterButton.disabled = offline && !localMode || signingOut || pendingClicks > 0 || localMode && localSaveReplacing;
    refreshCounterButton.setAttribute(
      "aria-disabled",
      String(refreshCounterButton.disabled || !!counterLoad)
    );
    refreshCounterButton.setAttribute("aria-busy", String(!!counterLoad));
    required("#share-stats").disabled = !gameReady || signingOut || pendingClicks > 0 || !!counterLoad || localSaveReplacing;
    required("#network-notice").hidden = !offline || localMode;
    required("#local-mode-note").hidden = !localMode;
    required("#counter-label").textContent = message2(localMode ? "localClicks" : "savedClicks");
    required(".connection-label").textContent = message2(localMode ? "simPing" : "ping");
    document.querySelectorAll("[data-play-local]").forEach((button) => {
      button.hidden = localMode;
      button.disabled = pendingClicks > 0 || signingOut || localSaveReplacing;
    });
    required("#leave-local").disabled = pendingClicks > 0 || localSaveReplacing || authenticating;
    required("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0 || localSaveReplacing;
    for (const id of ["#restart-local", "#import-local", "#download-local", "#replace-local"])
      required(id).disabled = localSaveReplacing;
  }
  function updatePendingIndicator() {
    if (pendingClicks === 0) {
      window.clearTimeout(pendingIndicatorTimer);
      pendingIndicatorTimer = 0;
      pendingIndicator.hidden = true;
      pendingIndicator.textContent = "";
      return;
    }
    pendingIndicator.textContent = message2("pending", { count: formatNumber(pendingClicks) });
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
    const displayedClicks = displayedCounters.click_count?.count ?? 0;
    if (!allowDecrease && clicks && Number.isFinite(displayedClicks) && clicks.count < displayedClicks)
      return;
    displayedCounters = data;
    for (const [id, count] of [
      ["click-count", clicks?.count ?? 0],
      ["day-streak", data.streak_counter_day?.count ?? 0],
      ["month-streak", data.streak_counter_month?.count ?? 0],
      ["year-streak", data.streak_counter_year?.count ?? 0]
    ]) {
      const element = required(`#${id}`), changed = element.textContent !== formatNumber(count);
      element.textContent = formatNumber(count);
      if (changed && !allowDecrease) animateNumber(element);
    }
    required("#last-click").textContent = clicks?.modified_time ? message2("lastClick", {
      time: parseStoredTimestamp(clicks.modified_time).toLocaleString(currentLanguage())
    }) : message2("noClicks");
  }
  function openGame(initialGame, backgroundRefresh = false) {
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
    if (!backgroundRefresh) counterCard.setAttribute("aria-busy", "true");
    setConnection(null, "loading");
    const owner = {};
    counterLoadOwner = owner;
    const load = (async () => {
      try {
        const state = await (initialGame ?? readGameState());
        if (generation !== clickGeneration) return;
        const activeLoad = counterLoad;
        setUser(state.user);
        counterLoad = activeLoad;
        generation = clickGeneration;
        counterLoadOwner = owner;
        lastOnlineCounters = state.counters;
        renderCounters(state.counters, true);
        if (optionsDialog.open) updateOptions();
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
          showGameError("loadError", !backgroundRefresh);
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
    if (cooldownUntil) paintCooldown();
    refreshGame();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) identityEpoch++;
    else resumeGame();
  });
  window.addEventListener("blur", () => identityEpoch++);
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
      if (authenticating) return;
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
  function setAuthenticating(active, form) {
    authenticating = active;
    setSubmitting(form, active);
    for (const other of [loginForm, signupForm])
      required("button[type=submit]", other).disabled = active;
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.disabled = active;
    });
    updateGameControls();
  }
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (authenticating || signingOut) return;
    showError("#login-error", "");
    setAuthenticating(true, loginForm);
    const generation = clickGeneration;
    let signedIn = false;
    try {
      const form = new FormData(loginForm);
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          identifier_type: form.get("identifier_type") ?? "auto"
        })
      });
      if (generation !== clickGeneration || currentView !== "login") {
        if (!localMode) await boot();
        return;
      }
      loginForm.reset();
      setUser(result.user);
      signedIn = true;
      await openGame();
    } catch (caught) {
      const error = requestError(caught);
      if (generation === clickGeneration && currentView === "login")
        showError("#login-error", error.message, true);
    } finally {
      setAuthenticating(false, loginForm);
      if (signedIn && !localMode && currentView === "game" && gameReady) clickButton.focus();
    }
  });
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (authenticating || signingOut) return;
    showError("#signup-error", "");
    const form = new FormData(signupForm);
    if (form.get("password") !== form.get("password_confirmation")) {
      showError("#signup-error", "Passwords do not match.", true);
      required("#signup-password-confirmation").focus();
      return;
    }
    setAuthenticating(true, signupForm);
    const generation = clickGeneration;
    let signedIn = false;
    try {
      const result = await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      if (generation !== clickGeneration || currentView !== "signup") {
        if (!localMode) await boot();
        return;
      }
      signupForm.reset();
      setUser(result.user);
      signedIn = true;
      await openGame();
    } catch (caught) {
      const error = requestError(caught);
      if (generation === clickGeneration && currentView === "signup")
        showError("#signup-error", error.message, true);
    } finally {
      setAuthenticating(false, signupForm);
      if (signedIn && !localMode && currentView === "game" && gameReady) clickButton.focus();
    }
  });
  var logoutButton = required("#logout-button");
  logoutButton.addEventListener("click", async () => {
    if (authenticating || signingOut) return;
    showError("#game-error", "");
    signingOut = true;
    gameReady = false;
    updateGameControls();
    logoutButton.disabled = true;
    try {
      await api("/api/auth/logout", { method: "DELETE" });
      setUser(null);
      show("home");
    } catch {
      gameReady = true;
      showGameError("signOutError", true);
    } finally {
      signingOut = false;
      logoutButton.disabled = false;
      updateGameControls();
    }
  });
  clickButton.addEventListener("click", async (event) => {
    if (clickButton.disabled) return;
    paintButtonLanguage(buttonLanguage.click(performance.now(), currentLanguage()));
    if (localMode) {
      await clickLocal(event);
      return;
    }
    if (!user || !gameReady || offline && !localMode || signingOut || authenticating || !localMode && pendingClicks >= maxPendingClicks)
      return;
    if (coolingDown()) {
      tactileButtons.get(clickButton)?.respond("limited");
      return;
    }
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
      const data = await api("/api/clicks", {
        method: "POST",
        headers: { "X-GoClick-User-ID": user.id }
      });
      if (generation !== clickGeneration) return;
      renderCounters(data);
      if ((data.click_count?.count ?? 0) >= (lastOnlineCounters?.click_count?.count ?? 0))
        lastOnlineCounters = data;
      feedback.success(performance.now() - started);
      saved = true;
    } catch (caught) {
      const error = requestError(caught);
      if (generation !== clickGeneration) return;
      feedback.fail(error.uncertain, error.status === 429);
      if (error.status === 401) {
        if (user && !signingOut) handleExpiredSession();
        return;
      }
      if (error.code === "account_changed") {
        gameReady = false;
        refreshQueued = true;
        return;
      }
      if (error.status === 429) {
        startCooldown(error.retryAfter);
        return;
      }
      clickBatchFailed = true;
      showGameError(error.uncertain ? "unconfirmedClick" : "unsavedClick", true);
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
      const state = await readGameState();
      if (generation !== clickGeneration || localMode) return;
      setUser(state.user);
      await openGame(state);
    } catch (caught) {
      const error = requestError(caught);
      if (generation !== clickGeneration || localMode) return;
      if (error.status === 401) {
        setUser(null);
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
  function optionsNotice(message3, error = false) {
    const notice = required("#options-status");
    notice.textContent = message3;
    notice.hidden = !message3;
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
  motionShortcut.addEventListener("click", () => {
    try {
      gameSettings.update({ motion: "off" });
    } catch {
    }
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
    } catch {
      gameReady = false;
      updateGameControls();
      showGameError("localLoadError", true);
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
  required("#leave-local").addEventListener("click", async () => {
    if (pendingClicks > 0 || localSaveReplacing || authenticating) return;
    let remembered = true;
    try {
      gameSettings.setMode("online");
    } catch {
      remembered = false;
    }
    localMode = false;
    gameReady = false;
    resetClickState();
    await boot();
    if (!remembered) {
      updateOptions();
      optionsNotice(
        "Back online for this visit. Browser storage is unavailable, so this mode change could not be remembered.",
        true
      );
      optionsDialog.showModal();
    }
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
    } catch {
      if (generation !== clickGeneration) return;
      feedback.fail(false);
      setConnection(null, "error");
      showGameError("localClickError", true);
    } finally {
      if (generation === clickGeneration) {
        pendingClicks--;
        updateGameControls();
        if (pendingClicks === 0 && localRefreshQueued) synchronizeLocalSave();
      }
    }
  }
  async function replaceLocalSave(operation, message3) {
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
      const data = await operation();
      await localGame.change(() => localGame.replace(data));
      if (localMode) {
        resetClickState();
        openLocalGame();
      }
      updateOptions();
      optionsNotice(message3);
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
    () => replaceLocalSave(() => ({}), "Local save restarted.")
  );
  required("#copy-online-local").addEventListener("click", () => {
    if (!lastOnlineCounters) return;
    const snapshot = lastOnlineCounters;
    replaceLocalSave(
      () => snapshot,
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
      await replaceLocalSave(async () => localGame.decode(await file.text()), "Local save imported.");
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
  var languageSetting = required("#language-setting");
  for (const language2 of languages) {
    const option = document.createElement("option");
    option.value = language2.code;
    option.textContent = language2.name;
    option.lang = language2.code;
    option.dir = language2.dir;
    languageSetting.append(option);
  }
  function applyLanguage() {
    translatePage();
    languageSetting.value = currentLanguage();
    document.documentElement.lang = currentView === "game" ? currentLanguage() : "en";
    buttonLanguage.reset(currentLanguage());
    paintButtonLanguage(currentLanguage());
    renderCounters(displayedCounters, true);
    updatePendingIndicator();
    updateGameControls();
    if (lastGameError) showGameError(lastGameError);
    if (cooldownUntil) paintCooldown();
    else setConnection(null, connectionState);
  }
  onLanguageChange(applyLanguage);
  setLanguage(readLanguage());
  applyLanguage();
  languageSetting.addEventListener("change", () => {
    const language2 = supportedLanguage(languageSetting.value);
    if (language2 && !rememberLanguage(language2)) languageSetting.title = message2("languageVisit");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === languageStorageKey || event.key === null) setLanguage(readLanguage());
  });
  boot();
})();
