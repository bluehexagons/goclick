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

  // frontend/power-sequence.ts
  var powerBootDuration = 350;
  var powerBootSteps = [
    { at: 0, pitch: 310, light: 0.14 },
    { at: 70, pitch: 465, light: 0.28 },
    { at: 145, pitch: 620, light: 0.52 }
  ];
  function powerBootLighting(elapsed) {
    if (elapsed < 0 || elapsed >= powerBootDuration) return 0;
    const remaining = Math.sqrt(1 - elapsed / powerBootDuration);
    let light = 0;
    for (const step of powerBootSteps) {
      const time = Math.max(0, elapsed - step.at);
      const attack = Math.min(time / 28, 1);
      light += step.light * attack * Math.exp(-Math.max(0, time - 28) / 90);
    }
    return light * remaining;
  }

  // frontend/sound-design.ts
  var typicalSaveDelayMs = 50;
  var soundProfiles = [
    {
      id: "classic",
      name: "profileClassic",
      description: "profileClassicDescription"
    },
    { id: "blip", name: "profileBlip", description: "profileBlipDescription" },
    { id: "clack", name: "profileClack", description: "profileClackDescription" },
    {
      id: "clunk",
      name: "profileClunk",
      description: "profileClunkDescription"
    },
    {
      id: "low-beep",
      name: "profileLowBeep",
      description: "profileLowBeepDescription"
    },
    {
      id: "soft-chime",
      name: "profileSoftChime",
      description: "profileSoftChimeDescription"
    }
  ];
  function isSoundProfile(value) {
    return soundProfiles.some((profile2) => profile2.id === value);
  }
  function whiteNoise(random) {
    return random() * 2 - 1;
  }
  function renderRoomImpulse(sampleRate, random = Math.random) {
    const impulse = new Float32Array(Math.ceil(sampleRate * 0.13));
    for (const [ms, gain] of [
      [7, 0.15],
      [12, -0.075],
      [19, 0.055],
      [27, 0.035],
      [33, -0.02]
    ])
      impulse[Math.round(sampleRate * ms / 1e3)] = gain;
    let tailMagnitude = 0;
    const tailStart = Math.ceil(sampleRate * 0.036);
    for (let i = tailStart; i < impulse.length; i++) {
      const time = (i - tailStart) / sampleRate;
      const reflection = whiteNoise(random) * Math.exp(-time / 0.021);
      impulse[i] = reflection;
      tailMagnitude += Math.abs(reflection);
    }
    const tailGain = tailMagnitude > 0 ? 0.12 / tailMagnitude : 0;
    for (let i = tailStart; i < impulse.length; i++) impulse[i] = impulse[i] * tailGain;
    return impulse;
  }
  function createSoundMotion(random = Math.random) {
    const phase = random() * Math.PI * 2;
    const texturePhase = random() * Math.PI * 2;
    let previous = null;
    let activity = 0;
    let accent = 0;
    return {
      sample(milliseconds, press = false) {
        if (previous !== null) activity *= Math.exp(-Math.max(0, milliseconds - previous) / 900);
        previous = milliseconds;
        if (press) {
          activity = Math.min(1, activity + 0.1);
          accent = (random() - 0.5) * 8e-3;
        }
        const time = milliseconds / 1e3;
        const drift = 0.65 * Math.sin(time * 0.73 + phase) + 0.35 * Math.sin(time * 0.23 + phase);
        const breath = Math.sin(time * 1.13 + texturePhase);
        return {
          pitch: 1 + drift * 0.045 + activity * 0.035 + accent,
          texture: 0.9 + breath * 0.15 + activity * 0.08,
          duration: 1 + breath * 0.035 - activity * 0.025,
          strength: 0.94 + drift * 0.035 + activity * 0.015
        };
      }
    };
  }
  var recipes = {
    classic: {
      pitch: 175,
      end: 65,
      release: { pitch: 1.5, duration: 0.034, decay: 7e-3 },
      save: { pitch: 820, end: 950, attack: 7e-4, decay: 45e-4 },
      ring: 1450,
      duration: 0.095,
      decay: 0.018,
      attack: 7e-4
    },
    blip: {
      pitch: 620,
      end: 830,
      release: { pitch: 1.35, duration: 0.036, decay: 8e-3 },
      save: { pitch: 1100, end: 1390, attack: 15e-4, decay: 6e-3 },
      ring: 1240,
      duration: 0.075,
      decay: 0.021,
      attack: 15e-4
    },
    clack: {
      release: { duration: 0.028, decay: 5e-3 },
      save: { decay: 3e-3, brightness: 0.76 },
      duration: 0.065,
      decay: 9e-3,
      attack: 5e-4
    },
    clunk: {
      release: { duration: 0.038, decay: 9e-3 },
      save: { decay: 6e-3, brightness: 1.1 },
      duration: 0.13,
      decay: 0.02,
      attack: 15e-4
    },
    "low-beep": {
      pitch: 170,
      end: 160,
      release: { pitch: 1.3, duration: 0.04, decay: 9e-3 },
      save: { pitch: 275, end: 310, attack: 3e-3, decay: 8e-3 },
      ring: 340,
      duration: 0.11,
      decay: 0.023,
      attack: 5e-3
    },
    "soft-chime": {
      pitch: 440,
      end: 440,
      release: { pitch: 1.25, duration: 0.043, decay: 0.01 },
      save: { pitch: 660, end: 660, attack: 25e-4, decay: 9e-3 },
      ring: 1214,
      duration: 0.16,
      decay: 0.024,
      attack: 4e-3
    }
  };
  var responses = {
    saved: { level: 0.015, duration: 0.03 },
    slow: { pitch: 0.64, end: 0.77, level: 0.014, duration: 0.052, decay: 0.012 },
    error: { pitch: 0.25, end: 0.16, level: 0.019, duration: 0.069, decay: 0.017 },
    limited: { pitch: 0.35, end: 0.28, level: 0.016, duration: 0.062, decay: 0.014 },
    hold: { pitch: 0.56, end: 0.58, level: 7e-3, duration: 0.04, decay: 9e-3 }
  };
  var impactResponses = {
    slow: { decay: 0.01, brightness: 0.75 },
    error: { decay: 6e-3, brightness: 0.65, repeatAt: 0.022 },
    limited: { decay: 5e-3, brightness: 0.55, repeatAt: 0.034 },
    hold: { decay: 8e-3, brightness: 0.72 }
  };
  function filterWeight(frequency, sampleRate) {
    return 1 - Math.exp(-2 * Math.PI * frequency / sampleRate);
  }
  function matchCueLevel(samples, sampleRate, level) {
    const lowWeight = filterWeight(160, sampleRate);
    const midWeight = filterWeight(4800, sampleRate);
    let low = 0;
    let mid = 0;
    let energy = 0;
    let peak = 0;
    for (const sample of samples) {
      low += (sample - low) * lowWeight;
      mid += (sample - low - mid) * midWeight;
      energy += mid * mid;
      peak = Math.max(peak, Math.abs(sample));
    }
    if (peak === 0) return samples;
    const gain = Math.min(level / Math.sqrt(energy / (sampleRate * 0.1)), 0.9 / peak);
    for (let i = 0; i < samples.length; i++) samples[i] = samples[i] * gain;
    return samples;
  }
  function renderImpact(samples, profile2, sampleRate, attack, { decay, brightness = 1, repeatAt = Infinity }, variation, random) {
    const bright = profile2 === "clack";
    const lowWeight = filterWeight((bright ? 1300 : 95) * variation.pitch * brightness, sampleRate);
    const highWeight = filterWeight(
      (bright ? 5200 : 780) * variation.texture * brightness,
      sampleRate
    );
    let low = 0;
    let high = 0;
    let band = 0;
    for (let i = 0; i < samples.length; i++) {
      const time = i / sampleRate;
      const noise = whiteNoise(random);
      low += (noise - low) * lowWeight;
      high += (noise - high) * highWeight;
      band += (high - low - band) * highWeight;
      let envelope = Math.min(1, time / attack) * Math.exp(-time / decay);
      if (time >= repeatAt) {
        const sinceRepeat = time - repeatAt;
        envelope += 0.65 * Math.min(1, sinceRepeat / attack) * Math.exp(-sinceRepeat / decay);
      }
      const fadeOut = Math.min(1, (samples.length - 1 - i) / (sampleRate * 8e-3));
      samples[i] = band * envelope * fadeOut;
    }
  }
  function renderSound(profile2, cue, sampleRate, variation, random = Math.random) {
    const recipe = recipes[profile2];
    const physical = cue === "press" || cue === "release";
    const response = physical ? null : responses[cue];
    const saved = cue === "saved";
    const release2 = cue === "release" ? recipe.release : null;
    const level = (response?.level ?? (release2 ? 0.027 : 0.056)) * variation.strength;
    const duration = (response?.duration ?? release2?.duration ?? recipe.duration) * variation.duration;
    const samples = new Float32Array(Math.ceil(sampleRate * duration));
    if (profile2 === "clack" || profile2 === "clunk") {
      const envelope = saved ? recipes[profile2].save : physical ? { decay: release2?.decay ?? recipe.decay } : impactResponses[cue];
      renderImpact(samples, profile2, sampleRate, recipe.attack, envelope, variation, random);
      return matchCueLevel(samples, sampleRate, level);
    }
    const oscillator = recipes[profile2];
    const multiplier = cue === "release" ? oscillator.release.pitch : 1;
    const relative = physical || saved ? null : responses[cue];
    const pitch = physical ? oscillator.pitch * multiplier : oscillator.save.pitch * (relative?.pitch ?? 1);
    const end = physical ? oscillator.end * multiplier : relative ? oscillator.save.pitch * relative.end : oscillator.save.end;
    const attack = saved ? oscillator.save.attack : oscillator.attack;
    const decay = physical ? release2?.decay ?? oscillator.decay : relative?.decay ?? oscillator.save.decay;
    const stepPitch = end < pitch ? -pitch : pitch;
    const stepAt = saved ? 7e-3 : 0.018;
    let previousNoise = 0;
    for (let i = 0; i < samples.length; i++) {
      const time = i / sampleRate;
      const phase = 2 * Math.PI * variation.pitch * (end * time + (pitch - end) * 0.012 * (1 - Math.exp(-time / 0.012)));
      const envelope = Math.exp(-time / decay);
      const ring2 = Math.sin(2 * Math.PI * oscillator.ring * variation.pitch * time);
      let wave;
      switch (profile2) {
        case "classic": {
          const noise = physical || saved ? whiteNoise(random) : 0;
          const highNoise = noise - previousNoise;
          previousNoise = noise;
          wave = (saved ? 0.23 : physical ? 0.46 : 0.6) * Math.sin(phase) * envelope + 0.1 * ring2 * Math.exp(-time / 6e-3) + (0.23 * noise + 0.1 * highNoise) * variation.texture * Math.exp(-time / 3e-3);
          break;
        }
        case "blip": {
          const stepPhase = phase + Math.max(0, time - stepAt) * stepPitch * 0.35 * Math.PI * 2;
          const triangle = 2 * Math.asin(Math.sin(stepPhase)) / Math.PI;
          const pulse = Math.tanh(Math.sin(stepPhase) * (2.2 + variation.texture));
          wave = (0.5 * triangle + 0.18 * pulse) * envelope;
          break;
        }
        case "low-beep":
          wave = (0.6 * Math.sin(phase) + 0.1 * Math.sin(phase * 2) + 0.04 * Math.sin(phase / 2)) * envelope;
          break;
        case "soft-chime":
          wave = (0.43 * Math.sin(phase) + 0.17 * Math.sin(phase * (2.76 + variation.texture * 0.015)) + 0.13 * Math.sin(phase * 4.07)) * envelope;
          break;
      }
      const fade = Math.min(1, time / attack, (samples.length - 1 - i) / (sampleRate * 8e-3));
      samples[i] = wave * fade;
    }
    return matchCueLevel(samples, sampleRate, level);
  }
  var hardwareSounds = {
    boot: {
      level: 0.052,
      duration: powerBootDuration,
      hits: powerBootSteps.map(({ at, pitch }, index) => ({
        at,
        pitch,
        gain: 0.14 + 0.04 * index,
        decay: 32 + 7 * index,
        noise: 0
      }))
    },
    test: {
      level: 0.054,
      duration: 165,
      hits: [
        { at: 0, pitch: 83, gain: 0.57, decay: 32, noise: 0.32 },
        { at: 25, pitch: 164, gain: 0.25, decay: 19, noise: 0.23 }
      ]
    },
    reset: {
      level: 0.034,
      duration: 100,
      hits: [
        { at: 0, pitch: 214, gain: 0.33, decay: 16, noise: 0.24 },
        { at: 12, pitch: 420, gain: 0.13, decay: 12, noise: 0.13 }
      ]
    },
    "plug-loose": {
      level: 0.028,
      duration: 215,
      hits: [
        { at: 0, pitch: 155, gain: 0.16, decay: 24, noise: 0.55 },
        { at: 55, pitch: 230, gain: 0.12, decay: 19, noise: 0.37 }
      ]
    },
    unplug: {
      level: 0.033,
      duration: 225,
      hits: [
        { at: 0, pitch: 126, gain: 0.44, decay: 25, noise: 0.48 },
        { at: 97, pitch: 178, gain: 0.13, decay: 23, noise: 0.42 }
      ]
    },
    "plug-in": {
      level: 0.033,
      duration: 195,
      hits: [
        { at: 0, pitch: 255, gain: 0.15, decay: 16, noise: 0.5 },
        { at: 115, pitch: 113, gain: 0.35, decay: 20, noise: 0.28 }
      ]
    },
    "cord-slack": {
      level: 0.025,
      duration: 135,
      hits: [
        { at: 0, pitch: 294, gain: 0.19, decay: 15, noise: 0.27 },
        { at: 36, pitch: 171, gain: 0.13, decay: 20, noise: 0.35 }
      ]
    },
    "cord-tension": {
      level: 0.025,
      duration: 130,
      hits: [
        { at: 0, pitch: 191, gain: 0.15, decay: 19, noise: 0.32 },
        { at: 26, pitch: 325, gain: 0.21, decay: 16, noise: 0.21 }
      ]
    }
  };
  function renderHardwareSound(cue, sampleRate, random = Math.random) {
    const { duration, hits, level } = hardwareSounds[cue];
    const samples = new Float32Array(Math.ceil(sampleRate * duration / 1e3));
    const connector = cue !== "boot" && cue !== "test" && cue !== "reset";
    for (const { at, pitch, gain, decay, noise } of hits) {
      const start = Math.round(sampleRate * at / 1e3);
      const bodyDecay = connector ? decay * 0.45 : decay;
      let previousNoise = 0;
      for (let i = start; i < samples.length; i++) {
        const ms = (i - start) * 1e3 / sampleRate;
        const phase = 2 * Math.PI * pitch * ms / 1e3;
        const body = Math.sin(phase) * Math.exp(-ms / bodyDecay);
        const ring2 = 0.24 * Math.sin(phase * (noise ? 3.1 : 2)) * Math.exp(-2 * ms / bodyDecay);
        const sample = noise ? whiteNoise(random) : 0;
        const snap = (sample - 0.3 * previousNoise) * noise * (connector ? 1.7 : 1) * Math.exp(-ms / 5);
        previousNoise = sample;
        const fade = Math.min(
          1,
          ms / (noise ? 0.8 : 9),
          (samples.length - 1 - i) * 1e3 / (sampleRate * 12)
        );
        samples[i] = samples[i] + gain * fade * ((body + ring2) * (connector ? 0.32 : 1) + snap);
      }
    }
    return matchCueLevel(samples, sampleRate, level);
  }

  // frontend/preferences.ts
  var simulatedPings = [0, typicalSaveDelayMs, 80, 250, 800];
  function isSimulatedPing(value) {
    return simulatedPings.some((ping) => ping === value);
  }
  var defaultSoundVolume = 100;
  var gameSettings = (() => {
    const key = "goclick.settings.v1";
    const browser = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listeners2 = /* @__PURE__ */ new Set();
    const settingListeners = /* @__PURE__ */ new Set();
    let value = {
      motion: "auto",
      simulatedPing: typicalSaveDelayMs,
      sound: false,
      soundProfile: "classic",
      soundVolume: defaultSoundVolume,
      soundReverb: true
    };
    function parse(raw) {
      const decoded = JSON.parse(raw || "{}");
      const saved = isRecord(decoded) ? decoded : {};
      return {
        sound: saved.sound === true,
        soundProfile: isSoundProfile(saved.soundProfile) ? saved.soundProfile : "classic",
        soundVolume: typeof saved.soundVolume === "number" && Number.isInteger(saved.soundVolume) && saved.soundVolume >= 0 && saved.soundVolume <= 100 ? saved.soundVolume : defaultSoundVolume,
        soundReverb: saved.soundReverb !== false,
        motion: saved.motion === "on" || saved.motion === "off" ? saved.motion : "auto",
        simulatedPing: isSimulatedPing(saved.simulatedPing) ? saved.simulatedPing : typicalSaveDelayMs
      };
    }
    try {
      value = parse(localStorage.getItem(key));
    } catch {
    }
    const motion2 = {
      get matches() {
        return value.motion === "on" || value.motion === "auto" && browser.matches;
      },
      addEventListener(type, callback) {
        if (type === "change") listeners2.add(callback);
      }
    };
    let appliedMotion;
    function apply() {
      const matches = motion2.matches;
      document.documentElement.dataset.reducedMotion = String(matches);
      for (const callback of settingListeners) callback();
      if (matches === appliedMotion) return;
      appliedMotion = matches;
      for (const callback of listeners2) callback({ matches });
    }
    browser.addEventListener("change", apply);
    window.addEventListener("storage", (event) => {
      if (event.key !== key && event.key !== null) return;
      try {
        value = parse(event.newValue);
        apply();
      } catch {
      }
    });
    apply();
    return {
      motion: motion2,
      onChange(callback) {
        settingListeners.add(callback);
      },
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

  // frontend/progress.ts
  var fortnight = 14;
  var fortnightMask = (1 << fortnight) - 1;
  var dayMilliseconds = 864e5;
  var emptyProgress = {
    recent_days: 0,
    week_streak: 0,
    best_day_streak: 0,
    best_week_streak: 0
  };
  function utcDay(time) {
    return Math.floor(time / dayMilliseconds);
  }
  function utcWeek(day) {
    return Math.floor((day + 3) / 7);
  }
  function sameUtcMonth(first, second) {
    return first.getUTCFullYear() === second.getUTCFullYear() && first.getUTCMonth() === second.getUTCMonth();
  }
  function seedProgress(time, dailyStreak) {
    if (!time) return { ...emptyProgress, best_day_streak: dailyStreak };
    const last = utcDay(Date.parse(time));
    const first = Math.max(-1e8, last - Math.max(0, dailyStreak - 1));
    const weeks = utcWeek(last) - utcWeek(first) + 1;
    return {
      recent_days: (1 << Math.min(fortnight, last - first + 1)) - 1,
      week_streak: weeks,
      best_day_streak: Math.max(1, dailyStreak),
      best_week_streak: weeks
    };
  }
  function advanceProgress(progress, previous, time, dailyStreak) {
    if (!previous) {
      const first = seedProgress(time, dailyStreak);
      first.best_day_streak = Math.max(first.best_day_streak, progress.best_day_streak);
      return first;
    }
    const before = utcDay(Date.parse(previous));
    const today = utcDay(Date.parse(time));
    if (before === today) {
      return dailyStreak <= progress.best_day_streak ? progress : { ...progress, best_day_streak: dailyStreak };
    }
    const gap = utcWeek(today) - utcWeek(before);
    const weeks = gap <= 1 ? progress.week_streak + gap : 1;
    return {
      recent_days: (progress.recent_days << Math.min(fortnight, today - before) | 1) & fortnightMask,
      week_streak: weeks,
      best_day_streak: Math.max(dailyStreak, progress.best_day_streak),
      best_week_streak: Math.max(weeks, progress.best_week_streak)
    };
  }
  function fortnightActivity(mask) {
    let days = 0;
    let consecutivePairs = 0;
    for (let bits = mask; bits; bits >>>= 1) {
      days += bits & 1;
      consecutivePairs += bits & bits >>> 1 & 1;
    }
    const score = Math.round(
      100 * (5 * days + 2 * consecutivePairs) / (5 * fortnight + 2 * (fortnight - 1))
    );
    return { days, score };
  }
  function utcReset(now) {
    const start = utcDay(now) * dayMilliseconds;
    const next = start + dayMilliseconds;
    return { next, elapsed: now - start, minutesLeft: Math.ceil((next - now) / 6e4) };
  }
  var century = 1;
  var fourDigits = 2;
  var fiveGrand = 4;
  var threeVisits = 8;
  var calendarBadgeTargets = {
    day_clicks: 100,
    week_clicks: 1e3,
    month_clicks: 5e3,
    active_days: 10,
    active_months: 3
  };
  var distinctHoursTarget = 3;
  function countSetBits(mask) {
    let count = 0;
    for (let bits = mask; bits; bits &= bits - 1) count++;
    return count;
  }
  var emptyClickAchievements = {
    day_clicks: 0,
    week_clicks: 0,
    month_clicks: 0,
    hours: 0,
    active_days: 0,
    active_months: 0,
    earned: 0
  };

  // frontend/types.ts
  var counterKinds = [
    "click_count",
    "streak_counter_day",
    "streak_counter_month",
    "streak_counter_year"
  ];

  // frontend/local-game.ts
  var localGame = (() => {
    const key = "goclick.local.v1";
    const coordinationTimeout = 1e4;
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
      const last = result.click_count?.modified_time;
      const daily = result.streak_counter_day?.count ?? 0;
      result.progress = counters.progress == null ? seedProgress(last, daily) : validateProgress(counters.progress, last, daily);
      result.achievements = counters.achievements == null ? seedAchievements(last, daily, result.streak_counter_month?.count ?? 0) : validateAchievements(counters.achievements, Boolean(last));
      return result;
    }
    function validateProgress(value, last, daily) {
      if (!isRecord(value)) throw new Error("Invalid local achievement progress.");
      const { recent_days, week_streak, best_day_streak, best_week_streak } = value;
      if (!nonnegativeInteger(recent_days) || recent_days > fortnightMask || !nonnegativeInteger(week_streak) || !nonnegativeInteger(best_day_streak) || best_day_streak < daily || !nonnegativeInteger(best_week_streak) || best_week_streak < week_streak || Boolean(recent_days & 1) !== Boolean(last) || Boolean(week_streak) !== Boolean(last) || (last ? best_day_streak < 1 : recent_days !== 0 || best_week_streak !== 0))
        throw new Error("Invalid local achievement progress.");
      return { recent_days, week_streak, best_day_streak, best_week_streak };
    }
    function nonnegativeInteger(value) {
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    }
    const achievementLimits = {
      ...calendarBadgeTargets,
      hours: 16777215,
      earned: century | fourDigits | fiveGrand | threeVisits
    };
    function validateAchievements(value, hasTime) {
      if (!isRecord(value)) throw new Error("Invalid local achievement progress.");
      const result = { ...emptyClickAchievements };
      for (const key2 of Object.keys(achievementLimits)) {
        const field = value[key2];
        if (!nonnegativeInteger(field) || field > achievementLimits[key2])
          throw new Error("Invalid local achievement progress.");
        result[key2] = field;
      }
      for (const key2 of ["day_clicks", "week_clicks", "month_clicks", "hours"])
        if (Boolean(result[key2]) !== hasTime) throw new Error("Invalid local achievement activity.");
      return result;
    }
    function seedAchievements(time, days, months) {
      const activity = {
        ...emptyClickAchievements,
        active_days: Math.min(calendarBadgeTargets.active_days, days),
        active_months: Math.min(calendarBadgeTargets.active_months, months)
      };
      if (!time) return activity;
      const seeded = advanceAchievements(emptyClickAchievements, null, time);
      seeded.active_days = Math.max(activity.active_days, 1);
      seeded.active_months = Math.max(activity.active_months, 1);
      return seeded;
    }
    function advanceAchievements(a, previous, current) {
      const now = new Date(current);
      const before = previous ? new Date(previous) : null;
      const day = utcDay(now.getTime());
      const previousDay = before ? utcDay(before.getTime()) : NaN;
      const sameMonth = before !== null && sameUtcMonth(before, now);
      const dayClicks = day === previousDay ? Math.min(calendarBadgeTargets.day_clicks, a.day_clicks + 1) : 1;
      const weekClicks = utcWeek(day) === utcWeek(previousDay) ? Math.min(calendarBadgeTargets.week_clicks, a.week_clicks + 1) : 1;
      const monthClicks = sameMonth ? Math.min(calendarBadgeTargets.month_clicks, a.month_clicks + 1) : 1;
      const hours = (day === previousDay ? a.hours : 0) | 1 << now.getUTCHours();
      return {
        day_clicks: dayClicks,
        week_clicks: weekClicks,
        month_clicks: monthClicks,
        hours,
        active_days: Math.min(calendarBadgeTargets.active_days, a.active_days + Number(day !== previousDay)),
        active_months: Math.min(calendarBadgeTargets.active_months, a.active_months + Number(!sameMonth)),
        earned: a.earned | (dayClicks === calendarBadgeTargets.day_clicks ? century : 0) | (weekClicks === calendarBadgeTargets.week_clicks ? fourDigits : 0) | (monthClicks === calendarBadgeTargets.month_clicks ? fiveGrand : 0) | (countSetBits(hours) >= distinctHoursTarget ? threeVisits : 0)
      };
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
      return index === 1 ? utcDay(date.getTime()) : index === 2 ? date.getUTCFullYear() * 12 + date.getUTCMonth() : date.getUTCFullYear();
    }
    function increment(now = /* @__PURE__ */ new Date()) {
      const counters = read();
      const previous = counters.click_count?.modified_time;
      const time = previous && Date.parse(previous) > now.getTime() ? previous : now.toISOString();
      for (const [index, kind] of kinds.entries()) {
        const old = counters[kind], count = old?.count ?? 0;
        let next = count + 1;
        if (index > 0) {
          const gap = old?.modified_time ? period(time, index) - period(old.modified_time, index) : Infinity;
          next = count === 0 || gap > 1 || gap < 0 ? 1 : gap === 0 ? count : count + 1;
        }
        counters[kind] = { count: next, modified_time: time };
      }
      counters.progress = advanceProgress(
        counters.progress,
        previous,
        time,
        counters.streak_counter_day.count
      );
      counters.achievements = advanceAchievements(counters.achievements, previous, time);
      return write(counters);
    }
    async function change(operation) {
      const controller = new AbortController();
      const { signal } = controller;
      const timer = window.setTimeout(() => {
        controller.abort(new Error("The local save was busy for too long. Try again."));
      }, coordinationTimeout);
      const run = () => {
        if (signal.aborted) throw signal.reason;
        window.clearTimeout(timer);
        return operation();
      };
      try {
        return navigator.locks ? await navigator.locks.request(key, { signal }, run) : await changeWithIndexedDB(run, signal);
      } finally {
        window.clearTimeout(timer);
      }
    }
    function changeWithIndexedDB(operation, signal) {
      if (typeof indexedDB === "undefined")
        return Promise.reject(new Error("This browser cannot safely coordinate the local save."));
      return new Promise((resolve, reject) => {
        const opening = indexedDB.open("goclick-local-locks", 1);
        let blocked = false;
        let transaction;
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason);
            try {
              transaction?.abort();
            } catch {
            }
          },
          { once: true }
        );
        opening.onupgradeneeded = () => opening.result.createObjectStore("locks");
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () => {
          blocked = true;
          reject(new Error("Close other Go Click tabs, then try the local save again."));
        };
        opening.onsuccess = () => {
          const database = opening.result;
          try {
            if (blocked || signal.aborted) return;
            const writeLock = database.transaction("locks", "readwrite");
            transaction = writeLock;
            writeLock.onabort = () => {
              reject(writeLock.error ?? new Error("Local save coordination failed."));
            };
            writeLock.objectStore("locks").get(key).onsuccess = () => {
              try {
                resolve(operation());
              } catch (error) {
                reject(error);
              }
            };
          } catch (error) {
            reject(error);
          } finally {
            database.close();
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
  var holdDuration = 1e4;
  var holdBeat = 2e3;
  function holdLighting(elapsed) {
    const charge = Math.min(1, Math.max(0, elapsed / holdDuration));
    const beat = 0.5 + 0.5 * Math.cos(2 * Math.PI * elapsed / holdBeat);
    return charge * (0.085 + 0.018 * beat);
  }
  var outletSockets = { top: -29, bottom: 29 };
  var plugTransitionDuration = { loose: 280, unplugged: 680 };
  var powerDrainDuration = 920;
  var hangingCordLength = (buttonWidth) => buttonWidth * 0.24 + 48;
  function createPlugSwing() {
    let angle = 0;
    let velocity = 0;
    let previousX = 0;
    const limit = 0.55;
    return {
      get angle() {
        return angle;
      },
      reset(x) {
        previousX = x;
        angle = velocity = 0;
      },
      step(x, buttonWidth, dt) {
        angle += (previousX - x) / hangingCordLength(buttonWidth);
        previousX = x;
        velocity = (velocity - 0.023 * angle * dt) * 0.9 ** dt;
        angle += velocity * dt;
        if (Math.abs(angle) > limit) {
          angle = Math.sign(angle) * limit;
          if (angle * velocity > 0) velocity = 0;
        }
        if (Math.abs(angle) < 2e-3 && Math.abs(velocity) < 1e-3) angle = velocity = 0;
        return angle !== 0 || velocity !== 0;
      }
    };
  }
  function powerDrainLighting(elapsed) {
    const remaining = Math.max(0, 1 - Math.max(0, elapsed) / powerDrainDuration);
    const dropout = (center, radius) => Math.max(0, 1 - Math.abs(elapsed - center) / radius);
    return 0.5 * remaining ** 2.2 * (1 - 0.8 * dropout(56, 30) - 0.65 * dropout(146, 38));
  }
  function projectButtonPower(state, buttonWidth, plug = "seated", {
    progress = 1,
    looseBeforeDetach = 1,
    hangAngle = 0,
    socketY = outletSockets.bottom,
    slack = 0,
    seating
  } = {}) {
    const disconnecting = plug === "unplugged";
    const travel = disconnecting ? 1 - (1 - progress) ** 3 : 0;
    const hanging = disconnecting ? travel : seating?.remaining ?? 0;
    const pressWeight = 1 - hanging;
    const pose = projectButtonPose(
      pressWeight === 1 ? state : { ...state, press: state.press * pressWeight, pop: state.pop * pressWeight },
      buttonWidth
    );
    const { scale, recession, lift, cx, sx, cy, sy } = pose;
    const x = -35 * scale, y = 10 * scale, z = -16 - recession;
    const factor = 850 / (850 - (-cx * sy * x + sx * y + cx * cy * z + lift));
    const endX = (cy * x + sy * z + pose.x) * factor;
    const endY = (sx * sy * x + cx * y - sx * cy * z + pose.y) * factor;
    const pullDistance = Math.hypot(state.x, state.y);
    const pull = Math.max(buttonWidth * 0.52, pullDistance, 1);
    let startX = 0;
    let startY = socketY;
    let plugAngle = 0;
    let plugTransform = `translate(0 ${socketY})`;
    let plugEdgeTransform = "";
    if (plug !== "seated") {
      const loosening = disconnecting ? looseBeforeDetach : progress;
      const rock = 1 - (1 - loosening) ** 2 * Math.cos(Math.PI * 2 * loosening);
      const towardX = state.x / (pullDistance || 1);
      const towardY = state.y / (pullDistance || 1);
      const tilt = Math.PI / 5 * (pullDistance / pull) * rock * (1 - travel);
      const foreshortening = 1 - Math.cos(tilt);
      const a = 1 - foreshortening * towardX * towardX;
      const b = -foreshortening * towardX * towardY;
      const d = 1 - foreshortening * towardY * towardY;
      const depth = 8;
      const reach = depth * Math.sin(tilt);
      startX += reach * towardX;
      startY += reach * towardY;
      let rotation = "";
      if (disconnecting) {
        const length2 = hangingCordLength(buttonWidth) + buttonWidth * 0.055 * slack;
        const hangX = endX + length2 * Math.sin(hangAngle);
        const hangY = endY + length2 * Math.cos(hangAngle);
        const tug = 32 * Math.sin(Math.PI * progress) * (1 - progress);
        startX += (hangX - startX) * travel + tug * towardX;
        startY += (hangY - startY) * travel + tug * towardY;
        const swing = 30 * Math.sin(2 * Math.PI * progress) * (1 - progress);
        plugAngle = (180 - hangAngle * 180 / Math.PI) * travel + swing;
        rotation = `rotate(${plugAngle}) `;
      }
      plugTransform = `translate(${startX} ${startY}) ${rotation}matrix(${a} ${b} ${b} ${d} 0 0)`;
      const setback = -depth * Math.tan(tilt);
      plugEdgeTransform = `translate(${setback * towardX} ${setback * towardY})`;
    } else if (seating) {
      startX += (seating.x - startX) * seating.remaining;
      startY += (seating.y - startY) * seating.remaining;
      const tilt = seating.angle - 180 * Math.round(seating.angle / 180);
      plugTransform = `translate(${startX} ${startY}) rotate(${tilt * seating.remaining})`;
    }
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.hypot(dx, dy);
    const length = Math.max(90, buttonWidth * 0.42);
    const restSag = buttonWidth * 0.1 * Math.max(0, 1 - (distance / length) ** 2);
    const extraSag = Math.min(buttonWidth * 0.32, buttonWidth * 0.11 + distance * 0.12);
    const sag = (restSag + slack * extraSag) * (1 - hanging);
    const bow = -0.55 * sag * (Math.abs(dy) / Math.max(1, distance));
    const stretch = Math.max(0.55, 1 / Math.sqrt(Math.max(1, distance / length)));
    const thickness = stretch + (1 - stretch) * (hanging + (1 - hanging) * slack);
    return {
      plugTransform,
      plugEdgeTransform,
      plugAngle,
      startX,
      startY,
      cord: `M ${startX} ${startY} C ${startX + dx / 3 + bow} ${startY + dy / 3 + sag}, ${endX - dx / 3 + bow} ${endY - dy / 3 + sag}, ${endX} ${endY}`,
      endX,
      endY,
      sag,
      thickness
    };
  }
  function createPlugPullTracker() {
    let previous = null;
    const directions = /* @__PURE__ */ new Set();
    let pulls = 0;
    let state = "seated";
    return {
      reseat() {
        state = "seated";
        previous = null;
        directions.clear();
        pulls = 0;
      },
      endPull() {
        previous = null;
      },
      pull(x, y, width) {
        const distance = Math.hypot(x, y);
        if (state === "unplugged") return;
        const threshold = state === "seated" ? Math.max(84, width * 0.52) : Math.max(105, width * 0.66);
        if (distance < threshold * 0.55) previous = null;
        if (distance < threshold) return;
        const direction = { x: x / distance, y: y / distance };
        if (previous && previous.x * direction.x + previous.y * direction.y > 0.25) return;
        previous = direction;
        pulls++;
        if (state === "seated") {
          directions.add(Math.abs(x) >= Math.abs(y) ? x > 0 ? 0 : 1 : y > 0 ? 2 : 3);
          if (pulls < 4 || directions.size < 3) return;
          pulls = 0;
          state = "loose";
          return state;
        }
        if (pulls === 3) {
          state = "unplugged";
          return state;
        }
        return;
      }
    };
  }
  function frameExtent(span, limit, previous = 0) {
    const bucket = 64;
    const needed = Math.min(limit, Math.ceil((span + 32) / bucket) * bucket);
    return previous > needed && previous - needed <= bucket ? Math.min(previous, limit) : needed;
  }
  function projectButtonScene(state, buttonWidth, stage, viewport, previousFrame) {
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
    const width = frameExtent(visibleRight - visibleLeft, viewport.width, previousFrame?.width);
    const height = frameExtent(visibleBottom - visibleTop, viewport.height, previousFrame?.height);
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
  function projectButtonLettering(state) {
    const powered2 = state.powered !== false;
    const charge = !powered2 || state.reducedMotion ? 0 : Math.max(0, Math.min(1, state.labelCharge ?? state.press));
    return {
      scaleX: 1 + charge * 0.22,
      scaleY: 1 + charge * 0.22,
      shiftY: charge ? -charge * 0.01 : 0,
      ink: Math.min(
        0.55,
        state.response * 0.45 + charge * 0.25 + (state.reducedMotion ? 0 : state.flash * 0.18)
      ),
      light: !powered2 ? 0.9 * (state.drainLight ?? 0) ** 1.4 : state.reducedMotion ? Math.min(0.3, state.press * 0.3 + state.response * 0.25) : Math.min(
        1,
        Math.max(
          charge,
          state.flash * 0.8,
          state.response * 0.7,
          (state.bootLight ?? 0) * 0.72
        )
      ),
      charge,
      sheen: state.reducedMotion ? 1.35 : 0.35 + Math.sin((state.labelPhase ?? 0) * 8.8) * 0.5 + (1 - charge)
    };
  }

  // frontend/button-3d.ts
  var ATLAS_WIDTH = 780;
  var LAYER_HEIGHT = 432;
  var ATLAS_LAYERS = 3;
  var ATLAS_HEIGHT = LAYER_HEIGHT * ATLAS_LAYERS;
  var LABEL_FONT_SIZE = 114;
  var LABEL_MAX_WIDTH = 560;
  var GRAPHICS_RETRY_DELAY = 1e3;
  function createButtonRenderer(stage, button) {
    const canvas = required(".button-scene", stage);
    const rig = required(".button-rig", stage);
    let gl = null;
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
    uniform float holdLight;
    uniform float powerLight;
    uniform float readyLight;
    uniform vec3 responseColor;
    uniform vec4 letteringPose;
    uniform vec2 letteringAccent;
    uniform float letteringLight;
    uniform float letteringOpacity;
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
      // Scale before normalization: squared pixel distances overflow the
      // minimum mediump range on GPUs that use 16-bit fragment arithmetic.
      vec3 light = normalize(vec3(-.28, -.35, .5) - worldPosition * .001);
      vec3 view = normalize(vec3(0., 0., .85) - worldPosition * .001);
      float diffuse = max(dot(n, light), 0.);
      float specular = pow(max(dot(n, normalize(light + view)), 0.), 64.);
      // A full-surface albedo and a separate authored emission mask share one
      // atlas with the lettering. Both are independent of the press material.
      vec4 material = texture2D(surfaceAtlas, vec2(texCoord.x, texCoord.y / ${ATLAS_LAYERS}.));
      float luminous = texture2D(surfaceAtlas, vec2(texCoord.x, (texCoord.y + 1.) / ${ATLAS_LAYERS}.)).a;
      vec3 copperMetal = vec3(.78, .36, .20);
      vec3 patina = vec3(.12, .26, .18);
      vec3 surface = mix(vec3(1., .77, .25), copperMetal, copper);
      surface *= .65 + .7 * material.r;
      vec3 gold = surface * (.52 + .70 * diffuse);
      vec3 reflected = reflect(-view, n);
      // GLSL pow is undefined for negative bases, even with exponent 2.
      float bandDistance = (reflected.y + reflected.x * .45 + .05) * 24.;
      float band = exp(-bandDistance * bandDistance);
      float glint = pow(max(dot(n, normalize(light + view)), 0.), 100.);
      gold += vec3(1., .92, .79) * (specular * .38 + copper * (band * .38 + glint * .7));
      float restingShade = (1. - readyLight) * (1. - copper);
      // Shade the existing recesses without replacing their material detail.
      gold *= 1. - .17 * luminous * restingShade * frontFace;
      // Etched channels glow locally; the metal receives no blanket color wash.
      float pulseDistance = (texCoord.x - responseProgress) * 5.;
      float pulse = .8 + .2 * exp(-pulseDistance * pulseDistance);
      float energy = min(1.4, copper * .38 + flash * .65 + response * .8 * pulse + holdLight + powerLight);
      vec3 lightColor = response > 0. ? responseColor : vec3(.22, .72, .46);
      float lit = clamp(luminous * energy * 1.8, 0., 1.) * frontFace;
      gold = mix(gold, lightColor * 1.3, lit);
      gold += lightColor * luminous * energy * .2 * frontFace;
      vec3 bareFace = gold;
      // Move the inscription inside the face, independently of the solid.
      vec2 labelUV = (texCoord - vec2(.5, .5 + letteringPose.z)) / letteringPose.xy + .5;
      labelUV = clamp(labelUV, vec2(0.), vec2(1.));
      vec2 textCoord = vec2(labelUV.x, (labelUV.y + 2.) / ${ATLAS_LAYERS}.);
      vec4 text = texture2D(surfaceAtlas, textCoord);
      // Sample the mask's slope for a raised bevel, plus a short lower-right
      // extrusion. Relief remains visible at rest and follows the scene light.
      float left = texture2D(surfaceAtlas, textCoord - vec2(2. / ${ATLAS_WIDTH}., 0.)).a;
      float right = texture2D(surfaceAtlas, textCoord + vec2(2. / ${ATLAS_WIDTH}., 0.)).a;
      float above = texture2D(surfaceAtlas, textCoord - vec2(0., 2. / ${ATLAS_HEIGHT}.)).a;
      float below = texture2D(surfaceAtlas, textCoord + vec2(0., 2. / ${ATLAS_HEIGHT}.)).a;
      float extrusion = texture2D(surfaceAtlas, textCoord - vec2(4. / ${ATLAS_WIDTH}., 4. / ${ATLAS_HEIGHT}.)).a;
      vec3 bevelNormal = normalize(n + vec3((left - right) * 1.8, (above - below) * 1.8, 0.));
      float bevelLight = max(dot(bevelNormal, light), 0.);
      float bevelGlint = pow(max(dot(bevelNormal, normalize(light + view)), 0.), 24.);
      vec3 inscription = mix(surface * vec3(.36, .30, .22), patina * .62, copper);
      inscription *= .55 + .65 * bevelLight;
      inscription += vec3(.95, .75, .35) * bevelGlint * .32;
      inscription *= 1. - .10 * restingShade;
      inscription = mix(inscription, lightColor * .55, letteringPose.w * .7);
      // A soft, moving reflection rather than a white patch across the word.
      float sheenDistance = (labelUV.x - letteringAccent.y) * 5.;
      float sheen = exp(-sheenDistance * sheenDistance);
      inscription += vec3(.55, .42, .2) * sheen * letteringAccent.x * .38;
      // The core emits light on press, independently of the dark metal's
      // diffuse lighting. A little bevel shading keeps the illuminated relief.
      vec3 emissionColor = mix(vec3(1., .95, .72), mix(vec3(1.), lightColor, .3), min(response, 1.));
      inscription = mix(inscription, emissionColor * (.83 + .17 * bevelLight), letteringLight);
      float rim = max(max(left, right), max(above, below)) * (1. - text.a);
      gold = mix(gold, vec3(.14, .085, .025), extrusion * (1. - text.a) * .9 * frontFace);
      gold = mix(gold, vec3(.32, .21, .07), rim * .65 * frontFace);
      gold += emissionColor * rim * letteringLight * .22 * frontFace;
      gold = mix(gold, inscription, text.a * frontFace);
      // Upper-left edge catches light, with a darker lower-right shoulder.
      float edge = (below - above + right - left) * .5;
      gold += vec3(.95, .77, .39) * max(edge, 0.) * .42 * text.a * frontFace;
      gold -= vec3(.12, .09, .035) * max(-edge, 0.) * text.a * frontFace;
      gold = mix(bareFace, gold, letteringOpacity);
      gl_FragColor = vec4(gold, 1.);
    }`;
    function shader(gl2, type, source) {
      const item = gl2.createShader(type);
      if (!item) throw new Error("Button shader allocation failed");
      try {
        gl2.shaderSource(item, source);
        gl2.compileShader(item);
        if (!gl2.getShaderParameter(item, gl2.COMPILE_STATUS))
          throw new Error("Button shader could not compile");
        return item;
      } catch (error) {
        gl2.deleteShader(item);
        throw error;
      }
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
      "holdLight",
      "powerLight",
      "readyLight",
      "responseColor",
      "letteringPose",
      "letteringAccent",
      "letteringLight",
      "letteringOpacity"
    ];
    let resources = null;
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
      for (let ring2 = 0; ring2 < rings.length - 1; ring2++) {
        const dz = rings[ring2].z - rings[ring2 + 1].z;
        const bevel = rings[ring2].inset - rings[ring2 + 1].inset;
        const length = Math.hypot(dz, bevel);
        const normal = (point) => [
          point.n[0] * dz / length,
          point.n[1] * dz / length,
          bevel / length
        ];
        const a = contours[ring2][i], b = contours[ring2 + 1][i];
        const c = contours[ring2 + 1][next], d = contours[ring2][next];
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
    let labelContext = null;
    const layers = [null, null];
    const lettering = required(".button-label", button);
    let atlasDirty = true;
    let paintedText = "";
    let paintedDirection = "ltr";
    function atlasLost() {
      return labelContext?.isContextLost?.() ?? false;
    }
    function paintAtlas() {
      labelContext ??= label.getContext("2d");
      if (!labelContext || atlasLost()) throw new Error("Button atlas canvas unavailable");
      if (label.width !== ATLAS_WIDTH) label.width = ATLAS_WIDTH;
      if (label.height !== ATLAS_HEIGHT) label.height = ATLAS_HEIGHT;
      labelContext.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
      labelContext.fillStyle = "#808080";
      labelContext.fillRect(0, 0, ATLAS_WIDTH, LAYER_HEIGHT);
      if (layers[0]) labelContext.drawImage(layers[0], 0, 0, ATLAS_WIDTH, LAYER_HEIGHT);
      if (layers[1]) labelContext.drawImage(layers[1], 0, LAYER_HEIGHT, ATLAS_WIDTH, LAYER_HEIGHT);
      paintedText = lettering.textContent;
      paintedDirection = lettering.dir === "rtl" ? "rtl" : "ltr";
      labelContext.direction = paintedDirection;
      labelContext.font = `700 ${LABEL_FONT_SIZE}px system-ui, sans-serif`;
      const width = labelContext.measureText(paintedText).width;
      if (width > LABEL_MAX_WIDTH)
        labelContext.font = `700 ${LABEL_FONT_SIZE * LABEL_MAX_WIDTH / width}px system-ui, sans-serif`;
      labelContext.textAlign = "center";
      labelContext.textBaseline = "middle";
      labelContext.fillStyle = "#fff";
      labelContext.fillText(paintedText, ATLAS_WIDTH / 2, LAYER_HEIGHT * 2.5 + 6);
      if (atlasLost()) throw new Error("Button atlas canvas was lost during painting");
      atlasDirty = false;
    }
    function initialize(gl2) {
      let program = null, vertex2 = null, fragment = null, buffer = null, texture = null;
      try {
        program = gl2.createProgram();
        if (!program) throw new Error("Button program allocation failed");
        vertex2 = shader(gl2, gl2.VERTEX_SHADER, vertexSource);
        fragment = shader(gl2, gl2.FRAGMENT_SHADER, fragmentSource);
        gl2.attachShader(program, vertex2);
        gl2.attachShader(program, fragment);
        gl2.linkProgram(program);
        if (!gl2.getProgramParameter(program, gl2.LINK_STATUS))
          throw new Error("Button renderer could not link");
        buffer = gl2.createBuffer();
        if (!buffer) throw new Error("Button buffer allocation failed");
        gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer);
        gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array(vertices), gl2.STATIC_DRAW);
        gl2.useProgram(program);
        for (const [name, size, offset] of [
          ["position", 3, 0],
          ["normal", 3, 3],
          ["uv", 2, 6],
          ["face", 1, 8]
        ]) {
          const location = gl2.getAttribLocation(program, name);
          if (location < 0) throw new Error("Button attribute unavailable");
          gl2.enableVertexAttribArray(location);
          gl2.vertexAttribPointer(location, size, gl2.FLOAT, false, 36, offset * 4);
        }
        const uniforms = Object.fromEntries(
          uniformNames.map((name) => [name, gl2.getUniformLocation(program, name)])
        );
        texture = gl2.createTexture();
        if (!texture) throw new Error("Button texture allocation failed");
        gl2.bindTexture(gl2.TEXTURE_2D, texture);
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, label);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR);
        gl2.uniform1i(uniforms.surfaceAtlas, 0);
        gl2.enable(gl2.DEPTH_TEST);
        gl2.enable(gl2.CULL_FACE);
        gl2.frontFace(gl2.CW);
        gl2.clearColor(0, 0, 0, 0);
        if (gl2.getError() !== gl2.NO_ERROR) throw new Error("Button graphics setup failed");
        return { program, buffer, texture, uniforms };
      } catch {
        if (program) {
          gl2.useProgram(null);
          gl2.deleteProgram(program);
        }
        if (buffer) gl2.deleteBuffer(buffer);
        if (texture) gl2.deleteTexture(texture);
        return null;
      } finally {
        if (vertex2) gl2.deleteShader(vertex2);
        if (fragment) gl2.deleteShader(fragment);
      }
    }
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
    let retryTimer = 0;
    let canRetry = false;
    let previousFrame;
    function cancelRetry() {
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = 0;
    }
    function visible2() {
      return !document.hidden && stage.clientWidth > 0 && stage.clientHeight > 0;
    }
    function resizeCanvas(width, height) {
      if (height < canvas.height) canvas.height = height;
      if (width !== canvas.width) canvas.width = width;
      if (height > canvas.height) canvas.height = height;
    }
    function suspend2() {
      cancelRetry();
      stage.classList.remove("is-rendered");
      if (gl && resources && !gl.isContextLost()) {
        gl.useProgram(null);
        gl.deleteProgram(resources.program);
        gl.deleteBuffer(resources.buffer);
        gl.deleteTexture(resources.texture);
      }
      resources = null;
      previousFrame = void 0;
      if (gl) resizeCanvas(1, 1);
      if (!atlasLost()) {
        if (label.width !== 1) label.width = 1;
        if (label.height !== 1) label.height = 1;
      }
    }
    function graphicsFailed() {
      suspend2();
      if (!canRetry || gl?.isContextLost() || atlasLost()) return;
      canRetry = false;
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        rebuild();
      }, GRAPHICS_RETRY_DELAY);
    }
    function resume() {
      cancelRetry();
      canRetry = true;
      rebuild();
    }
    function rebuild() {
      if (!visible2() || atlasLost() || gl?.isContextLost()) return;
      if (!resources) {
        try {
          gl ??= canvas.getContext("webgl", {
            alpha: true,
            antialias: true,
            premultipliedAlpha: true
          });
          if (!gl) throw new Error("Button WebGL context unavailable");
          paintAtlas();
          resources = initialize(gl);
          if (!resources) throw new Error("Button graphics initialization failed");
        } catch {
          graphicsFailed();
          return;
        }
      }
      draw();
    }
    function draw(next = state) {
      state = { ...next };
      if (!gl || !resources || !visible2()) return;
      try {
        if (gl.isContextLost()) {
          suspend2();
          return;
        }
        const direction = lettering.dir === "rtl" ? "rtl" : "ltr";
        if (atlasDirty || paintedText !== lettering.textContent || paintedDirection !== direction) {
          paintAtlas();
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, label);
          if (gl.getError() !== gl.NO_ERROR) throw new Error("Button atlas update failed");
        }
        if (!render(gl, resources.uniforms)) throw new Error("Button frame unavailable");
        stage.classList.add("is-rendered");
      } catch {
        graphicsFailed();
      }
    }
    function render(gl2, uniforms) {
      const root2 = document.documentElement;
      if (!root2.clientWidth || !root2.clientHeight) return false;
      const bounds = stage.getBoundingClientRect();
      const scene = projectButtonScene(
        state,
        button.offsetWidth,
        bounds,
        { width: root2.clientWidth, height: root2.clientHeight },
        previousFrame
      );
      previousFrame = scene.frame;
      canvas.style.left = `${scene.frame.left - bounds.left}px`;
      canvas.style.top = `${scene.frame.top - bounds.top}px`;
      canvas.style.width = `${scene.frame.width}px`;
      canvas.style.height = `${scene.frame.height}px`;
      const width = scene.frame.width, height = scene.frame.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
      const resized = canvas.width !== pixelWidth || canvas.height !== pixelHeight;
      if (resized) resizeCanvas(pixelWidth, pixelHeight);
      const { drawingBufferWidth, drawingBufferHeight } = gl2;
      if (!drawingBufferWidth || !drawingBufferHeight) return false;
      gl2.viewport(0, 0, drawingBufferWidth, drawingBufferHeight);
      gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
      rig.style.setProperty("--lift", `${scene.lift.toFixed(3)}px`);
      gl2.uniform2f(uniforms.viewport, width, height);
      gl2.uniform2f(uniforms.origin, scene.originX, scene.originY);
      gl2.uniform1f(uniforms.copper, Math.max(0, Math.min(1, state.copper)));
      gl2.uniform1f(uniforms.flash, state.flash || 0);
      gl2.uniform1f(uniforms.response, state.response || 0);
      gl2.uniform1f(uniforms.responseProgress, state.responseProgress || 0);
      gl2.uniform1f(uniforms.holdLight, state.holdLight ?? 0);
      gl2.uniform1f(uniforms.powerLight, (state.drainLight ?? 0) + (state.bootLight ?? 0));
      gl2.uniform1f(uniforms.readyLight, state.readyLight ?? 0);
      gl2.uniform3f(uniforms.responseColor, ...state.responseColor || [0.38, 0.84, 0.8]);
      const letterPose = projectButtonLettering(state);
      gl2.uniform4f(
        uniforms.letteringPose,
        letterPose.scaleX,
        letterPose.scaleY,
        letterPose.shiftY,
        letterPose.ink
      );
      gl2.uniform2f(uniforms.letteringAccent, letterPose.charge, letterPose.sheen);
      gl2.uniform1f(uniforms.letteringLight, letterPose.light);
      gl2.uniform1f(uniforms.letteringOpacity, state.labelOpacity ?? 1);
      gl2.uniformMatrix3fv(uniforms.rotation, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
      gl2.uniform3f(uniforms.translation, 0, 0, 0);
      gl2.uniform1f(uniforms.scale, 1);
      gl2.uniform1f(uniforms.shadow, 1);
      gl2.uniform1f(uniforms.recession, 0);
      gl2.uniform2f(uniforms.shadowCenter, scene.shadow.x, scene.shadow.y);
      gl2.uniform2f(uniforms.shadowSize, scene.shadow.halfWidth, scene.shadow.halfHeight);
      gl2.uniform1f(uniforms.shadowBlur, scene.shadow.blur);
      gl2.enable(gl2.BLEND);
      gl2.blendFuncSeparate(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA, gl2.ONE, gl2.ONE_MINUS_SRC_ALPHA);
      gl2.depthMask(false);
      gl2.drawArrays(gl2.TRIANGLES, solidCount, 6);
      gl2.depthMask(true);
      gl2.disable(gl2.BLEND);
      gl2.uniformMatrix3fv(uniforms.rotation, false, scene.rotation);
      gl2.uniform3f(uniforms.translation, scene.x, scene.y, scene.lift);
      gl2.uniform1f(uniforms.recession, scene.recession);
      gl2.uniform1f(uniforms.scale, scene.scale);
      gl2.uniform1f(uniforms.shadow, 0);
      gl2.drawArrays(gl2.TRIANGLES, 0, solidCount);
      return !gl2.isContextLost() && (!resized || gl2.getError() === gl2.NO_ERROR);
    }
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      suspend2();
    });
    canvas.addEventListener("webglcontextrestored", resume);
    label.addEventListener("contextrestored", () => {
      if (resources) return;
      if (visible2()) resume();
      else suspend2();
    });
    const sources = ["./button-material.svg", "./button-glow.svg"];
    for (const [index, source] of sources.entries()) {
      const image = new Image();
      image.onload = () => {
        layers[index] = image;
        atlasDirty = true;
        draw();
      };
      image.src = source;
    }
    window.addEventListener("scroll", () => draw(), { passive: true });
    return { draw, resume, suspend: suspend2 };
  }

  // frontend/sound.ts
  var motion = createSoundMotion();
  var profile = "classic";
  var enabled = false;
  var powered = true;
  var volume = 1;
  var reverb = true;
  var context = null;
  var output = null;
  var roomImpulse = null;
  var room = null;
  var previewRoom = null;
  var suspending = null;
  var pendingResumes = /* @__PURE__ */ new Set();
  var pendingCue = null;
  var voices = /* @__PURE__ */ new Set();
  var previewVoices = /* @__PURE__ */ new Set();
  var previewPending = false;
  var maxVoices = 8;
  var maxOutputGain = 0.085;
  var maxUnlockDelay = 150;
  var responseInterval = 80;
  var responseAt = -Infinity;
  var responseWasFailure = false;
  function cancelPending() {
    pendingCue = null;
    previewPending = false;
    for (const voice of previewVoices) removeVoice(voice, true);
    clearRoom(true);
  }
  function clearRoom(preview) {
    const convolver = preview ? previewRoom : room;
    if (preview) previewRoom = null;
    else room = null;
    try {
      convolver?.disconnect();
    } catch {
    }
  }
  function removeVoice(voice, stop2 = false) {
    voices.delete(voice);
    if (previewVoices.delete(voice) && previewVoices.size === 0) previewPending = false;
    voice.onended = null;
    if (stop2) {
      try {
        voice.stop();
      } catch {
      }
    }
    try {
      voice.disconnect();
    } catch {
    }
  }
  function clearVoices() {
    responseAt = -Infinity;
    responseWasFailure = false;
    for (const voice of voices) removeVoice(voice, true);
    clearRoom(false);
    clearRoom(true);
  }
  function stop() {
    cancelPending();
    clearVoices();
  }
  function discardContext() {
    stop();
    if (context) context.onstatechange = null;
    context = null;
    suspending = null;
    pendingResumes.clear();
    try {
      output?.disconnect();
    } catch {
    }
    output = null;
    roomImpulse = null;
  }
  function suspend() {
    stop();
    if (!context || context.state === "closed" || suspending) return;
    try {
      const pending2 = context.suspend();
      suspending = pending2;
      const settled = () => {
        if (suspending === pending2) suspending = null;
      };
      void pending2.then(settled, settled);
    } catch {
    }
  }
  function requestResume(audio, source) {
    if (pendingResumes.has(source)) return;
    const request2 = audio.resume();
    pendingResumes.add(source);
    function settled(resumed) {
      if (audio !== context) return;
      pendingResumes.delete(source);
      if (!resumed || audio.state !== "running") {
        if (!pendingResumes.size) pendingCue = null;
        return;
      }
      if (!enabled || document.hidden) {
        suspend();
        return;
      }
      const cue = pendingCue;
      pendingCue = null;
      if (cue && performance.now() - cue.requestedAt <= maxUnlockDelay) cue.emit(audio);
    }
    void request2.then(
      () => settled(true),
      () => settled(false)
    ).catch(() => {
    });
  }
  function synthesize(audio, kind, preview = false, when) {
    const variation = motion.sample(performance.now(), kind === "press");
    return startVoice(audio, renderSound(profile, kind, audio.sampleRate, variation), preview, when);
  }
  function connectRoom(audio, voice, preview) {
    if (!reverb) return;
    try {
      let convolver = preview ? previewRoom : room;
      if (!convolver) {
        convolver = audio.createConvolver();
        if (!roomImpulse) {
          const samples = renderRoomImpulse(audio.sampleRate);
          roomImpulse = audio.createBuffer(1, samples.length, audio.sampleRate);
          roomImpulse.getChannelData(0).set(samples);
        }
        convolver.normalize = false;
        convolver.buffer = roomImpulse;
        convolver.connect(output);
        if (preview) previewRoom = convolver;
        else room = convolver;
      }
      voice.connect(convolver);
    } catch {
    }
  }
  function startVoice(audio, samples, preview = false, when) {
    const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(samples);
    if (voices.size >= maxVoices) {
      const oldest = voices.values().next().value;
      removeVoice(oldest, true);
    }
    const voice = audio.createBufferSource();
    try {
      voice.buffer = buffer;
      voice.connect(output);
      connectRoom(audio, voice, preview);
      voice.onended = () => removeVoice(voice);
      voices.add(voice);
      if (preview) previewVoices.add(voice);
      const start = when ?? audio.currentTime;
      voice.start(start);
      return start;
    } catch (error) {
      removeVoice(voice, true);
      throw error;
    }
  }
  function audioContext(allowCreate) {
    if (context?.state === "closed") discardContext();
    if (!context) {
      if (!allowCreate || typeof window.AudioContext !== "function") return null;
      const next = new window.AudioContext({ latencyHint: "interactive" });
      try {
        const gain = next.createGain();
        gain.gain.value = maxOutputGain * volume;
        gain.connect(next.destination);
        output = gain;
        context = next;
        next.onstatechange = () => {
          if (context !== next) return;
          if (next.state === "closed") discardContext();
          else if (next.state !== "running") {
            clearVoices();
          } else if (!enabled || document.hidden) suspend();
        };
      } catch (error) {
        void next.close().catch(() => {
        });
        throw error;
      }
    }
    return context;
  }
  function prepare() {
    if (!enabled || document.hidden) return;
    try {
      const audio = audioContext(true);
      if (audio && (audio.state !== "running" || suspending)) requestResume(audio, "prepare");
    } catch {
    }
  }
  function withAudio(gesture, emit, {
    preview = false,
    allowCreate = gesture,
    source = gesture ? "gesture" : "boot"
  } = {}) {
    if (!enabled || document.hidden) return;
    try {
      const audio = audioContext(allowCreate);
      if (!audio) return;
      if (gesture) {
        cancelPending();
        previewPending = preview;
      }
      if (audio.state === "running" && !suspending) emit(audio);
      else if (allowCreate) {
        pendingCue = { emit, requestedAt: performance.now() };
        requestResume(audio, source);
      }
    } catch {
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
  });
  var clickSound = {
    play(kind) {
      if (!powered) return;
      if (kind === "hold") {
        withAudio(false, (audio) => synthesize(audio, kind));
        return;
      }
      const physical = kind === "press" || kind === "release";
      withAudio(
        physical,
        (audio) => {
          const now = performance.now();
          const failure = kind === "error" || kind === "limited";
          if (!physical && now - responseAt < responseInterval && (!failure || responseWasFailure))
            return;
          synthesize(audio, kind);
          if (!physical) {
            responseAt = now;
            responseWasFailure = failure;
          }
        },
        { source: kind === "press" ? "press" : "gesture" }
      );
    },
    setPowered(value) {
      powered = value;
      if (!powered) stop();
    },
    hardware(kind, { gesture = false, bootDelay } = {}) {
      withAudio(
        gesture,
        (audio) => {
          const start = startVoice(audio, renderHardwareSound(kind, audio.sampleRate));
          if (bootDelay !== void 0)
            startVoice(
              audio,
              renderHardwareSound("boot", audio.sampleRate),
              false,
              start + bootDelay / 1e3
            );
        },
        { allowCreate: gesture || kind === "boot" }
      );
    },
    preview() {
      stop();
      withAudio(
        true,
        (audio) => {
          const start = synthesize(audio, "press", true);
          const release2 = start + 0.06;
          synthesize(audio, "release", true, release2);
          synthesize(audio, "saved", true, release2 + typicalSaveDelayMs / 1e3);
        },
        { preview: true }
      );
    },
    cancelPreview() {
      if (previewPending) cancelPending();
      else clearRoom(true);
    },
    setProfile(value) {
      if (profile === value) return;
      stop();
      profile = value;
    },
    setVolume(value) {
      if (volume === value) return;
      volume = value;
      if (output && context && context.state !== "closed")
        output.gain.setTargetAtTime(maxOutputGain * volume, context.currentTime, 0.01);
    },
    setReverb(value) {
      if (reverb === value) return;
      reverb = value;
      if (!reverb) {
        clearRoom(false);
        clearRoom(true);
      }
    },
    prepare,
    cancelPending,
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value;
      if (!enabled) suspend();
    }
  };

  // frontend/option-messages.ts
  var englishOptions = {
    preferencesStored: "Saved in this browser.",
    soundHeading: "Sound",
    volume: "Volume",
    roomReverb: "Room reverb",
    soundProfile: "Sound profile",
    previewSound: "Preview sound",
    appearance: "Appearance",
    motionSetting: "Motion",
    motionAuto: "Auto \xB7 Follow browser",
    motionReduced: "Reduced \xB7 No motion or flashes",
    motionFull: "Full \xB7 Animations and effects",
    offlinePlayHeading: "Offline play",
    offlineCachePreparing: "Preparing offline access\u2026",
    offlineCacheReady: "Ready to reopen offline.",
    offlineCacheUnavailable: "Offline reopening is unavailable. Keep this tab open to play offline.",
    playOffline: "Play offline",
    playOnline: "Play online",
    playOnlineHint: "Leaves GitHub Pages and opens clicker.bluehexagons.com.",
    downloadSave: "Download save",
    simulatedPingLabel: "Simulated ping",
    simulatedPingHint: "Delays offline feedback. Clicks are saved immediately.",
    instant: "Instant",
    approximatePing: "Around {time}",
    replaceLocal: "Replace local save",
    allowReplaceLocal: "Allow replacing my local save",
    importSave: "Import save",
    restartSave: "Restart save",
    copyAccount: "Copy account progress",
    copyAccountHint: "Open your account counter to make its progress available to copy.",
    copyAccountNote: "Replace the local save with the latest loaded progress for {name}.",
    localSaveCount: "Clicks in your local save: {count}",
    localSaveUnavailable: "Local save unavailable.",
    controlsTitle: "Controls",
    technicalNotes: "Game & storage notes (English)",
    sourceCode: "Source code",
    settingsVisit: "Applied for this visit. Browser storage is unavailable.",
    openLocalFailed: "Couldn\u2019t open the local save.",
    backOnlineVisit: "Back online for this visit. Browser storage is unavailable.",
    replaceConsent: "Check \u201CAllow replacing my local save\u201D first.",
    waitPending: "Wait for pending clicks to finish, then try again.",
    replacingLocal: "Replacing the local save\u2026",
    localReplacedFailed: "Local save was not replaced.",
    localRestarted: "Local save restarted.",
    accountCopied: "Account progress copied to the local save.",
    saveTooLarge: "Choose a local save no larger than 1 MiB.",
    localImported: "Local save imported.",
    importFailed: "Couldn\u2019t import this local save.",
    localDownloaded: "Local save downloaded.",
    downloadFailed: "Couldn\u2019t download the local save.",
    profileClassic: "Classic",
    profileClassicDescription: "A metal switch with a low press and a lighter return.",
    profileBlip: "Blip",
    profileBlipDescription: "Short electronic tones that rise in pitch.",
    profileClack: "Clack",
    profileClackDescription: "A short, dry key click.",
    profileClunk: "Clunk",
    profileClunkDescription: "A low, muffled thud.",
    profileLowBeep: "Low beep",
    profileLowBeepDescription: "A low tone with a soft attack.",
    profileSoftChime: "Soft chime",
    profileSoftChimeDescription: "A soft chime with a short decay."
  };
  var optionsTranslations = {
    "zh-Hans": {
      preferencesStored: "\u4FDD\u5B58\u5728\u6B64\u6D4F\u89C8\u5668\u4E2D\u3002",
      soundHeading: "\u58F0\u97F3",
      volume: "\u97F3\u91CF",
      roomReverb: "\u623F\u95F4\u6DF7\u54CD",
      soundProfile: "\u97F3\u6548\u98CE\u683C",
      previewSound: "\u8BD5\u542C",
      appearance: "\u5916\u89C2",
      motionSetting: "\u52A8\u6548",
      motionAuto: "\u81EA\u52A8 \xB7 \u8DDF\u968F\u6D4F\u89C8\u5668\u8BBE\u7F6E",
      motionReduced: "\u51CF\u5C11 \xB7 \u5173\u95ED\u52A8\u6548\u548C\u95EA\u70C1",
      motionFull: "\u5B8C\u6574 \xB7 \u542F\u7528\u52A8\u753B\u548C\u7279\u6548",
      offlinePlayHeading: "\u79BB\u7EBF\u6E38\u73A9",
      offlineCachePreparing: "\u6B63\u5728\u51C6\u5907\u79BB\u7EBF\u8BBF\u95EE\u2026",
      offlineCacheReady: "\u73B0\u5728\u53EF\u4EE5\u79BB\u7EBF\u91CD\u65B0\u6253\u5F00\u6E38\u620F\u3002",
      offlineCacheUnavailable: "\u6682\u65F6\u65E0\u6CD5\u79BB\u7EBF\u91CD\u65B0\u6253\u5F00\u6E38\u620F\u3002\u8BF7\u4FDD\u6301\u6B64\u6807\u7B7E\u9875\u5F00\u542F\uFF0C\u4EE5\u4FBF\u79BB\u7EBF\u6E38\u73A9\u3002",
      playOffline: "\u79BB\u7EBF\u6E38\u73A9",
      playOnline: "\u5728\u7EBF\u6E38\u73A9",
      playOnlineHint: "\u79BB\u5F00 GitHub Pages \u5E76\u6253\u5F00 clicker.bluehexagons.com\u3002",
      downloadSave: "\u4E0B\u8F7D\u5B58\u6863",
      simulatedPingLabel: "\u6A21\u62DF\u5EF6\u8FDF",
      simulatedPingHint: "\u53EA\u5EF6\u8FDF\u79BB\u7EBF\u53CD\u9988\u3002\u70B9\u51FB\u4F1A\u7ACB\u5373\u4FDD\u5B58\u3002",
      instant: "\u5373\u65F6",
      approximatePing: "\u7EA6 {time}",
      replaceLocal: "\u66FF\u6362\u672C\u5730\u5B58\u6863",
      allowReplaceLocal: "\u5141\u8BB8\u66FF\u6362\u6211\u7684\u672C\u5730\u5B58\u6863",
      importSave: "\u5BFC\u5165\u5B58\u6863",
      restartSave: "\u91CD\u7F6E\u5B58\u6863",
      copyAccount: "\u590D\u5236\u8D26\u6237\u8FDB\u5EA6",
      copyAccountHint: "\u6253\u5F00\u8D26\u6237\u8BA1\u6570\u5668\u540E\u5373\u53EF\u590D\u5236\u8FDB\u5EA6\u3002",
      copyAccountNote: "\u7528\u6700\u8FD1\u52A0\u8F7D\u7684 {name} \u7684\u8FDB\u5EA6\u66FF\u6362\u672C\u5730\u5B58\u6863\u3002",
      localSaveCount: "\u672C\u5730\u5B58\u6863\u7684\u70B9\u51FB\u6570\uFF1A{count}",
      localSaveUnavailable: "\u672C\u5730\u5B58\u6863\u4E0D\u53EF\u7528\u3002",
      controlsTitle: "\u64CD\u4F5C\u8BF4\u660E",
      technicalNotes: "\u6E38\u620F\u548C\u5B58\u6863\u8BF4\u660E\uFF08\u82F1\u8BED\uFF09",
      sourceCode: "\u6E90\u4EE3\u7801",
      settingsVisit: "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\u3002\u8BBE\u7F6E\u4EC5\u5728\u672C\u6B21\u8BBF\u95EE\u4E2D\u751F\u6548\u3002",
      openLocalFailed: "\u65E0\u6CD5\u6253\u5F00\u672C\u5730\u5B58\u6863\u3002",
      backOnlineVisit: "\u5DF2\u8FD4\u56DE\u5728\u7EBF\u6A21\u5F0F\u3002\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u6B64\u8BBE\u7F6E\u4EC5\u5728\u672C\u6B21\u8BBF\u95EE\u4E2D\u751F\u6548\u3002",
      replaceConsent: "\u8BF7\u5148\u52FE\u9009\u300C\u5141\u8BB8\u66FF\u6362\u6211\u7684\u672C\u5730\u5B58\u6863\u300D\u3002",
      waitPending: "\u8BF7\u7B49\u5F85\u70B9\u51FB\u5904\u7406\u5B8C\u6BD5\uFF0C\u518D\u8BD5\u4E00\u6B21\u3002",
      replacingLocal: "\u6B63\u5728\u66FF\u6362\u672C\u5730\u5B58\u6863\u2026",
      localReplacedFailed: "\u672A\u80FD\u66FF\u6362\u672C\u5730\u5B58\u6863\u3002",
      localRestarted: "\u5DF2\u91CD\u7F6E\u672C\u5730\u5B58\u6863\u3002",
      accountCopied: "\u5DF2\u5C06\u8D26\u6237\u8FDB\u5EA6\u590D\u5236\u5230\u672C\u5730\u5B58\u6863\u3002",
      saveTooLarge: "\u8BF7\u9009\u62E9\u4E0D\u8D85\u8FC7 1 MiB \u7684\u672C\u5730\u5B58\u6863\u3002",
      localImported: "\u5DF2\u5BFC\u5165\u672C\u5730\u5B58\u6863\u3002",
      importFailed: "\u65E0\u6CD5\u5BFC\u5165\u6B64\u672C\u5730\u5B58\u6863\u3002",
      localDownloaded: "\u5DF2\u4E0B\u8F7D\u672C\u5730\u5B58\u6863\u3002",
      downloadFailed: "\u65E0\u6CD5\u4E0B\u8F7D\u672C\u5730\u5B58\u6863\u3002",
      profileClassic: "\u7ECF\u5178",
      profileClassicDescription: "\u91D1\u5C5E\u5F00\u5173\u7684\u6309\u538B\u58F0\u4F4E\u6C89\uFF0C\u56DE\u5F39\u58F0\u8F7B\u4E00\u4E9B\u3002",
      profileBlip: "\u7535\u5B50\u77ED\u97F3",
      profileBlipDescription: "\u97F3\u9AD8\u4E0A\u626C\u7684\u77ED\u4FC3\u7535\u5B50\u97F3\u3002",
      profileClack: "\u6E05\u8106",
      profileClackDescription: "\u77ED\u4FC3\u3001\u5E72\u8106\u7684\u6309\u952E\u58F0\u3002",
      profileClunk: "\u95F7\u54CD",
      profileClunkDescription: "\u4F4E\u6C89\u7684\u649E\u51FB\u58F0\u3002",
      profileLowBeep: "\u4F4E\u97F3\u63D0\u793A",
      profileLowBeepDescription: "\u8D77\u97F3\u67D4\u548C\u7684\u4F4E\u97F3\u3002",
      profileSoftChime: "\u8F7B\u67D4\u94C3\u97F3",
      profileSoftChimeDescription: "\u5F88\u5FEB\u6D88\u6563\u7684\u8F7B\u67D4\u94C3\u97F3\u3002"
    },
    "zh-Hant": {
      preferencesStored: "\u5132\u5B58\u5728\u9019\u500B\u700F\u89BD\u5668\u4E2D\u3002",
      soundHeading: "\u8072\u97F3",
      volume: "\u97F3\u91CF",
      roomReverb: "\u5BA4\u5167\u6B98\u97FF",
      soundProfile: "\u97F3\u6548\u98A8\u683C",
      previewSound: "\u8A66\u807D",
      appearance: "\u5916\u89C0",
      motionSetting: "\u52D5\u614B\u6548\u679C",
      motionAuto: "\u81EA\u52D5 \xB7 \u4F9D\u700F\u89BD\u5668\u8A2D\u5B9A",
      motionReduced: "\u6E1B\u5C11 \xB7 \u95DC\u9589\u52D5\u756B\u548C\u9583\u720D",
      motionFull: "\u5B8C\u6574 \xB7 \u958B\u555F\u52D5\u756B\u548C\u7279\u6548",
      offlinePlayHeading: "\u96E2\u7DDA\u904A\u73A9",
      offlineCachePreparing: "\u6B63\u5728\u6E96\u5099\u96E2\u7DDA\u5B58\u53D6\u2026",
      offlineCacheReady: "\u73FE\u5728\u53EF\u4EE5\u96E2\u7DDA\u91CD\u65B0\u958B\u555F\u904A\u6232\u3002",
      offlineCacheUnavailable: "\u76EE\u524D\u7121\u6CD5\u96E2\u7DDA\u91CD\u65B0\u958B\u555F\u904A\u6232\u3002\u8ACB\u4FDD\u6301\u6B64\u5206\u9801\u958B\u555F\uFF0C\u4EE5\u4FBF\u96E2\u7DDA\u904A\u73A9\u3002",
      playOffline: "\u96E2\u7DDA\u904A\u73A9",
      playOnline: "\u7DDA\u4E0A\u904A\u73A9",
      playOnlineHint: "\u96E2\u958B GitHub Pages \u4E26\u958B\u555F clicker.bluehexagons.com\u3002",
      downloadSave: "\u4E0B\u8F09\u5B58\u6A94",
      simulatedPingLabel: "\u6A21\u64EC\u5EF6\u9072",
      simulatedPingHint: "\u5EF6\u9072\u96E2\u7DDA\u904A\u73A9\u7684\u56DE\u994B\u3002\u9EDE\u64CA\u4ECD\u6703\u7ACB\u5373\u5132\u5B58\u3002",
      instant: "\u7121\u5EF6\u9072",
      approximatePing: "\u7D04 {time}",
      replaceLocal: "\u53D6\u4EE3\u672C\u6A5F\u5B58\u6A94",
      allowReplaceLocal: "\u5141\u8A31\u53D6\u4EE3\u6211\u7684\u672C\u6A5F\u5B58\u6A94",
      importSave: "\u532F\u5165\u5B58\u6A94",
      restartSave: "\u91CD\u8A2D\u5B58\u6A94",
      copyAccount: "\u8907\u88FD\u5E33\u865F\u9032\u5EA6",
      copyAccountHint: "\u5148\u958B\u555F\u5E33\u865F\u8A08\u6578\u9801\u9762\uFF0C\u5C31\u80FD\u8907\u88FD\u9032\u5EA6\u3002",
      copyAccountNote: "\u7528\u6700\u8FD1\u8F09\u5165\u7684 {name} \u7684\u9032\u5EA6\u53D6\u4EE3\u672C\u6A5F\u5B58\u6A94\u3002",
      localSaveCount: "\u672C\u6A5F\u5B58\u6A94\u7684\u9EDE\u64CA\u6578\uFF1A{count}",
      localSaveUnavailable: "\u7121\u6CD5\u8B80\u53D6\u672C\u6A5F\u5B58\u6A94\u3002",
      controlsTitle: "\u64CD\u4F5C\u8AAA\u660E",
      technicalNotes: "\u904A\u6232\u548C\u5B58\u6A94\u8AAA\u660E\uFF08\u82F1\u6587\uFF09",
      sourceCode: "\u539F\u59CB\u78BC",
      settingsVisit: "\u700F\u89BD\u5668\u7121\u6CD5\u5132\u5B58\uFF0C\u8A2D\u5B9A\u50C5\u672C\u6B21\u4F7F\u7528\u6709\u6548\u3002",
      openLocalFailed: "\u7121\u6CD5\u958B\u555F\u672C\u6A5F\u5B58\u6A94\u3002",
      backOnlineVisit: "\u5DF2\u8FD4\u56DE\u7DDA\u4E0A\u6A21\u5F0F\u3002\u700F\u89BD\u5668\u7121\u6CD5\u5132\u5B58\uFF0C\u9019\u500B\u6A21\u5F0F\u50C5\u672C\u6B21\u4F7F\u7528\u6709\u6548\u3002",
      replaceConsent: "\u8ACB\u5148\u52FE\u9078\u300C\u5141\u8A31\u53D6\u4EE3\u6211\u7684\u672C\u6A5F\u5B58\u6A94\u300D\u3002",
      waitPending: "\u8ACB\u7B49\u5019\u9EDE\u64CA\u8655\u7406\u5B8C\u7562\uFF0C\u518D\u8A66\u4E00\u6B21\u3002",
      replacingLocal: "\u6B63\u5728\u53D6\u4EE3\u672C\u6A5F\u5B58\u6A94\u2026",
      localReplacedFailed: "\u672A\u80FD\u53D6\u4EE3\u672C\u6A5F\u5B58\u6A94\u3002",
      localRestarted: "\u5DF2\u91CD\u8A2D\u672C\u6A5F\u5B58\u6A94\u3002",
      accountCopied: "\u5DF2\u5C07\u5E33\u865F\u9032\u5EA6\u8907\u88FD\u5230\u672C\u6A5F\u5B58\u6A94\u3002",
      saveTooLarge: "\u8ACB\u9078\u64C7\u4E0D\u8D85\u904E 1 MiB \u7684\u672C\u6A5F\u5B58\u6A94\u3002",
      localImported: "\u5DF2\u532F\u5165\u672C\u6A5F\u5B58\u6A94\u3002",
      importFailed: "\u7121\u6CD5\u532F\u5165\u9019\u500B\u672C\u6A5F\u5B58\u6A94\u3002",
      localDownloaded: "\u5DF2\u4E0B\u8F09\u672C\u6A5F\u5B58\u6A94\u3002",
      downloadFailed: "\u7121\u6CD5\u4E0B\u8F09\u672C\u6A5F\u5B58\u6A94\u3002",
      profileClassic: "\u7D93\u5178",
      profileClassicDescription: "\u91D1\u5C6C\u958B\u95DC\u7684\u6309\u58D3\u8072\u4F4E\u6C89\uFF0C\u56DE\u5F48\u8072\u8F03\u8F15\u3002",
      profileBlip: "\u96FB\u5B50\u77ED\u97F3",
      profileBlipDescription: "\u77ED\u4FC3\u3001\u97F3\u9AD8\u4E0A\u63DA\u7684\u96FB\u5B50\u97F3\u3002",
      profileClack: "\u6E05\u8106",
      profileClackDescription: "\u77ED\u4FC3\u4FD0\u843D\u7684\u6309\u9375\u8072\u3002",
      profileClunk: "\u60B6\u97FF",
      profileClunkDescription: "\u4F4E\u6C89\u7684\u649E\u64CA\u8072\u3002",
      profileLowBeep: "\u4F4E\u97F3\u63D0\u793A",
      profileLowBeepDescription: "\u8D77\u97F3\u67D4\u548C\u7684\u4F4E\u97F3\u3002",
      profileSoftChime: "\u8F15\u67D4\u9234\u8072",
      profileSoftChimeDescription: "\u5F88\u5FEB\u6D88\u6563\u7684\u8F15\u67D4\u9234\u8072\u3002"
    },
    bn: {
      preferencesStored: "\u098F\u0987 \u09AC\u09CD\u09B0\u09BE\u0989\u099C\u09BE\u09B0\u09C7 \u09B8\u09C7\u09AD \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u0964",
      soundHeading: "\u09B8\u09BE\u0989\u09A8\u09CD\u09A1",
      volume: "\u09AD\u09B2\u09BF\u0989\u09AE",
      roomReverb: "\u0998\u09B0\u09C7\u09B0 \u09AA\u09CD\u09B0\u09A4\u09BF\u09A7\u09CD\u09AC\u09A8\u09BF",
      soundProfile: "\u09B8\u09BE\u0989\u09A8\u09CD\u09A1\u09C7\u09B0 \u09A7\u09B0\u09A8",
      previewSound: "\u09B6\u09C1\u09A8\u09C7 \u09A6\u09C7\u0996\u09C1\u09A8",
      appearance: "\u09A6\u09C7\u0996\u09BE\u09A8\u09CB\u09B0 \u09A7\u09B0\u09A8",
      motionSetting: "\u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u09B6\u09A8",
      motionAuto: "\u0985\u099F\u09CB \xB7 \u09AC\u09CD\u09B0\u09BE\u0989\u099C\u09BE\u09B0\u09C7\u09B0 \u09B8\u09C7\u099F\u09BF\u0982 \u0985\u09A8\u09C1\u09AF\u09BE\u09AF\u09BC\u09C0",
      motionReduced: "\u0995\u09AE \xB7 \u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u09B6\u09A8 \u0993 \u099D\u09B2\u0995 \u09AC\u09A8\u09CD\u09A7",
      motionFull: "\u09AA\u09C2\u09B0\u09CD\u09A3 \xB7 \u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u09B6\u09A8 \u0993 \u0987\u09AB\u09C7\u0995\u09CD\u099F \u099A\u09BE\u09B2\u09C1",
      offlinePlayHeading: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0996\u09C7\u09B2\u09BE",
      offlineCachePreparing: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0996\u09CB\u09B2\u09BE\u09B0 \u09AA\u09CD\u09B0\u09B8\u09CD\u09A4\u09C1\u09A4\u09BF \u099A\u09B2\u099B\u09C7\u2026",
      offlineCacheReady: "\u098F\u0996\u09A8 \u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0997\u09C7\u09AE\u099F\u09BF \u0986\u09AC\u09BE\u09B0 \u0996\u09C1\u09B2\u09A4\u09C7 \u09AA\u09BE\u09B0\u09AC\u09C7\u09A8\u0964",
      offlineCacheUnavailable: "\u0997\u09C7\u09AE\u099F\u09BF \u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0986\u09AC\u09BE\u09B0 \u0996\u09CB\u09B2\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964 \u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0996\u09C7\u09B2\u09A4\u09C7 \u098F\u0987 \u099F\u09CD\u09AF\u09BE\u09AC\u099F\u09BF \u0996\u09CB\u09B2\u09BE \u09B0\u09BE\u0996\u09C1\u09A8\u0964",
      playOffline: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0996\u09C7\u09B2\u09C1\u09A8",
      playOnline: "\u0985\u09A8\u09B2\u09BE\u0987\u09A8\u09C7 \u0996\u09C7\u09B2\u09C1\u09A8",
      playOnlineHint: "GitHub Pages \u099B\u09C7\u09A1\u09BC\u09C7 clicker.bluehexagons.com \u0996\u09C1\u09B2\u09AC\u09C7\u0964",
      downloadSave: "\u09B8\u09C7\u09AD \u09A1\u09BE\u0989\u09A8\u09B2\u09CB\u09A1 \u0995\u09B0\u09C1\u09A8",
      simulatedPingLabel: "\u09B8\u09BF\u09AE\u09C1\u09B2\u09C7\u099F\u09C7\u09A1 \u09AA\u09BF\u0982",
      simulatedPingHint: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0995\u09CD\u09B2\u09BF\u0995\u09C7\u09B0 \u09B8\u09BE\u09A1\u09BC\u09BE \u09A6\u09C7\u0996\u09BE\u09A4\u09C7 \u09A6\u09C7\u09B0\u09BF \u09B9\u09AF\u09BC\u0964 \u0995\u09CD\u09B2\u09BF\u0995 \u09B8\u0999\u09CD\u0997\u09C7 \u09B8\u0999\u09CD\u0997\u09C7\u0987 \u09B8\u09C7\u09AD \u09B9\u09AF\u09BC\u0964",
      instant: "\u09B8\u0999\u09CD\u0997\u09C7 \u09B8\u0999\u09CD\u0997\u09C7",
      approximatePing: "\u09AA\u09CD\u09B0\u09BE\u09AF\u09BC {time}",
      replaceLocal: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AC\u09A6\u09B2\u09BE\u09A8",
      allowReplaceLocal: "\u0986\u09AE\u09BE\u09B0 \u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AC\u09A6\u09B2\u09BE\u09A8\u09CB\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A6\u09BF\u09A8",
      importSave: "\u09B8\u09C7\u09AD \u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F \u0995\u09B0\u09C1\u09A8",
      restartSave: "\u09B8\u09C7\u09AD \u09A8\u09A4\u09C1\u09A8 \u0995\u09B0\u09C7 \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09C1\u09A8",
      copyAccount: "\u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09B0 \u0985\u0997\u09CD\u09B0\u0997\u09A4\u09BF \u0995\u09AA\u09BF \u0995\u09B0\u09C1\u09A8",
      copyAccountHint: "\u0985\u0997\u09CD\u09B0\u0997\u09A4\u09BF \u0995\u09AA\u09BF \u0995\u09B0\u09A4\u09C7 \u09AA\u09CD\u09B0\u09A5\u09AE\u09C7 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09B0 \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u0996\u09C1\u09B2\u09C1\u09A8\u0964",
      copyAccountNote: "{name}-\u098F\u09B0 \u09B8\u09B0\u09CD\u09AC\u09B6\u09C7\u09B7 \u09B2\u09CB\u09A1 \u0995\u09B0\u09BE \u0985\u0997\u09CD\u09B0\u0997\u09A4\u09BF \u09A6\u09BF\u09AF\u09BC\u09C7 \u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AC\u09A6\u09B2\u09BE\u09A8\u0964",
      localSaveCount: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD\u09C7 \u0995\u09CD\u09B2\u09BF\u0995: {count}",
      localSaveUnavailable: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u099A\u09CD\u099B\u09C7 \u09A8\u09BE\u0964",
      controlsTitle: "\u09A8\u09BF\u09AF\u09BC\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3",
      technicalNotes: "\u0997\u09C7\u09AE \u0993 \u09B8\u09CD\u099F\u09CB\u09B0\u09C7\u099C\u09C7\u09B0 \u09A8\u09CB\u099F (\u0987\u0982\u09B0\u09C7\u099C\u09BF\u09A4\u09C7)",
      sourceCode: "\u09B8\u09CB\u09B0\u09CD\u09B8 \u0995\u09CB\u09A1",
      settingsVisit: "\u098F\u09AC\u09BE\u09B0 \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u0997 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u09AC\u09CD\u09B0\u09BE\u0989\u099C\u09BE\u09B0\u09C7 \u09B8\u09C7\u09AD \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
      openLocalFailed: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u0996\u09CB\u09B2\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
      backOnlineVisit: "\u098F\u09AC\u09BE\u09B0 \u0985\u09A8\u09B2\u09BE\u0987\u09A8\u09C7 \u09AB\u09C7\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u09AC\u09CD\u09B0\u09BE\u0989\u099C\u09BE\u09B0\u09C7 \u098F\u0987 \u09AA\u099B\u09A8\u09CD\u09A6 \u09B8\u09C7\u09AD \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
      replaceConsent: "\u0986\u0997\u09C7 \u201C\u0986\u09AE\u09BE\u09B0 \u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AC\u09A6\u09B2\u09BE\u09A8\u09CB\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A6\u09BF\u09A8\u201D \u0998\u09B0\u09C7 \u099F\u09BF\u0995 \u09A6\u09BF\u09A8\u0964",
      waitPending: "\u0985\u09AA\u09C7\u0995\u09CD\u09B7\u09BE\u09AF\u09BC \u09A5\u09BE\u0995\u09BE \u0995\u09CD\u09B2\u09BF\u0995\u0997\u09C1\u09B2\u09CB\u09B0 \u0995\u09BE\u099C \u09B6\u09C7\u09B7 \u09B9\u09B2\u09C7 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964",
      replacingLocal: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AC\u09A6\u09B2\u09BE\u09A8\u09CB \u09B9\u099A\u09CD\u099B\u09C7\u2026",
      localReplacedFailed: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AC\u09A6\u09B2\u09BE\u09A8\u09CB \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
      localRestarted: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09A8\u09A4\u09C1\u09A8 \u0995\u09B0\u09C7 \u09B6\u09C1\u09B0\u09C1 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      accountCopied: "\u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09B0 \u0985\u0997\u09CD\u09B0\u0997\u09A4\u09BF \u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD\u09C7 \u0995\u09AA\u09BF \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      saveTooLarge: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09AB\u09BE\u0987\u09B2\u09C7\u09B0 \u0986\u0995\u09BE\u09B0 \u09B8\u09B0\u09CD\u09AC\u09CB\u099A\u09CD\u099A \u09E7 MiB \u09B9\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u0964",
      localImported: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      importFailed: "\u098F\u0987 \u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD\u099F\u09BF \u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
      localDownloaded: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09A1\u09BE\u0989\u09A8\u09B2\u09CB\u09A1 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      downloadFailed: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09A1\u09BE\u0989\u09A8\u09B2\u09CB\u09A1 \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
      profileClassic: "\u0995\u09CD\u09B2\u09BE\u09B8\u09BF\u0995",
      profileClassicDescription: "\u09A7\u09BE\u09A4\u09AC \u09B8\u09C1\u0987\u099A \u099A\u09BE\u09AA\u09B2\u09C7 \u0997\u09AE\u09CD\u09AD\u09C0\u09B0 \u0986\u09B0 \u099B\u09BE\u09A1\u09BC\u09B2\u09C7 \u09B9\u09BE\u09B2\u0995\u09BE \u09B6\u09AC\u09CD\u09A6 \u09B9\u09AF\u09BC\u0964",
      profileBlip: "\u0987\u09B2\u09C7\u0995\u099F\u09CD\u09B0\u09A8\u09BF\u0995 \u099F\u09CB\u09A8",
      profileBlipDescription: "\u0985\u09B2\u09CD\u09AA \u09B8\u09AE\u09AF\u09BC\u09C7\u09B0 \u0987\u09B2\u09C7\u0995\u099F\u09CD\u09B0\u09A8\u09BF\u0995 \u09B6\u09AC\u09CD\u09A6, \u09AF\u09BE\u09B0 \u09B8\u09C1\u09B0 \u0993\u09AA\u09B0\u09C7 \u0993\u09A0\u09C7\u0964",
      profileClack: "\u0996\u099F",
      profileClackDescription: "\u09AC\u09CB\u09A4\u09BE\u09AE \u099A\u09BE\u09AA\u09BE\u09B0 \u099B\u09CB\u099F, \u09B8\u09CD\u09AA\u09B7\u09CD\u099F \u0996\u099F \u09B6\u09AC\u09CD\u09A6\u0964",
      profileClunk: "\u09A7\u09AA",
      profileClunkDescription: "\u09A8\u09BF\u099A\u09C1, \u099A\u09BE\u09AA\u09BE \u09A7\u09AA \u09B6\u09AC\u09CD\u09A6\u0964",
      profileLowBeep: "\u09A8\u09BF\u099A\u09C1 \u09AC\u09BF\u09AA",
      profileLowBeepDescription: "\u09A8\u09B0\u09AE\u09AD\u09BE\u09AC\u09C7 \u09B6\u09C1\u09B0\u09C1 \u09B9\u0993\u09AF\u09BC\u09BE \u09A8\u09BF\u099A\u09C1 \u09B8\u09CD\u09AC\u09B0\u09C7\u09B0 \u09AC\u09BF\u09AA\u0964",
      profileSoftChime: "\u09AE\u09C3\u09A6\u09C1 \u0998\u09A3\u09CD\u099F\u09BE",
      profileSoftChimeDescription: "\u09AE\u09C3\u09A6\u09C1 \u0998\u09A3\u09CD\u099F\u09BE\u09B0 \u0986\u0993\u09AF\u09BC\u09BE\u099C, \u09AF\u09BE \u09A6\u09CD\u09B0\u09C1\u09A4 \u09AE\u09BF\u09B2\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964"
    },
    es: {
      preferencesStored: "Guardado en este navegador.",
      soundHeading: "Sonido",
      volume: "Volumen",
      roomReverb: "Reverberaci\xF3n de sala",
      soundProfile: "Perfil de sonido",
      previewSound: "Probar sonido",
      appearance: "Apariencia",
      motionSetting: "Movimiento",
      motionAuto: "Autom\xE1tico \xB7 Seg\xFAn el navegador",
      motionReduced: "Reducido \xB7 Sin movimiento ni destellos",
      motionFull: "Completo \xB7 Animaciones y efectos",
      offlinePlayHeading: "Juego sin conexi\xF3n",
      offlineCachePreparing: "Preparando el acceso sin conexi\xF3n\u2026",
      offlineCacheReady: "Ya puedes volver a abrir el juego sin conexi\xF3n.",
      offlineCacheUnavailable: "No se puede volver a abrir el juego sin conexi\xF3n. Deja esta pesta\xF1a abierta para jugar sin conexi\xF3n.",
      playOffline: "Jugar sin conexi\xF3n",
      playOnline: "Jugar en l\xEDnea",
      playOnlineHint: "Sal de GitHub Pages y abre clicker.bluehexagons.com.",
      downloadSave: "Descargar partida",
      simulatedPingLabel: "Latencia simulada",
      simulatedPingHint: "Retrasa la respuesta visual y sonora sin conexi\xF3n. Los clics se guardan al instante.",
      instant: "Instant\xE1nea",
      approximatePing: "Unos {time}",
      replaceLocal: "Reemplazar la partida local",
      allowReplaceLocal: "Permitir reemplazar mi partida local",
      importSave: "Importar partida",
      restartSave: "Reiniciar partida",
      copyAccount: "Copiar el progreso de la cuenta",
      copyAccountHint: "Abre el contador de tu cuenta para poder copiar su progreso.",
      copyAccountNote: "Reemplaza la partida local con el \xFAltimo progreso cargado de {name}.",
      localSaveCount: "Clics en tu partida local: {count}",
      localSaveUnavailable: "La partida local no est\xE1 disponible.",
      controlsTitle: "Controles",
      technicalNotes: "Notas sobre el juego y el guardado (en ingl\xE9s)",
      sourceCode: "C\xF3digo fuente",
      settingsVisit: "Aplicado durante esta visita. El almacenamiento del navegador no est\xE1 disponible.",
      openLocalFailed: "No se pudo abrir la partida local.",
      backOnlineVisit: "Has vuelto al modo en l\xEDnea durante esta visita. El almacenamiento del navegador no est\xE1 disponible.",
      replaceConsent: "Marca \xABPermitir reemplazar mi partida local\xBB antes de continuar.",
      waitPending: "Espera a que se procesen los clics pendientes y vuelve a intentarlo.",
      replacingLocal: "Reemplazando la partida local\u2026",
      localReplacedFailed: "No se reemplaz\xF3 la partida local.",
      localRestarted: "Se reinici\xF3 la partida local.",
      accountCopied: "Se copi\xF3 el progreso de la cuenta a la partida local.",
      saveTooLarge: "Elige un archivo de partida local de 1 MiB como m\xE1ximo.",
      localImported: "Se import\xF3 la partida local.",
      importFailed: "No se pudo importar esta partida local.",
      localDownloaded: "Se descarg\xF3 la partida local.",
      downloadFailed: "No se pudo descargar la partida local.",
      profileClassic: "Cl\xE1sico",
      profileClassicDescription: "Un interruptor met\xE1lico con un sonido grave al pulsar y m\xE1s ligero al soltar.",
      profileBlip: "Pitido electr\xF3nico",
      profileBlipDescription: "Tonos electr\xF3nicos breves que suben de tono.",
      profileClack: "Chasquido",
      profileClackDescription: "Un sonido de tecla seco y breve.",
      profileClunk: "Golpe sordo",
      profileClunkDescription: "Un golpe grave y amortiguado.",
      profileLowBeep: "Pitido grave",
      profileLowBeepDescription: "Un tono grave que empieza suavemente.",
      profileSoftChime: "Campanilla suave",
      profileSoftChimeDescription: "Una campanilla suave que se apaga enseguida."
    },
    ar: {
      preferencesStored: "\u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u062A\u0635\u0641\u062D.",
      soundHeading: "\u0627\u0644\u0635\u0648\u062A",
      volume: "\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0635\u0648\u062A",
      roomReverb: "\u0635\u062F\u0649 \u0627\u0644\u063A\u0631\u0641\u0629",
      soundProfile: "\u0646\u0645\u0637 \u0627\u0644\u0635\u0648\u062A",
      previewSound: "\u0627\u0633\u062A\u0645\u0639 \u0625\u0644\u0649 \u0639\u064A\u0646\u0629",
      appearance: "\u0627\u0644\u0645\u0638\u0647\u0631",
      motionSetting: "\u0627\u0644\u062D\u0631\u0643\u0629",
      motionAuto: "\u062A\u0644\u0642\u0627\u0626\u064A \xB7 \u062D\u0633\u0628 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u062A\u0635\u0641\u062D",
      motionReduced: "\u0645\u062E\u0641\u0651\u0636 \xB7 \u0628\u0644\u0627 \u062D\u0631\u0643\u0629 \u0623\u0648 \u0648\u0645\u0636\u0627\u062A",
      motionFull: "\u0643\u0627\u0645\u0644 \xB7 \u0631\u0633\u0648\u0645 \u0645\u062A\u062D\u0631\u0643\u0629 \u0648\u062A\u0623\u062B\u064A\u0631\u0627\u062A",
      offlinePlayHeading: "\u0627\u0644\u0644\u0639\u0628 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644",
      offlineCachePreparing: "\u062C\u0627\u0631\u064D \u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0648\u0635\u0648\u0644 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644\u2026",
      offlineCacheReady: "\u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0622\u0646 \u0625\u0639\u0627\u062F\u0629 \u0641\u062A\u062D \u0627\u0644\u0644\u0639\u0628\u0629 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644.",
      offlineCacheUnavailable: "\u0625\u0639\u0627\u062F\u0629 \u0641\u062A\u062D \u0627\u0644\u0644\u0639\u0628\u0629 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629. \u0623\u0628\u0642\u0650 \u0639\u0644\u0627\u0645\u0629 \u0627\u0644\u062A\u0628\u0648\u064A\u0628 \u0647\u0630\u0647 \u0645\u0641\u062A\u0648\u062D\u0629 \u0644\u0644\u0639\u0628 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644.",
      playOffline: "\u0627\u0644\u0639\u0628 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644",
      playOnline: "\u0627\u0644\u0639\u0628 \u0639\u0628\u0631 \u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A",
      playOnlineHint: "\u064A\u063A\u0627\u062F\u0631 GitHub Pages \u0648\u064A\u0641\u062A\u062D clicker.bluehexagons.com.",
      downloadSave: "\u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u062D\u0641\u0638",
      simulatedPingLabel: "\u0632\u0645\u0646 \u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0645\u062D\u0627\u0643\u0649",
      simulatedPingHint: "\u064A\u0624\u062E\u0651\u0631 \u0638\u0647\u0648\u0631 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0641\u064A \u0648\u0636\u0639 \u0639\u062F\u0645 \u0627\u0644\u0627\u062A\u0635\u0627\u0644. \u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0641\u0648\u0631\u064B\u0627.",
      instant: "\u0641\u0648\u0631\u064A",
      approximatePing: "\u0646\u062D\u0648 {time}",
      replaceLocal: "\u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A",
      allowReplaceLocal: "\u0627\u0644\u0633\u0645\u0627\u062D \u0628\u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u062D\u0641\u0638\u064A \u0627\u0644\u0645\u062D\u0644\u064A",
      importSave: "\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u062D\u0641\u0638",
      restartSave: "\u0625\u0639\u0627\u062F\u0629 \u0628\u062F\u0621 \u0627\u0644\u062D\u0641\u0638",
      copyAccount: "\u0646\u0633\u062E \u062A\u0642\u062F\u0651\u0645 \u0627\u0644\u062D\u0633\u0627\u0628",
      copyAccountHint: "\u0627\u0641\u062A\u062D \u0639\u062F\u0651\u0627\u062F \u062D\u0633\u0627\u0628\u0643 \u0644\u062A\u062A\u0645\u0643\u0646 \u0645\u0646 \u0646\u0633\u062E \u062A\u0642\u062F\u0651\u0645\u0643.",
      copyAccountNote: "\u0627\u0633\u062A\u0628\u062F\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A \u0628\u0622\u062E\u0631 \u062A\u0642\u062F\u0651\u0645 \u0645\u062D\u0645\u0651\u0644 \u0645\u0646 \u062D\u0633\u0627\u0628 {name}.",
      localSaveCount: "\u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0641\u064A \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A: {count}",
      localSaveUnavailable: "\u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A \u063A\u064A\u0631 \u0645\u062A\u0627\u062D.",
      controlsTitle: "\u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u062A\u062D\u0643\u0651\u0645",
      technicalNotes: "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0639\u0646 \u0627\u0644\u0644\u0639\u0628\u0629 \u0648\u0627\u0644\u062D\u0641\u0638 (\u0628\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629)",
      sourceCode: "\u0627\u0644\u0634\u064A\u0641\u0631\u0629 \u0627\u0644\u0645\u0635\u062F\u0631\u064A\u0629",
      settingsVisit: "\u0637\u064F\u0628\u0651\u0642 \u0627\u0644\u0625\u0639\u062F\u0627\u062F \u0644\u0647\u0630\u0647 \u0627\u0644\u0632\u064A\u0627\u0631\u0629. \u0645\u0633\u0627\u062D\u0629 \u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629.",
      openLocalFailed: "\u062A\u0639\u0630\u0651\u0631 \u0641\u062A\u062D \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      backOnlineVisit: "\u062A\u0645\u062A \u0627\u0644\u0639\u0648\u062F\u0629 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0644\u0647\u0630\u0647 \u0627\u0644\u0632\u064A\u0627\u0631\u0629. \u0645\u0633\u0627\u062D\u0629 \u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629.",
      replaceConsent: "\u062D\u062F\u0651\u062F \xAB\u0627\u0644\u0633\u0645\u0627\u062D \u0628\u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u062D\u0641\u0638\u064A \u0627\u0644\u0645\u062D\u0644\u064A\xBB \u0623\u0648\u0644\u064B\u0627.",
      waitPending: "\u0627\u0646\u062A\u0638\u0631 \u062D\u062A\u0649 \u062A\u0646\u062A\u0647\u064A \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0627\u0644\u0645\u0639\u0644\u0651\u0642\u0629\u060C \u062B\u0645 \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u064B\u0627.",
      replacingLocal: "\u062C\u0627\u0631\u064D \u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A\u2026",
      localReplacedFailed: "\u0644\u0645 \u064A\u064F\u0633\u062A\u0628\u062F\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      localRestarted: "\u0623\u064F\u0639\u064A\u062F \u0628\u062F\u0621 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      accountCopied: "\u0646\u064F\u0633\u062E \u062A\u0642\u062F\u0651\u0645 \u0627\u0644\u062D\u0633\u0627\u0628 \u0625\u0644\u0649 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      saveTooLarge: "\u0627\u062E\u062A\u0631 \u0645\u0644\u0641 \u062D\u0641\u0638 \u0645\u062D\u0644\u064A \u0644\u0627 \u064A\u062A\u062C\u0627\u0648\u0632 \u062D\u062C\u0645\u0647 \u0661 \u0645\u064A\u0628\u064A\u0628\u0627\u064A\u062A.",
      localImported: "\u0627\u0633\u062A\u064F\u0648\u0631\u062F \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      importFailed: "\u062A\u0639\u0630\u0651\u0631 \u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0647\u0630\u0627 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      localDownloaded: "\u0646\u064F\u0632\u0651\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      downloadFailed: "\u062A\u0639\u0630\u0651\u0631 \u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A.",
      profileClassic: "\u0643\u0644\u0627\u0633\u064A\u0643\u064A",
      profileClassicDescription: "\u0635\u0648\u062A \u0645\u0641\u062A\u0627\u062D \u0645\u0639\u062F\u0646\u064A \u0628\u0646\u0628\u0631\u0629 \u0645\u0646\u062E\u0641\u0636\u0629 \u0639\u0646\u062F \u0627\u0644\u0636\u063A\u0637 \u0648\u0623\u062E\u0641\u0651 \u0639\u0646\u062F \u0627\u0644\u0625\u0641\u0644\u0627\u062A.",
      profileBlip: "\u0628\u064A\u0628 \u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A",
      profileBlipDescription: "\u0646\u063A\u0645\u0627\u062A \u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A\u0629 \u0642\u0635\u064A\u0631\u0629 \u062A\u0635\u0639\u062F \u0641\u064A \u0627\u0644\u062D\u062F\u0629.",
      profileClack: "\u0637\u064E\u0642\u0651\u0629",
      profileClackDescription: "\u0635\u0648\u062A \u0645\u0641\u062A\u0627\u062D \u0642\u0635\u064A\u0631 \u0648\u062C\u0627\u0641.",
      profileClunk: "\u062E\u0628\u0637\u0629 \u0645\u0643\u062A\u0648\u0645\u0629",
      profileClunkDescription: "\u0635\u0648\u062A \u0627\u0631\u062A\u0637\u0627\u0645 \u0645\u0646\u062E\u0641\u0636 \u0648\u0645\u0643\u062A\u0648\u0645.",
      profileLowBeep: "\u0635\u0641\u064A\u0631 \u0645\u0646\u062E\u0641\u0636",
      profileLowBeepDescription: "\u0646\u063A\u0645\u0629 \u0645\u0646\u062E\u0641\u0636\u0629 \u062A\u0628\u062F\u0623 \u0628\u0647\u062F\u0648\u0621.",
      profileSoftChime: "\u0631\u0646\u064A\u0646 \u0646\u0627\u0639\u0645",
      profileSoftChimeDescription: "\u0631\u0646\u064A\u0646 \u062E\u0627\u0641\u062A \u064A\u062A\u0644\u0627\u0634\u0649 \u0628\u0633\u0631\u0639\u0629."
    },
    hi: {
      preferencesStored: "\u0938\u0947\u091F\u093F\u0902\u0917 \u0907\u0938 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u092E\u0947\u0902 \u0938\u0939\u0947\u091C\u0940 \u091C\u093E\u0924\u0940 \u0939\u0948\u0902\u0964",
      soundHeading: "\u0927\u094D\u0935\u0928\u093F",
      volume: "\u0906\u0935\u093E\u091C\u093C \u0915\u093E \u0938\u094D\u0924\u0930",
      roomReverb: "\u0915\u092E\u0930\u0947 \u0915\u0940 \u0917\u0942\u0901\u091C",
      soundProfile: "\u0927\u094D\u0935\u0928\u093F \u0936\u0948\u0932\u0940",
      previewSound: "\u0927\u094D\u0935\u0928\u093F \u0938\u0941\u0928\u0947\u0902",
      appearance: "\u0926\u093F\u0916\u093E\u0935\u091F",
      motionSetting: "\u0917\u0924\u093F",
      motionAuto: "\u0905\u092A\u0928\u0947 \u0906\u092A \xB7 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u0915\u0940 \u0938\u0947\u091F\u093F\u0902\u0917 \u0915\u0947 \u0905\u0928\u0941\u0938\u093E\u0930",
      motionReduced: "\u0915\u092E \xB7 \u0910\u0928\u093F\u092E\u0947\u0936\u0928 \u0914\u0930 \u091A\u092E\u0915 \u0935\u093E\u0932\u0947 \u0907\u092B\u093C\u0947\u0915\u094D\u091F \u092C\u0902\u0926",
      motionFull: "\u092A\u0942\u0930\u0940 \xB7 \u0910\u0928\u093F\u092E\u0947\u0936\u0928 \u0914\u0930 \u0907\u092B\u093C\u0947\u0915\u094D\u091F",
      offlinePlayHeading: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0916\u0947\u0932",
      offlineCachePreparing: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0916\u094B\u0932\u0928\u0947 \u0915\u0940 \u0924\u0948\u092F\u093E\u0930\u0940 \u0939\u094B \u0930\u0939\u0940 \u0939\u0948\u2026",
      offlineCacheReady: "\u0905\u092C \u0906\u092A \u0917\u0947\u092E \u0915\u094B \u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u092B\u093F\u0930 \u0938\u0947 \u0916\u094B\u0932 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964",
      offlineCacheUnavailable: "\u0917\u0947\u092E \u0915\u094B \u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u092B\u093F\u0930 \u0938\u0947 \u0928\u0939\u0940\u0902 \u0916\u094B\u0932 \u0938\u0915\u0924\u0947\u0964 \u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0916\u0947\u0932\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u092F\u0939 \u091F\u0948\u092C \u0916\u0941\u0932\u093E \u0930\u0916\u0947\u0902\u0964",
      playOffline: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0916\u0947\u0932\u0947\u0902",
      playOnline: "\u0911\u0928\u0932\u093E\u0907\u0928 \u0916\u0947\u0932\u0947\u0902",
      playOnlineHint: "GitHub Pages \u0938\u0947 \u092C\u093E\u0939\u0930 \u091C\u093E\u0915\u0930 clicker.bluehexagons.com \u0916\u094B\u0932\u0924\u093E \u0939\u0948\u0964",
      downloadSave: "\u0938\u0947\u0935 \u0921\u093E\u0909\u0928\u0932\u094B\u0921 \u0915\u0930\u0947\u0902",
      simulatedPingLabel: "\u0938\u093F\u092E\u094D\u092F\u0941\u0932\u0947\u091F\u0947\u0921 \u092A\u093F\u0902\u0917",
      simulatedPingHint: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u092A\u094D\u0930\u0924\u093F\u0915\u094D\u0930\u093F\u092F\u093E \u0926\u0947\u0930 \u0938\u0947 \u0926\u093F\u0916\u0924\u0940 \u0914\u0930 \u0938\u0941\u0928\u093E\u0908 \u0926\u0947\u0924\u0940 \u0939\u0948\u0964 \u0915\u094D\u0932\u093F\u0915 \u0924\u0941\u0930\u0902\u0924 \u0938\u0939\u0947\u091C\u0947 \u091C\u093E\u0924\u0947 \u0939\u0948\u0902\u0964",
      instant: "\u0924\u0941\u0930\u0902\u0924",
      approximatePing: "\u0932\u0917\u092D\u0917 {time}",
      replaceLocal: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092C\u0926\u0932\u0947\u0902",
      allowReplaceLocal: "\u092E\u0947\u0930\u093E \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092C\u0926\u0932\u0928\u0947 \u0915\u0940 \u0905\u0928\u0941\u092E\u0924\u093F \u0926\u0947\u0902",
      importSave: "\u0938\u0947\u0935 \u0907\u0902\u092A\u094B\u0930\u094D\u091F \u0915\u0930\u0947\u0902",
      restartSave: "\u0938\u0947\u0935 \u092B\u093F\u0930 \u0938\u0947 \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902",
      copyAccount: "\u0916\u093E\u0924\u0947 \u0915\u0940 \u092A\u094D\u0930\u0917\u0924\u093F \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902",
      copyAccountHint: "\u092A\u094D\u0930\u0917\u0924\u093F \u0915\u0949\u092A\u0940 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0905\u092A\u0928\u0947 \u0916\u093E\u0924\u0947 \u0915\u093E \u0915\u093E\u0909\u0902\u091F\u0930 \u0916\u094B\u0932\u0947\u0902\u0964",
      copyAccountNote: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0915\u0940 \u091C\u0917\u0939 {name} \u0915\u0940 \u092A\u093F\u091B\u0932\u0940 \u092C\u093E\u0930 \u0932\u094B\u0921 \u0915\u0940 \u0917\u0908 \u092A\u094D\u0930\u0917\u0924\u093F \u0930\u0916\u0947\u0902\u0964",
      localSaveCount: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092E\u0947\u0902 \u0915\u094D\u0932\u093F\u0915: {count}",
      localSaveUnavailable: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964",
      controlsTitle: "\u0915\u0902\u091F\u094D\u0930\u094B\u0932",
      technicalNotes: "\u0917\u0947\u092E \u0914\u0930 \u0938\u0947\u0935 \u0915\u0940 \u091C\u093E\u0928\u0915\u093E\u0930\u0940 (\u0905\u0902\u0917\u094D\u0930\u0947\u091C\u093C\u0940 \u092E\u0947\u0902)",
      sourceCode: "\u0938\u094B\u0930\u094D\u0938 \u0915\u094B\u0921",
      settingsVisit: "\u0938\u0947\u091F\u093F\u0902\u0917 \u0907\u0938 \u092C\u093E\u0930 \u0915\u0947 \u0932\u093F\u090F \u0932\u093E\u0917\u0942 \u0939\u0948\u0964 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u0915\u093E \u0938\u094D\u091F\u094B\u0930\u0947\u091C \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964",
      openLocalFailed: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0928\u0939\u0940\u0902 \u0916\u0941\u0932 \u0938\u0915\u093E\u0964",
      backOnlineVisit: "\u0907\u0938 \u092C\u093E\u0930 \u0915\u0947 \u0932\u093F\u090F \u0911\u0928\u0932\u093E\u0907\u0928 \u092E\u094B\u0921 \u091A\u093E\u0932\u0942 \u0939\u0948\u0964 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u0915\u093E \u0938\u094D\u091F\u094B\u0930\u0947\u091C \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964",
      replaceConsent: "\u092A\u0939\u0932\u0947 \u201C\u092E\u0947\u0930\u093E \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092C\u0926\u0932\u0928\u0947 \u0915\u0940 \u0905\u0928\u0941\u092E\u0924\u093F \u0926\u0947\u0902\u201D \u091A\u0941\u0928\u0947\u0902\u0964",
      waitPending: "\u0932\u0902\u092C\u093F\u0924 \u0915\u094D\u0932\u093F\u0915 \u0915\u0940 \u092A\u094D\u0930\u094B\u0938\u0947\u0938\u093F\u0902\u0917 \u092A\u0942\u0930\u0940 \u0939\u094B\u0928\u0947 \u0924\u0915 \u0930\u0941\u0915\u0947\u0902, \u092B\u093F\u0930 \u0915\u094B\u0936\u093F\u0936 \u0915\u0930\u0947\u0902\u0964",
      replacingLocal: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092C\u0926\u0932\u093E \u091C\u093E \u0930\u0939\u093E \u0939\u0948\u2026",
      localReplacedFailed: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092C\u0926\u0932\u093E \u0928\u0939\u0940\u0902 \u0917\u092F\u093E\u0964",
      localRestarted: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092B\u093F\u0930 \u0938\u0947 \u0936\u0941\u0930\u0942 \u0915\u0930 \u0926\u093F\u092F\u093E \u0917\u092F\u093E\u0964",
      accountCopied: "\u0916\u093E\u0924\u0947 \u0915\u0940 \u092A\u094D\u0930\u0917\u0924\u093F \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u092E\u0947\u0902 \u0915\u0949\u092A\u0940 \u0939\u094B \u0917\u0908\u0964",
      saveTooLarge: "\u091C\u093C\u094D\u092F\u093E\u0926\u093E \u0938\u0947 \u091C\u093C\u094D\u092F\u093E\u0926\u093E 1 MiB \u0915\u0940 \u0932\u094B\u0915\u0932 \u0938\u0947\u0935 \u092B\u093C\u093E\u0907\u0932 \u091A\u0941\u0928\u0947\u0902\u0964",
      localImported: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0907\u0902\u092A\u094B\u0930\u094D\u091F \u0939\u094B \u0917\u092F\u093E\u0964",
      importFailed: "\u092F\u0939 \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0907\u0902\u092A\u094B\u0930\u094D\u091F \u0928\u0939\u0940\u0902 \u0939\u094B \u0938\u0915\u093E\u0964",
      localDownloaded: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0921\u093E\u0909\u0928\u0932\u094B\u0921 \u0939\u094B \u0917\u092F\u093E\u0964",
      downloadFailed: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u0947\u0935 \u0921\u093E\u0909\u0928\u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u094B \u0938\u0915\u093E\u0964",
      profileClassic: "\u0915\u094D\u0932\u093E\u0938\u093F\u0915",
      profileClassicDescription: "\u0927\u093E\u0924\u0941 \u0915\u0947 \u0938\u094D\u0935\u093F\u091A \u0915\u0940 \u0906\u0935\u093E\u091C\u093C, \u0926\u092C\u093E\u0928\u0947 \u092A\u0930 \u0917\u0939\u0930\u0940 \u0914\u0930 \u091B\u094B\u0921\u093C\u0928\u0947 \u092A\u0930 \u0939\u0932\u094D\u0915\u0940\u0964",
      profileBlip: "\u0907\u0932\u0947\u0915\u094D\u091F\u094D\u0930\u0949\u0928\u093F\u0915 \u092C\u0940\u092A",
      profileBlipDescription: "\u091B\u094B\u091F\u0940 \u0907\u0932\u0947\u0915\u094D\u091F\u094D\u0930\u0949\u0928\u093F\u0915 \u0927\u094D\u0935\u0928\u093F\u092F\u093E\u0901 \u091C\u093F\u0928\u0915\u093E \u0938\u0941\u0930 \u090A\u092A\u0930 \u091C\u093E\u0924\u093E \u0939\u0948\u0964",
      profileClack: "\u0916\u091F",
      profileClackDescription: "\u0915\u0941\u0902\u091C\u0940 \u0915\u0940 \u091B\u094B\u091F\u0940, \u0938\u0942\u0916\u0940 \u0916\u091F\u0964",
      profileClunk: "\u0927\u092A",
      profileClunkDescription: "\u0926\u092C\u0940 \u0939\u0941\u0908, \u0917\u0939\u0930\u0940 \u091A\u094B\u091F \u0915\u0940 \u0906\u0935\u093E\u091C\u093C\u0964",
      profileLowBeep: "\u0917\u0939\u0930\u0940 \u092C\u0940\u092A",
      profileLowBeepDescription: "\u0927\u0940\u0930\u0947 \u0936\u0941\u0930\u0942 \u0939\u094B\u0928\u0947 \u0935\u093E\u0932\u093E \u0928\u0940\u091A\u093E \u0938\u0941\u0930\u0964",
      profileSoftChime: "\u0939\u0932\u094D\u0915\u0940 \u0918\u0902\u091F\u0940",
      profileSoftChimeDescription: "\u091C\u0932\u094D\u0926\u0940 \u0925\u092E \u091C\u093E\u0928\u0947 \u0935\u093E\u0932\u0940 \u0939\u0932\u094D\u0915\u0940 \u0918\u0902\u091F\u0940\u0964"
    },
    id: {
      preferencesStored: "Disimpan di peramban ini.",
      soundHeading: "Suara",
      volume: "Volume",
      roomReverb: "Gema ruangan",
      soundProfile: "Profil suara",
      previewSound: "Coba suara",
      appearance: "Tampilan",
      motionSetting: "Gerakan",
      motionAuto: "Otomatis \xB7 Mengikuti peramban",
      motionReduced: "Terbatas \xB7 Tanpa gerakan atau kilatan",
      motionFull: "Penuh \xB7 Animasi dan efek",
      offlinePlayHeading: "Mode luring",
      offlineCachePreparing: "Menyiapkan akses luring\u2026",
      offlineCacheReady: "Game kini bisa dibuka kembali tanpa internet.",
      offlineCacheUnavailable: "Game belum bisa dibuka kembali tanpa internet. Biarkan tab ini terbuka untuk bermain luring.",
      playOffline: "Main luring",
      playOnline: "Main daring",
      playOnlineHint: "Meninggalkan GitHub Pages dan membuka clicker.bluehexagons.com.",
      downloadSave: "Unduh simpanan",
      simulatedPingLabel: "Ping simulasi",
      simulatedPingHint: "Menunda umpan balik saat luring. Klik langsung disimpan.",
      instant: "Seketika",
      approximatePing: "Sekitar {time}",
      replaceLocal: "Ganti simpanan lokal",
      allowReplaceLocal: "Izinkan simpanan lokal saya diganti",
      importSave: "Impor simpanan",
      restartSave: "Mulai ulang simpanan",
      copyAccount: "Salin progres akun",
      copyAccountHint: "Buka penghitung akun untuk menyalin progresnya.",
      copyAccountNote: "Ganti simpanan lokal dengan progres terbaru yang dimuat untuk {name}.",
      localSaveCount: "Klik dalam simpanan lokal Anda: {count}",
      localSaveUnavailable: "Simpanan lokal tidak tersedia.",
      controlsTitle: "Kontrol",
      technicalNotes: "Catatan permainan dan penyimpanan (bahasa Inggris)",
      sourceCode: "Kode sumber",
      settingsVisit: "Berlaku untuk kunjungan ini. Penyimpanan peramban tidak tersedia.",
      openLocalFailed: "Simpanan lokal tidak dapat dibuka.",
      backOnlineVisit: "Kembali daring untuk kunjungan ini. Penyimpanan peramban tidak tersedia.",
      replaceConsent: "Centang \u201CIzinkan simpanan lokal saya diganti\u201D terlebih dahulu.",
      waitPending: "Tunggu hingga klik yang tertunda selesai diproses, lalu coba lagi.",
      replacingLocal: "Mengganti simpanan lokal\u2026",
      localReplacedFailed: "Simpanan lokal tidak diganti.",
      localRestarted: "Simpanan lokal dimulai ulang.",
      accountCopied: "Progres akun disalin ke simpanan lokal.",
      saveTooLarge: "Pilih berkas simpanan lokal berukuran maksimal 1 MiB.",
      localImported: "Simpanan lokal diimpor.",
      importFailed: "Simpanan lokal ini tidak dapat diimpor.",
      localDownloaded: "Simpanan lokal diunduh.",
      downloadFailed: "Simpanan lokal tidak dapat diunduh.",
      profileClassic: "Klasik",
      profileClassicDescription: "Sakelar logam yang berbunyi rendah saat ditekan dan lebih ringan saat dilepas.",
      profileBlip: "Bip elektronik",
      profileBlipDescription: "Nada elektronik pendek yang meninggi.",
      profileClack: "Ketukan klik",
      profileClackDescription: "Bunyi tombol yang pendek dan kering.",
      profileClunk: "Benturan tumpul",
      profileClunkDescription: "Bunyi benturan rendah dan teredam.",
      profileLowBeep: "Bip rendah",
      profileLowBeepDescription: "Nada rendah yang berawal lembut.",
      profileSoftChime: "Denting lembut",
      profileSoftChimeDescription: "Denting lembut yang cepat mereda."
    },
    "pt-BR": {
      preferencesStored: "Salvo neste navegador.",
      soundHeading: "Som",
      volume: "Volume",
      roomReverb: "Reverbera\xE7\xE3o de sala",
      soundProfile: "Perfil de som",
      previewSound: "Testar som",
      appearance: "Apar\xEAncia",
      motionSetting: "Movimento",
      motionAuto: "Autom\xE1tico \xB7 Conforme o navegador",
      motionReduced: "Reduzido \xB7 Sem movimento ou flashes",
      motionFull: "Completo \xB7 Anima\xE7\xF5es e efeitos",
      offlinePlayHeading: "Modo offline",
      offlineCachePreparing: "Preparando o acesso offline\u2026",
      offlineCacheReady: "J\xE1 d\xE1 para reabrir o jogo offline.",
      offlineCacheUnavailable: "N\xE3o \xE9 poss\xEDvel reabrir o jogo offline. Mantenha esta aba aberta para jogar sem internet.",
      playOffline: "Jogar offline",
      playOnline: "Jogar online",
      playOnlineHint: "Sai do GitHub Pages e abre clicker.bluehexagons.com.",
      downloadSave: "Baixar save",
      simulatedPingLabel: "Ping simulado",
      simulatedPingHint: "Atrasa a resposta no modo offline. Os cliques s\xE3o salvos na hora.",
      instant: "Instant\xE2nea",
      approximatePing: "Cerca de {time}",
      replaceLocal: "Substituir save local",
      allowReplaceLocal: "Permitir substituir meu save local",
      importSave: "Importar save",
      restartSave: "Reiniciar save",
      copyAccount: "Copiar progresso da conta",
      copyAccountHint: "Abra o contador da sua conta para poder copiar o progresso.",
      copyAccountNote: "Substitua o save local pelo \xFAltimo progresso carregado de {name}.",
      localSaveCount: "Cliques no seu save local: {count}",
      localSaveUnavailable: "O save local est\xE1 indispon\xEDvel.",
      controlsTitle: "Controles",
      technicalNotes: "Notas sobre o jogo e o armazenamento (em ingl\xEAs)",
      sourceCode: "C\xF3digo-fonte",
      settingsVisit: "Aplicado nesta visita. O armazenamento do navegador est\xE1 indispon\xEDvel.",
      openLocalFailed: "N\xE3o foi poss\xEDvel abrir o save local.",
      backOnlineVisit: "Voc\xEA voltou ao modo online nesta visita. O armazenamento do navegador est\xE1 indispon\xEDvel.",
      replaceConsent: "Marque \u201CPermitir substituir meu save local\u201D antes de continuar.",
      waitPending: "Espere os cliques pendentes serem processados e tente novamente.",
      replacingLocal: "Substituindo o save local\u2026",
      localReplacedFailed: "O save local n\xE3o foi substitu\xEDdo.",
      localRestarted: "O save local foi reiniciado.",
      accountCopied: "O progresso da conta foi copiado para o save local.",
      saveTooLarge: "Escolha um arquivo de save local de at\xE9 1 MiB.",
      localImported: "O save local foi importado.",
      importFailed: "N\xE3o foi poss\xEDvel importar este save local.",
      localDownloaded: "O save local foi baixado.",
      downloadFailed: "N\xE3o foi poss\xEDvel baixar o save local.",
      profileClassic: "Cl\xE1ssico",
      profileClassicDescription: "Um interruptor met\xE1lico com som grave ao pressionar e mais leve ao soltar.",
      profileBlip: "Bipe eletr\xF4nico",
      profileBlipDescription: "Tons eletr\xF4nicos curtos que sobem de frequ\xEAncia.",
      profileClack: "Estalo",
      profileClackDescription: "Um toque de tecla curto e seco.",
      profileClunk: "Batida surda",
      profileClunkDescription: "Uma batida grave e abafada.",
      profileLowBeep: "Bipe grave",
      profileLowBeepDescription: "Um tom grave que come\xE7a de forma suave.",
      profileSoftChime: "Sino suave",
      profileSoftChimeDescription: "Um toque suave de sino que desaparece r\xE1pido."
    },
    fr: {
      preferencesStored: "Enregistr\xE9 dans ce navigateur.",
      soundHeading: "Son",
      volume: "Volume",
      roomReverb: "R\xE9verb\xE9ration de pi\xE8ce",
      soundProfile: "Profil sonore",
      previewSound: "\xC9couter un aper\xE7u",
      appearance: "Apparence",
      motionSetting: "Animations",
      motionAuto: "Auto \xB7 Selon le navigateur",
      motionReduced: "R\xE9duites \xB7 Sans mouvement ni flash",
      motionFull: "Compl\xE8tes \xB7 Animations et effets",
      offlinePlayHeading: "Jeu hors ligne",
      offlineCachePreparing: "Pr\xE9paration de l\u2019acc\xE8s hors connexion\u2026",
      offlineCacheReady: "Vous pouvez rouvrir le jeu hors connexion.",
      offlineCacheUnavailable: "La r\xE9ouverture hors connexion est indisponible. Gardez cet onglet ouvert pour jouer hors connexion.",
      playOffline: "Jouer hors ligne",
      playOnline: "Jouer en ligne",
      playOnlineHint: "Quitte GitHub Pages et ouvre clicker.bluehexagons.com.",
      downloadSave: "T\xE9l\xE9charger la sauvegarde",
      simulatedPingLabel: "Latence simul\xE9e",
      simulatedPingHint: "Retarde le retour visuel et sonore hors ligne. Les clics sont enregistr\xE9s imm\xE9diatement.",
      instant: "Instantan\xE9e",
      approximatePing: "Environ {time}",
      replaceLocal: "Remplacer la sauvegarde locale",
      allowReplaceLocal: "Autoriser le remplacement de ma sauvegarde locale",
      importSave: "Importer une sauvegarde",
      restartSave: "R\xE9initialiser la sauvegarde",
      copyAccount: "Copier la progression du compte",
      copyAccountHint: "Ouvrez le compteur de votre compte pour pouvoir copier sa progression.",
      copyAccountNote: "Remplacez la sauvegarde locale par la derni\xE8re progression charg\xE9e pour {name}.",
      localSaveCount: "Clics dans votre sauvegarde locale : {count}",
      localSaveUnavailable: "La sauvegarde locale est indisponible.",
      controlsTitle: "Commandes",
      technicalNotes: "Notes sur le jeu et le stockage (en anglais)",
      sourceCode: "Code source",
      settingsVisit: "Appliqu\xE9 pour cette visite. Le stockage du navigateur est indisponible.",
      openLocalFailed: "Impossible d\u2019ouvrir la sauvegarde locale.",
      backOnlineVisit: "Retour en ligne pour cette visite. Le stockage du navigateur est indisponible.",
      replaceConsent: "Cochez d\u2019abord \xAB Autoriser le remplacement de ma sauvegarde locale \xBB.",
      waitPending: "Attendez la fin du traitement des clics en attente, puis r\xE9essayez.",
      replacingLocal: "Remplacement de la sauvegarde locale\u2026",
      localReplacedFailed: "La sauvegarde locale n\u2019a pas \xE9t\xE9 remplac\xE9e.",
      localRestarted: "La sauvegarde locale a \xE9t\xE9 r\xE9initialis\xE9e.",
      accountCopied: "La progression du compte a \xE9t\xE9 copi\xE9e dans la sauvegarde locale.",
      saveTooLarge: "Choisissez une sauvegarde locale de 1 Mio maximum.",
      localImported: "La sauvegarde locale a \xE9t\xE9 import\xE9e.",
      importFailed: "Impossible d\u2019importer cette sauvegarde locale.",
      localDownloaded: "La sauvegarde locale a \xE9t\xE9 t\xE9l\xE9charg\xE9e.",
      downloadFailed: "Impossible de t\xE9l\xE9charger la sauvegarde locale.",
      profileClassic: "Classique",
      profileClassicDescription: "Un interrupteur m\xE9tallique au son grave \xE0 la pression et plus l\xE9ger au rel\xE2chement.",
      profileBlip: "Bip \xE9lectronique",
      profileBlipDescription: "De brefs sons \xE9lectroniques qui montent dans les aigus.",
      profileClack: "Clac",
      profileClackDescription: "Un bruit de touche bref et sec.",
      profileClunk: "Choc sourd",
      profileClunkDescription: "Un impact grave et \xE9touff\xE9.",
      profileLowBeep: "Bip grave",
      profileLowBeepDescription: "Un son grave qui d\xE9marre en douceur.",
      profileSoftChime: "Tintement doux",
      profileSoftChimeDescription: "Un doux tintement qui s\u2019estompe rapidement."
    },
    ja: {
      preferencesStored: "\u3053\u306E\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002",
      soundHeading: "\u30B5\u30A6\u30F3\u30C9",
      volume: "\u97F3\u91CF",
      roomReverb: "\u5BA4\u5185\u306E\u6B8B\u97FF",
      soundProfile: "\u52B9\u679C\u97F3\u306E\u7A2E\u985E",
      previewSound: "\u8A66\u8074",
      appearance: "\u8868\u793A",
      motionSetting: "\u52D5\u304D",
      motionAuto: "\u81EA\u52D5 \xB7 \u30D6\u30E9\u30A6\u30B6\u30FC\u306E\u8A2D\u5B9A\u306B\u5F93\u3046",
      motionReduced: "\u63A7\u3048\u3081 \xB7 \u52D5\u304D\u3068\u70B9\u6EC5\u306A\u3057",
      motionFull: "\u3059\u3079\u3066 \xB7 \u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3\u3068\u52B9\u679C\u3092\u8868\u793A",
      offlinePlayHeading: "\u30AA\u30D5\u30E9\u30A4\u30F3\u30D7\u30EC\u30A4",
      offlineCachePreparing: "\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u958B\u304F\u6E96\u5099\u3092\u3057\u3066\u3044\u307E\u3059\u2026",
      offlineCacheReady: "\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u30B2\u30FC\u30E0\u3092\u958B\u304D\u76F4\u305B\u307E\u3059\u3002",
      offlineCacheUnavailable: "\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u306F\u30B2\u30FC\u30E0\u3092\u958B\u304D\u76F4\u305B\u307E\u305B\u3093\u3002\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u904A\u3076\u306B\u306F\u3053\u306E\u30BF\u30D6\u3092\u958B\u3044\u305F\u307E\u307E\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      playOffline: "\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u30D7\u30EC\u30A4",
      playOnline: "\u30AA\u30F3\u30E9\u30A4\u30F3\u3067\u30D7\u30EC\u30A4",
      playOnlineHint: "GitHub Pages \u3092\u96E2\u308C\u3066 clicker.bluehexagons.com \u3092\u958B\u304D\u307E\u3059\u3002",
      downloadSave: "\u30BB\u30FC\u30D6\u30C7\u30FC\u30BF\u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9",
      simulatedPingLabel: "\u6A21\u64EC\u5FDC\u7B54\u6642\u9593",
      simulatedPingHint: "\u30AA\u30D5\u30E9\u30A4\u30F3\u6642\u306E\u53CD\u5FDC\u3092\u9045\u3089\u305B\u307E\u3059\u3002\u30AF\u30EA\u30C3\u30AF\u306F\u3059\u3050\u306B\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002",
      instant: "\u5373\u6642",
      approximatePing: "\u7D04 {time}",
      replaceLocal: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u306E\u7F6E\u304D\u63DB\u3048",
      allowReplaceLocal: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u306E\u7F6E\u304D\u63DB\u3048\u3092\u8A31\u53EF",
      importSave: "\u30BB\u30FC\u30D6\u3092\u30A4\u30F3\u30DD\u30FC\u30C8",
      restartSave: "\u30BB\u30FC\u30D6\u3092\u30EA\u30BB\u30C3\u30C8",
      copyAccount: "\u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u9032\u884C\u72B6\u6CC1\u3092\u30B3\u30D4\u30FC",
      copyAccountHint: "\u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u958B\u304F\u3068\u3001\u9032\u884C\u72B6\u6CC1\u3092\u30B3\u30D4\u30FC\u3067\u304D\u307E\u3059\u3002",
      copyAccountNote: "\u6700\u5F8C\u306B\u8AAD\u307F\u8FBC\u3093\u3060 {name} \u306E\u9032\u884C\u72B6\u6CC1\u3067\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u7F6E\u304D\u63DB\u3048\u307E\u3059\u3002",
      localSaveCount: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u306E\u30AF\u30EA\u30C3\u30AF\u6570\uFF1A{count}",
      localSaveUnavailable: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002",
      controlsTitle: "\u64CD\u4F5C\u65B9\u6CD5",
      technicalNotes: "\u30B2\u30FC\u30E0\u3068\u4FDD\u5B58\u306B\u3064\u3044\u3066\uFF08\u82F1\u8A9E\uFF09",
      sourceCode: "\u30BD\u30FC\u30B9\u30B3\u30FC\u30C9",
      settingsVisit: "\u4ECA\u56DE\u306E\u307F\u9069\u7528\u3057\u307E\u3057\u305F\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u306E\u4FDD\u5B58\u9818\u57DF\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002",
      openLocalFailed: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      backOnlineVisit: "\u4ECA\u56DE\u306E\u307F\u30AA\u30F3\u30E9\u30A4\u30F3\u306B\u623B\u308A\u307E\u3057\u305F\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u306E\u4FDD\u5B58\u9818\u57DF\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002",
      replaceConsent: "\u5148\u306B\u300C\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u306E\u7F6E\u304D\u63DB\u3048\u3092\u8A31\u53EF\u300D\u3092\u30AA\u30F3\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      waitPending: "\u4FDD\u7559\u4E2D\u306E\u30AF\u30EA\u30C3\u30AF\u306E\u51E6\u7406\u304C\u7D42\u308F\u3063\u3066\u304B\u3089\u3001\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
      replacingLocal: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u7F6E\u304D\u63DB\u3048\u3066\u3044\u307E\u3059\u2026",
      localReplacedFailed: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u306F\u7F6E\u304D\u63DB\u3048\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      localRestarted: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u30EA\u30BB\u30C3\u30C8\u3057\u307E\u3057\u305F\u3002",
      accountCopied: "\u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u9032\u884C\u72B6\u6CC1\u3092\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u306B\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002",
      saveTooLarge: "1 MiB \u4EE5\u4E0B\u306E\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044\u3002",
      localImported: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u30A4\u30F3\u30DD\u30FC\u30C8\u3057\u307E\u3057\u305F\u3002",
      importFailed: "\u3053\u306E\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u30A4\u30F3\u30DD\u30FC\u30C8\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      localDownloaded: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3057\u307E\u3057\u305F\u3002",
      downloadFailed: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      profileClassic: "\u30AF\u30E9\u30B7\u30C3\u30AF",
      profileClassicDescription: "\u91D1\u5C5E\u30B9\u30A4\u30C3\u30C1\u306E\u4F4E\u3044\u62BC\u3057\u97F3\u3068\u3001\u8EFD\u3044\u623B\u308A\u97F3\u3002",
      profileBlip: "\u96FB\u5B50\u97F3",
      profileBlipDescription: "\u97F3\u7A0B\u304C\u4E0A\u304C\u308B\u77ED\u3044\u96FB\u5B50\u97F3\u3002",
      profileClack: "\u30AB\u30C1\u30C3",
      profileClackDescription: "\u77ED\u304F\u4E7E\u3044\u305F\u30AD\u30FC\u306E\u97F3\u3002",
      profileClunk: "\u30B4\u30C8\u30C3",
      profileClunkDescription: "\u3053\u3082\u3063\u305F\u4F4E\u3044\u6253\u97F3\u3002",
      profileLowBeep: "\u4F4E\u3044\u30D3\u30FC\u30D7\u97F3",
      profileLowBeepDescription: "\u67D4\u3089\u304B\u304F\u7ACB\u3061\u4E0A\u304C\u308B\u4F4E\u3044\u97F3\u3002",
      profileSoftChime: "\u3084\u308F\u3089\u304B\u306A\u30C1\u30E3\u30A4\u30E0",
      profileSoftChimeDescription: "\u4F59\u97FB\u306E\u77ED\u3044\u3084\u308F\u3089\u304B\u306A\u30C1\u30E3\u30A4\u30E0\u3002"
    },
    ru: {
      preferencesStored: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.",
      soundHeading: "\u0417\u0432\u0443\u043A",
      volume: "\u0413\u0440\u043E\u043C\u043A\u043E\u0441\u0442\u044C",
      roomReverb: "\u0420\u0435\u0432\u0435\u0440\u0431\u0435\u0440\u0430\u0446\u0438\u044F \u043A\u043E\u043C\u043D\u0430\u0442\u044B",
      soundProfile: "\u0417\u0432\u0443\u043A\u043E\u0432\u043E\u0439 \u043F\u0440\u043E\u0444\u0438\u043B\u044C",
      previewSound: "\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C",
      appearance: "\u041E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u0438\u0435",
      motionSetting: "\u0410\u043D\u0438\u043C\u0430\u0446\u0438\u044F",
      motionAuto: "\u0410\u0432\u0442\u043E \xB7 \u041F\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430",
      motionReduced: "\u041C\u0438\u043D\u0438\u043C\u0443\u043C \xB7 \u0411\u0435\u0437 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F \u0438 \u0432\u0441\u043F\u044B\u0448\u0435\u043A",
      motionFull: "\u041F\u043E\u043B\u043D\u0430\u044F \xB7 \u0410\u043D\u0438\u043C\u0430\u0446\u0438\u044F \u0438 \u044D\u0444\u0444\u0435\u043A\u0442\u044B",
      offlinePlayHeading: "\u0418\u0433\u0440\u0430 \u043E\u0444\u043B\u0430\u0439\u043D",
      offlineCachePreparing: "\u041F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0430 \u043A \u0437\u0430\u043F\u0443\u0441\u043A\u0443 \u0431\u0435\u0437 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442\u0430\u2026",
      offlineCacheReady: "\u0422\u0435\u043F\u0435\u0440\u044C \u0438\u0433\u0440\u0443 \u043C\u043E\u0436\u043D\u043E \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u043D\u043E\u0432\u0430 \u0431\u0435\u0437 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442\u0430.",
      offlineCacheUnavailable: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0438\u0433\u0440\u0443 \u0437\u0430\u043D\u043E\u0432\u043E \u0431\u0435\u0437 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435\u043B\u044C\u0437\u044F. \u041E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u044D\u0442\u0443 \u0432\u043A\u043B\u0430\u0434\u043A\u0443 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439, \u0447\u0442\u043E\u0431\u044B \u0438\u0433\u0440\u0430\u0442\u044C \u0431\u0435\u0437 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F.",
      playOffline: "\u0418\u0433\u0440\u0430\u0442\u044C \u043E\u0444\u043B\u0430\u0439\u043D",
      playOnline: "\u0418\u0433\u0440\u0430\u0442\u044C \u043E\u043D\u043B\u0430\u0439\u043D",
      playOnlineHint: "\u041F\u0435\u0440\u0435\u0445\u043E\u0434 \u0441 GitHub Pages \u043D\u0430 clicker.bluehexagons.com.",
      downloadSave: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435",
      simulatedPingLabel: "\u0418\u043C\u0438\u0442\u0430\u0446\u0438\u044F \u043F\u0438\u043D\u0433\u0430",
      simulatedPingHint: "\u0417\u0430\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u043E\u0442\u043A\u043B\u0438\u043A \u0432 \u043E\u0444\u043B\u0430\u0439\u043D-\u0440\u0435\u0436\u0438\u043C\u0435. \u041A\u043B\u0438\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u044E\u0442\u0441\u044F \u0441\u0440\u0430\u0437\u0443.",
      instant: "\u041C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u043E",
      approximatePing: "\u041E\u043A\u043E\u043B\u043E {time}",
      replaceLocal: "\u0417\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435",
      allowReplaceLocal: "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u043D\u0443 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F",
      importSave: "\u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435",
      restartSave: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435",
      copyAccount: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430",
      copyAccountHint: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0447\u0451\u0442\u0447\u0438\u043A \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430, \u0447\u0442\u043E\u0431\u044B \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441.",
      copyAccountNote: "\u0417\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u043C \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u043C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u043E\u043C \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 {name}.",
      localSaveCount: "\u041A\u043B\u0438\u043A\u0438 \u0432 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u043C \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438: {count}",
      localSaveUnavailable: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.",
      controlsTitle: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435",
      technicalNotes: "\u041E\u0431 \u0438\u0433\u0440\u0435 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438 (\u043D\u0430 \u0430\u043D\u0433\u043B\u0438\u0439\u0441\u043A\u043E\u043C)",
      sourceCode: "\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u043A\u043E\u0434",
      settingsVisit: "\u041F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u044D\u0442\u043E\u0442 \u0440\u0430\u0437. \u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.",
      openLocalFailed: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435.",
      backOnlineVisit: "\u0412\u044B \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C \u0432 \u043E\u043D\u043B\u0430\u0439\u043D-\u0440\u0435\u0436\u0438\u043C \u043D\u0430 \u0432\u0440\u0435\u043C\u044F \u044D\u0442\u043E\u0433\u043E \u043F\u043E\u0441\u0435\u0449\u0435\u043D\u0438\u044F. \u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.",
      replaceConsent: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043C\u0435\u0442\u044C\u0442\u0435 \xAB\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0437\u0430\u043C\u0435\u043D\u0443 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F\xBB.",
      waitPending: "\u0414\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u043A\u043B\u0438\u043A\u043E\u0432, \u0437\u0430\u0442\u0435\u043C \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0443.",
      replacingLocal: "\u0417\u0430\u043C\u0435\u043D\u0430 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F\u2026",
      localReplacedFailed: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u043D\u0435 \u0437\u0430\u043C\u0435\u043D\u0435\u043D\u043E.",
      localRestarted: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u043E.",
      accountCopied: "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D \u0432 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435.",
      saveTooLarge: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0430\u0439\u043B \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \u0440\u0430\u0437\u043C\u0435\u0440\u043E\u043C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 1 \u041C\u0438\u0411.",
      localImported: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043E.",
      importFailed: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u044D\u0442\u043E \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435.",
      localDownloaded: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0441\u043A\u0430\u0447\u0430\u043D\u043E.",
      downloadFailed: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u0430\u0447\u0430\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435.",
      profileClassic: "\u041A\u043B\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043A\u0438\u0439",
      profileClassicDescription: "\u041C\u0435\u0442\u0430\u043B\u043B\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u044C \u0441 \u043D\u0438\u0437\u043A\u0438\u043C \u0437\u0432\u0443\u043A\u043E\u043C \u043F\u0440\u0438 \u043D\u0430\u0436\u0430\u0442\u0438\u0438 \u0438 \u0431\u043E\u043B\u0435\u0435 \u043B\u0451\u0433\u043A\u0438\u043C \u043F\u0440\u0438 \u043E\u0442\u043F\u0443\u0441\u043A\u0430\u043D\u0438\u0438.",
      profileBlip: "\u042D\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u043D\u044B\u0439 \u0441\u0438\u0433\u043D\u0430\u043B",
      profileBlipDescription: "\u041A\u043E\u0440\u043E\u0442\u043A\u0438\u0435 \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u043D\u044B\u0435 \u0437\u0432\u0443\u043A\u0438 \u0441 \u043F\u043E\u0432\u044B\u0448\u0435\u043D\u0438\u0435\u043C \u0442\u043E\u043D\u0430.",
      profileClack: "\u0429\u0435\u043B\u0447\u043E\u043A",
      profileClackDescription: "\u041A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u0441\u0443\u0445\u043E\u0439 \u0449\u0435\u043B\u0447\u043E\u043A \u043A\u043B\u0430\u0432\u0438\u0448\u0438.",
      profileClunk: "\u0413\u043B\u0443\u0445\u043E\u0439 \u0443\u0434\u0430\u0440",
      profileClunkDescription: "\u041D\u0438\u0437\u043A\u0438\u0439 \u043F\u0440\u0438\u0433\u043B\u0443\u0448\u0451\u043D\u043D\u044B\u0439 \u0443\u0434\u0430\u0440.",
      profileLowBeep: "\u041D\u0438\u0437\u043A\u0438\u0439 \u0441\u0438\u0433\u043D\u0430\u043B",
      profileLowBeepDescription: "\u041D\u0438\u0437\u043A\u0438\u0439 \u0442\u043E\u043D \u0441 \u043C\u044F\u0433\u043A\u0438\u043C \u043D\u0430\u0447\u0430\u043B\u043E\u043C.",
      profileSoftChime: "\u041C\u044F\u0433\u043A\u0438\u0439 \u0437\u0432\u043E\u043D",
      profileSoftChimeDescription: "\u041C\u044F\u0433\u043A\u0438\u0439 \u0437\u0432\u043E\u043D, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0431\u044B\u0441\u0442\u0440\u043E \u0437\u0430\u0442\u0438\u0445\u0430\u0435\u0442."
    },
    de: {
      preferencesStored: "In diesem Browser gespeichert.",
      soundHeading: "Ton",
      volume: "Lautst\xE4rke",
      roomReverb: "Raumhall",
      soundProfile: "Klangprofil",
      previewSound: "Klang anh\xF6ren",
      appearance: "Darstellung",
      motionSetting: "Bewegung",
      motionAuto: "Automatisch \xB7 Nach Browser-Einstellung",
      motionReduced: "Reduziert \xB7 ohne Animationen und Aufblitzen",
      motionFull: "Voll \xB7 Animationen und Effekte",
      offlinePlayHeading: "Offline-Spiel",
      offlineCachePreparing: "Offline-Zugriff wird vorbereitet\u2026",
      offlineCacheReady: "Du kannst das Spiel jetzt offline erneut \xF6ffnen.",
      offlineCacheUnavailable: "Offline l\xE4sst sich das Spiel derzeit nicht erneut \xF6ffnen. Lass diesen Tab offen, um offline zu spielen.",
      playOffline: "Offline spielen",
      playOnline: "Online spielen",
      playOnlineHint: "Verl\xE4sst GitHub Pages und \xF6ffnet clicker.bluehexagons.com.",
      downloadSave: "Spielstand herunterladen",
      simulatedPingLabel: "Simulierter Ping",
      simulatedPingHint: "Verz\xF6gert die R\xFCckmeldung im Offline-Modus. Klicks werden sofort gespeichert.",
      instant: "Sofort",
      approximatePing: "Etwa {time}",
      replaceLocal: "Lokalen Spielstand ersetzen",
      allowReplaceLocal: "Ersetzen meines lokalen Spielstands erlauben",
      importSave: "Spielstand importieren",
      restartSave: "Spielstand zur\xFCcksetzen",
      copyAccount: "Kontofortschritt kopieren",
      copyAccountHint: "\xD6ffne den Z\xE4hler deines Kontos, um den Fortschritt kopieren zu k\xF6nnen.",
      copyAccountNote: "Den lokalen Spielstand durch den zuletzt geladenen Fortschritt von {name} ersetzen.",
      localSaveCount: "Klicks im lokalen Spielstand: {count}",
      localSaveUnavailable: "Der lokale Spielstand ist nicht verf\xFCgbar.",
      controlsTitle: "Bedienung",
      technicalNotes: "Hinweise zu Spiel und Speicherung (Englisch)",
      sourceCode: "Quellcode",
      settingsVisit: "F\xFCr diesen Besuch \xFCbernommen. Der Browserspeicher ist nicht verf\xFCgbar.",
      openLocalFailed: "Der lokale Spielstand konnte nicht ge\xF6ffnet werden.",
      backOnlineVisit: "F\xFCr diesen Besuch wieder online. Der Browserspeicher ist nicht verf\xFCgbar.",
      replaceConsent: "Aktiviere zuerst \u201EErsetzen meines lokalen Spielstands erlauben\u201C.",
      waitPending: "Warte, bis alle ausstehenden Klicks verarbeitet sind, und versuche es erneut.",
      replacingLocal: "Lokaler Spielstand wird ersetzt \u2026",
      localReplacedFailed: "Der lokale Spielstand wurde nicht ersetzt.",
      localRestarted: "Der lokale Spielstand wurde zur\xFCckgesetzt.",
      accountCopied: "Der Kontofortschritt wurde in den lokalen Spielstand kopiert.",
      saveTooLarge: "W\xE4hle eine lokale Spielstandsdatei mit maximal 1 MiB.",
      localImported: "Der lokale Spielstand wurde importiert.",
      importFailed: "Dieser lokale Spielstand konnte nicht importiert werden.",
      localDownloaded: "Der lokale Spielstand wurde heruntergeladen.",
      downloadFailed: "Der lokale Spielstand konnte nicht heruntergeladen werden.",
      profileClassic: "Klassisch",
      profileClassicDescription: "Ein Metallschalter mit tiefem Klang beim Dr\xFCcken und leichterem Klang beim Loslassen.",
      profileBlip: "Elektronischer Piep",
      profileBlipDescription: "Kurze elektronische T\xF6ne mit ansteigender Tonh\xF6he.",
      profileClack: "Klack",
      profileClackDescription: "Ein kurzes, trockenes Tastenger\xE4usch.",
      profileClunk: "Dumpfer Schlag",
      profileClunkDescription: "Ein tiefer, ged\xE4mpfter Schlag.",
      profileLowBeep: "Tiefer Piep",
      profileLowBeepDescription: "Ein tiefer Ton mit sanftem Einsatz.",
      profileSoftChime: "Sanfter Glockenton",
      profileSoftChimeDescription: "Ein sanfter Glockenton, der schnell verklingt."
    }
  };

  // frontend/messages.ts
  var english = {
    ...englishOptions,
    fortnightActivity: "Fortnight activity",
    outOf: "{count} / {total}",
    daysActive: "Active days: {count}",
    activityNote: "Counts the 14 days through your last saved click. Clicking on consecutive days earns bonus points.",
    nextDay: "Next UTC day",
    timeUntilReset: "{time} remaining",
    localReset: "Day change (local time): {time}",
    achievements: "Achievements",
    offlineAchievements: "Offline achievements",
    weekRule: "One saved click counts for the week, Monday through Sunday (UTC).",
    firstClick: "Save your first click.",
    clickMilestone: "{count} clicks in total.",
    consecutiveDays: "{duration} in a row (UTC). Click at least once each day.",
    consecutiveWeeks: "{duration} in a row (UTC). Click at least once each week.",
    dayClickGoal: "{count} clicks in one UTC day.",
    weekClickGoal: "{count} clicks in one UTC week (Monday\u2013Sunday).",
    monthClickGoal: "{count} clicks in one UTC calendar month.",
    distinctHoursGoal: "Click in {count} different UTC hours on the same day.",
    distinctDaysGoal: "Click on {count} different UTC days. Gaps are allowed.",
    distinctMonthsGoal: "Click in {count} different UTC calendar months. Gaps are allowed.",
    otherAchievementsGoal: "Earn {count} other achievements.",
    earned: "Earned",
    locked: "Locked",
    allAchievements: "All",
    filterAchievements: "Filter achievements",
    revealRequirements: "Reveal locked requirements",
    allAchievementsEarned: "You\u2019ve earned every achievement.",
    noAchievementsEarned: "No achievements earned yet.",
    achievementUnlocked: "Achievement unlocked",
    achievementsUnlocked: "Achievements unlocked",
    language: "Language",
    account: "Account",
    localGame: "Local game",
    languageHint: "Game language \xB7 remembered in this browser",
    languageVisit: "Game language \xB7 applied for this visit; browser storage is unavailable",
    skip: "Skip to content",
    game: "Play Go Click",
    savedClicks: "Saved clicks",
    localClicks: "Local clicks",
    click: "Click",
    clickAction: "Add a click",
    outletTest: "Outlet test",
    cordSlack: "Loosen cord",
    reconnectPlug: "Reconnect plug",
    feedbackWaiting: "waiting",
    feedbackUnconfirmed: "unconfirmed",
    feedbackUnsaved: "not saved",
    feedbackCooldown: "cooldown",
    feedbackAwaitingHint: "Awaiting save \xB7 recent average {average}",
    feedbackSavedHint: "Saved \xB7 {time} \xB7 recent average {average}",
    feedbackSimulatedHint: "Simulated response \xB7 {time} \xB7 recent average {average}",
    copyChanged: "Preview changed. Copy again to share the updated text.",
    lastClick: "Last click {time}",
    timezone: "Shown in your local time zone",
    refresh: "Refresh counter",
    share: "Share",
    shareHint: "Preview stats for sharing",
    ping: "Ping",
    simPing: "Sim ping",
    pingHint: "Round-trip time of the last successful click request. The status dot indicates pending requests or a save error.",
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
    networkNotice: "Offline. Clicking is paused. The counter refreshes when you reconnect.",
    playingOffline: "Continuing offline.",
    offline: "Offline",
    backOnline: "Back online",
    signOut: "Sign out",
    homeGreeting: "Click to play offline, or sign in to save clicks to your account.",
    signIn: "Sign in",
    createAccount: "Create account",
    loadingCounter: "Loading counter\u2026",
    tryAgain: "Try again",
    admin: "Admin",
    options: "Options",
    sound: "Sound effects",
    soundOn: "Sound on \xB7 Turn off sound effects",
    soundOff: "Sound off \xB7 Turn on sound effects",
    motion: "Turn on motion effects",
    motionHint: "Reduced motion is on. Turn on motion effects.",
    controls: "Press with a mouse or touch, then release on or near the button. Each finger counts separately. With the button focused, Space or Enter adds one click on release. Holding never adds extra clicks.",
    loadError: "Couldn\u2019t load your counter. Try refreshing it.",
    unconfirmedClick: "Couldn\u2019t confirm your click. Refresh your counter to check whether it was saved.",
    unsavedClick: "Your click wasn\u2019t saved. Check your connection and try again.",
    localLoadError: "Couldn\u2019t load your local save. Open Options to import a copy or restart the local save.",
    localClickError: "Your local click wasn\u2019t saved. Browser storage may be full or unavailable.",
    signOutError: "Could not sign out. Please try again.",
    shareTitle: "Share stats",
    done: "Done",
    shareInstructions: "Choose what to include, then copy the preview.",
    include: "Include",
    siteLink: "Site link",
    clickTotal: "Click total",
    shareDataNote: "The total includes all clicks in the current save.",
    preview: "Preview",
    statsToShare: "Stats to share",
    copyText: "Copy text",
    copied: "Stats copied.",
    clipboardUnavailable: "Clipboard unavailable. Select and copy the preview text.",
    statsClicks: "{label}: {count}",
    statsStreaks: "UTC streaks: {day} \xB7 {week} \xB7 {month} \xB7 {year}",
    playLink: "Play: {url}"
  };
  var translations = {
    "zh-Hans": {
      ...optionsTranslations["zh-Hans"],
      fortnightActivity: "\u4E24\u5468\u6D3B\u8DC3\u5EA6",
      outOf: "{count} / {total}",
      daysActive: "\u6D3B\u8DC3\u5929\u6570\uFF1A{count}",
      activityNote: "\u7EDF\u8BA1\u6700\u8FD1\u4E00\u6B21\u6210\u529F\u8BB0\u5F55\u70B9\u51FB\u5F53\u5929\u53CA\u4E4B\u524D 13 \u5929\u7684\u6D3B\u52A8\u3002\u8FDE\u7EED\u591A\u5929\u70B9\u51FB\u53EF\u83B7\u5F97\u989D\u5916\u5206\u6570\u3002",
      nextDay: "\u4E0B\u4E00\u4E2A UTC \u65E5",
      timeUntilReset: "\u5269\u4F59 {time}",
      localReset: "\u65E5\u671F\u5207\u6362\u65F6\u95F4\uFF08\u5F53\u5730\u65F6\u95F4\uFF09\uFF1A{time}",
      achievements: "\u6210\u5C31",
      offlineAchievements: "\u79BB\u7EBF\u6210\u5C31",
      weekRule: "\u6BCF\u5468\u4ECE\u5468\u4E00\u5230\u5468\u65E5\uFF08UTC\uFF09\uFF0C\u4FDD\u5B58\u4E00\u6B21\u70B9\u51FB\u5373\u7B97\u6D3B\u8DC3\u4E00\u5468\u3002",
      firstClick: "\u4FDD\u5B58\u7B2C\u4E00\u6B21\u70B9\u51FB\u3002",
      clickMilestone: "\u7D2F\u8BA1\u70B9\u51FB {count} \u6B21\u3002",
      consecutiveDays: "\u8FDE\u7EED {duration}\uFF0C\u6BCF\u5929\u81F3\u5C11\u70B9\u51FB\u4E00\u6B21\uFF08UTC\uFF09\u3002",
      consecutiveWeeks: "\u8FDE\u7EED {duration}\uFF0C\u6BCF\u5468\u81F3\u5C11\u70B9\u51FB\u4E00\u6B21\uFF08UTC\uFF09\u3002",
      dayClickGoal: "\u5728\u540C\u4E00\u4E2A UTC \u65E5\u5185\u70B9\u51FB {count} \u6B21\u3002",
      weekClickGoal: "\u5728\u540C\u4E00\u4E2A UTC \u5468\u5185\u70B9\u51FB {count} \u6B21\uFF08\u5468\u4E00\u81F3\u5468\u65E5\uFF09\u3002",
      monthClickGoal: "\u5728\u540C\u4E00\u4E2A UTC \u81EA\u7136\u6708\u5185\u70B9\u51FB {count} \u6B21\u3002",
      distinctHoursGoal: "\u5728\u540C\u4E00\u4E2A UTC \u65E5\uFF0C\u5206\u522B\u5728 {count} \u4E2A\u4E0D\u540C\u7684\u5C0F\u65F6\u5185\u81F3\u5C11\u70B9\u51FB\u4E00\u6B21\u3002",
      distinctDaysGoal: "\u5728 {count} \u4E2A\u4E0D\u540C\u7684 UTC \u65E5\u5404\u81F3\u5C11\u70B9\u51FB\u4E00\u6B21\uFF0C\u4E0D\u5FC5\u8FDE\u7EED\u3002",
      distinctMonthsGoal: "\u5728 {count} \u4E2A\u4E0D\u540C\u7684 UTC \u65E5\u5386\u6708\u5404\u81F3\u5C11\u70B9\u51FB\u4E00\u6B21\uFF0C\u4E0D\u5FC5\u8FDE\u7EED\u3002",
      otherAchievementsGoal: "\u83B7\u5F97\u5176\u4ED6 {count} \u9879\u6210\u5C31\u3002",
      earned: "\u5DF2\u83B7\u5F97",
      locked: "\u672A\u89E3\u9501",
      allAchievements: "\u5168\u90E8",
      filterAchievements: "\u7B5B\u9009\u6210\u5C31",
      revealRequirements: "\u663E\u793A\u672A\u89E3\u9501\u6210\u5C31\u7684\u6761\u4EF6",
      allAchievementsEarned: "\u4F60\u5DF2\u83B7\u5F97\u6240\u6709\u6210\u5C31\u3002",
      noAchievementsEarned: "\u5C1A\u672A\u83B7\u5F97\u4EFB\u4F55\u6210\u5C31\u3002",
      achievementUnlocked: "\u6210\u5C31\u5DF2\u89E3\u9501",
      achievementsUnlocked: "\u6210\u5C31\u5DF2\u89E3\u9501",
      language: "\u8BED\u8A00",
      account: "\u8D26\u6237",
      localGame: "\u672C\u5730\u6E38\u620F",
      languageHint: "\u6E38\u620F\u8BED\u8A00 \xB7 \u4FDD\u5B58\u5728\u6B64\u6D4F\u89C8\u5668\u4E2D",
      languageVisit: "\u6E38\u620F\u8BED\u8A00 \xB7 \u4EC5\u672C\u6B21\u8BBF\u95EE\u6709\u6548\uFF1B\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528",
      skip: "\u8DF3\u8F6C\u5230\u5185\u5BB9",
      game: "\u73A9 Go Click",
      savedClicks: "\u5DF2\u4FDD\u5B58\u7684\u70B9\u51FB",
      localClicks: "\u672C\u5730\u70B9\u51FB",
      click: "\u70B9\u51FB",
      clickAction: "\u8BB0\u5F55\u4E00\u6B21\u70B9\u51FB",
      outletTest: "\u63D2\u5EA7\u6D4B\u8BD5",
      cordSlack: "\u653E\u677E\u7535\u7EBF",
      reconnectPlug: "\u91CD\u65B0\u63D2\u4E0A\u63D2\u5934",
      feedbackWaiting: "\u7B49\u5F85\u4E2D",
      feedbackUnconfirmed: "\u672A\u786E\u8BA4",
      feedbackUnsaved: "\u672A\u4FDD\u5B58",
      feedbackCooldown: "\u51B7\u5374\u4E2D",
      feedbackAwaitingHint: "\u7B49\u5F85\u4FDD\u5B58 \xB7 \u8FD1\u671F\u5E73\u5747 {average}",
      feedbackSavedHint: "\u5DF2\u4FDD\u5B58 \xB7 {time} \xB7 \u8FD1\u671F\u5E73\u5747 {average}",
      feedbackSimulatedHint: "\u6A21\u62DF\u54CD\u5E94 \xB7 {time} \xB7 \u8FD1\u671F\u5E73\u5747 {average}",
      copyChanged: "\u9884\u89C8\u5DF2\u66F4\u6539\u3002\u8BF7\u518D\u6B21\u590D\u5236\u4EE5\u5206\u4EAB\u66F4\u65B0\u540E\u7684\u6587\u672C\u3002",
      lastClick: "\u4E0A\u6B21\u70B9\u51FB\uFF1A{time}",
      timezone: "\u6309\u4F60\u7684\u5F53\u5730\u65F6\u533A\u663E\u793A",
      refresh: "\u5237\u65B0\u8BA1\u6570",
      share: "\u5206\u4EAB",
      shareHint: "\u9884\u89C8\u8981\u5206\u4EAB\u7684\u7EDF\u8BA1",
      ping: "\u5EF6\u8FDF",
      simPing: "\u6A21\u62DF\u5EF6\u8FDF",
      pingHint: "\u4E0A\u6B21\u6210\u529F\u70B9\u51FB\u8BF7\u6C42\u7684\u5F80\u8FD4\u65F6\u95F4\u3002\u72B6\u6001\u5706\u70B9\u8868\u793A\u5F85\u5904\u7406\u8BF7\u6C42\u6216\u4FDD\u5B58\u9519\u8BEF\u3002",
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
      networkNotice: "\u7F51\u7EDC\u5DF2\u65AD\u5F00\uFF0C\u70B9\u51FB\u5DF2\u6682\u505C\u3002\u91CD\u65B0\u8FDE\u63A5\u540E\u5C06\u5237\u65B0\u5DF2\u4FDD\u5B58\u7684\u8FDB\u5EA6\u3002",
      playingOffline: "\u7EE7\u7EED\u79BB\u7EBF\u6E38\u73A9\u3002",
      offline: "\u79BB\u7EBF",
      backOnline: "\u8FD4\u56DE\u5728\u7EBF\u6A21\u5F0F",
      signOut: "\u9000\u51FA\u767B\u5F55",
      homeGreeting: "\u70B9\u51FB\u5373\u53EF\u79BB\u7EBF\u6E38\u73A9\uFF0C\u767B\u5F55\u540E\u53EF\u5C06\u70B9\u51FB\u8BB0\u5F55\u4FDD\u5B58\u5230\u8D26\u53F7\u3002",
      signIn: "\u767B\u5F55",
      createAccount: "\u521B\u5EFA\u8D26\u53F7",
      loadingCounter: "\u6B63\u5728\u52A0\u8F7D\u8BA1\u6570\u5668\u2026",
      tryAgain: "\u91CD\u8BD5",
      admin: "\u7BA1\u7406",
      options: "\u9009\u9879",
      sound: "\u97F3\u6548",
      soundOn: "\u97F3\u6548\u5DF2\u5F00\u542F \xB7 \u5173\u95ED\u97F3\u6548",
      soundOff: "\u97F3\u6548\u5DF2\u5173\u95ED \xB7 \u5F00\u542F\u97F3\u6548",
      motion: "\u5F00\u542F\u52A8\u753B\u6548\u679C",
      motionHint: "\u5DF2\u5F00\u542F\u51CF\u5C11\u52A8\u6001\u6548\u679C\u3002\u70B9\u51FB\u5F00\u542F\u52A8\u753B\u3002",
      controls: "\u7528\u9F20\u6807\u6216\u89E6\u6478\u6309\u4E0B\uFF0C\u7136\u540E\u5728\u6309\u94AE\u4E0A\u6216\u9644\u8FD1\u677E\u5F00\u3002\u6BCF\u6839\u624B\u6307\u5355\u72EC\u8BA1\u6570\u3002\u6309\u94AE\u83B7\u5F97\u7126\u70B9\u65F6\uFF0C\u677E\u5F00\u7A7A\u683C\u952E\u6216\u56DE\u8F66\u952E\u53EF\u8BB0\u5F55\u4E00\u6B21\u70B9\u51FB\u3002\u6309\u4F4F\u4E0D\u4F1A\u589E\u52A0\u989D\u5916\u70B9\u51FB\u3002",
      loadError: "\u65E0\u6CD5\u52A0\u8F7D\u8BA1\u6570\u5668\u3002\u8BF7\u5C1D\u8BD5\u5237\u65B0\u3002",
      unconfirmedClick: "\u65E0\u6CD5\u786E\u8BA4\u8FD9\u6B21\u70B9\u51FB\u3002\u8BF7\u5237\u65B0\u8BA1\u6570\u5668\uFF0C\u67E5\u770B\u70B9\u51FB\u662F\u5426\u5DF2\u4FDD\u5B58\u3002",
      unsavedClick: "\u70B9\u51FB\u672A\u4FDD\u5B58\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002",
      localLoadError: "\u65E0\u6CD5\u52A0\u8F7D\u672C\u5730\u5B58\u6863\u3002\u8BF7\u5728\u9009\u9879\u4E2D\u5BFC\u5165\u526F\u672C\u6216\u91CD\u65B0\u5F00\u59CB\u3002",
      localClickError: "\u672C\u5730\u70B9\u51FB\u672A\u4FDD\u5B58\u3002\u6D4F\u89C8\u5668\u5B58\u50A8\u53EF\u80FD\u5DF2\u6EE1\u6216\u4E0D\u53EF\u7528\u3002",
      signOutError: "\u65E0\u6CD5\u9000\u51FA\u767B\u5F55\uFF0C\u8BF7\u91CD\u8BD5\u3002",
      shareTitle: "\u5206\u4EAB\u7EDF\u8BA1",
      done: "\u5B8C\u6210",
      shareInstructions: "\u9009\u62E9\u8981\u5305\u542B\u7684\u5185\u5BB9\uFF0C\u7136\u540E\u590D\u5236\u9884\u89C8\u6587\u672C\u3002",
      include: "\u5305\u542B",
      siteLink: "\u7F51\u7AD9\u94FE\u63A5",
      clickTotal: "\u70B9\u51FB\u603B\u6570",
      shareDataNote: "\u603B\u6570\u5305\u62EC\u5F53\u524D\u5B58\u6863\u4E2D\u7684\u6240\u6709\u70B9\u51FB\u3002",
      preview: "\u9884\u89C8",
      statsToShare: "\u8981\u5206\u4EAB\u7684\u7EDF\u8BA1",
      copyText: "\u590D\u5236\u6587\u672C",
      copied: "\u7EDF\u8BA1\u5DF2\u590D\u5236\u3002",
      clipboardUnavailable: "\u526A\u8D34\u677F\u4E0D\u53EF\u7528\u3002\u8BF7\u9009\u62E9\u5E76\u590D\u5236\u9884\u89C8\u6587\u672C\u3002",
      statsClicks: "{label}\uFF1A{count}",
      statsStreaks: "UTC \u8FDE\u7EED\u8BB0\u5F55\uFF1A{day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "\u5F00\u59CB\u6E38\u620F\uFF1A{url}"
    },
    "zh-Hant": {
      ...optionsTranslations["zh-Hant"],
      fortnightActivity: "\u5169\u9031\u6D3B\u8E8D\u5EA6",
      outOf: "{count} / {total}",
      daysActive: "\u6D3B\u8E8D\u5929\u6578\uFF1A{count}",
      activityNote: "\u7D71\u8A08\u6700\u8FD1\u4E00\u6B21\u6210\u529F\u8A18\u9304\u9EDE\u64CA\u7576\u5929\u53CA\u524D 13 \u5929\u7684\u6D3B\u52D5\u3002\u9023\u7E8C\u5E7E\u5929\u90FD\u6709\u9EDE\u64CA\u53EF\u7372\u5F97\u984D\u5916\u5206\u6578\u3002",
      nextDay: "\u4E0B\u4E00\u500B UTC \u65E5",
      timeUntilReset: "\u5269\u9918 {time}",
      localReset: "\u63DB\u65E5\u6642\u9593\uFF08\u7576\u5730\u6642\u9593\uFF09\uFF1A{time}",
      achievements: "\u6210\u5C31",
      offlineAchievements: "\u96E2\u7DDA\u6210\u5C31",
      weekRule: "\u6BCF\u9031\u5F9E\u9031\u4E00\u5230\u9031\u65E5\uFF08UTC\uFF09\uFF0C\u8A72\u9031\u5132\u5B58\u4E00\u6B21\u9EDE\u64CA\u5C31\u7B97\u6709\u7D00\u9304\u3002",
      firstClick: "\u5132\u5B58\u4F60\u7684\u7B2C\u4E00\u6B21\u9EDE\u64CA\u3002",
      clickMilestone: "\u7D2F\u8A08\u9EDE\u64CA {count} \u6B21\u3002",
      consecutiveDays: "\u9023\u7E8C {duration}\uFF0C\u6BCF\u5929\u81F3\u5C11\u9EDE\u64CA\u4E00\u6B21\uFF08UTC\uFF09\u3002",
      consecutiveWeeks: "\u9023\u7E8C {duration}\uFF0C\u6BCF\u9031\u81F3\u5C11\u9EDE\u64CA\u4E00\u6B21\uFF08UTC\uFF09\u3002",
      dayClickGoal: "\u5728\u540C\u4E00\u500B UTC \u65E5\u5167\u9EDE\u64CA {count} \u6B21\u3002",
      weekClickGoal: "\u5728\u540C\u4E00\u500B UTC \u9031\u5167\u9EDE\u64CA {count} \u6B21\uFF08\u9031\u4E00\u81F3\u9031\u65E5\uFF09\u3002",
      monthClickGoal: "\u5728\u540C\u4E00\u500B UTC \u66C6\u6708\u5167\u9EDE\u64CA {count} \u6B21\u3002",
      distinctHoursGoal: "\u5728\u540C\u4E00\u500B UTC \u65E5\uFF0C\u5206\u5225\u5728 {count} \u500B\u4E0D\u540C\u7684\u5C0F\u6642\u5167\u81F3\u5C11\u9EDE\u64CA\u4E00\u6B21\u3002",
      distinctDaysGoal: "\u5728 {count} \u500B\u4E0D\u540C\u7684 UTC \u65E5\u5404\u81F3\u5C11\u9EDE\u64CA\u4E00\u6B21\uFF0C\u4E0D\u5FC5\u9023\u7E8C\u3002",
      distinctMonthsGoal: "\u5728 {count} \u500B\u4E0D\u540C\u7684 UTC \u66C6\u6708\u5404\u81F3\u5C11\u9EDE\u64CA\u4E00\u6B21\uFF0C\u4E0D\u5FC5\u9023\u7E8C\u3002",
      otherAchievementsGoal: "\u7372\u5F97\u5176\u4ED6 {count} \u9805\u6210\u5C31\u3002",
      earned: "\u5DF2\u7372\u5F97",
      locked: "\u672A\u89E3\u9396",
      allAchievements: "\u5168\u90E8",
      filterAchievements: "\u7BE9\u9078\u6210\u5C31",
      revealRequirements: "\u986F\u793A\u672A\u89E3\u9396\u6210\u5C31\u7684\u689D\u4EF6",
      allAchievementsEarned: "\u4F60\u5DF2\u7372\u5F97\u6240\u6709\u6210\u5C31\u3002",
      noAchievementsEarned: "\u5C1A\u672A\u7372\u5F97\u4EFB\u4F55\u6210\u5C31\u3002",
      achievementUnlocked: "\u6210\u5C31\u5DF2\u89E3\u9396",
      achievementsUnlocked: "\u6210\u5C31\u5DF2\u89E3\u9396",
      language: "\u8A9E\u8A00",
      account: "\u5E33\u865F",
      localGame: "\u672C\u6A5F\u904A\u6232",
      languageHint: "\u904A\u6232\u8A9E\u8A00 \xB7 \u5132\u5B58\u5728\u9019\u500B\u700F\u89BD\u5668\u4E2D",
      languageVisit: "\u904A\u6232\u8A9E\u8A00 \xB7 \u700F\u89BD\u5668\u7121\u6CD5\u5132\u5B58\uFF0C\u50C5\u672C\u6B21\u4F7F\u7528\u6709\u6548",
      skip: "\u8DF3\u81F3\u4E3B\u8981\u5167\u5BB9",
      game: "\u73A9 Go Click",
      savedClicks: "\u5DF2\u5132\u5B58\u7684\u9EDE\u64CA",
      localClicks: "\u672C\u6A5F\u9EDE\u64CA",
      click: "\u9EDE\u64CA",
      clickAction: "\u8A18\u9304\u4E00\u6B21\u9EDE\u64CA",
      outletTest: "\u6E2C\u8A66\u63D2\u5EA7",
      cordSlack: "\u8B93\u96FB\u7DDA\u9B06\u4E00\u4E9B",
      reconnectPlug: "\u91CD\u65B0\u63D2\u4E0A\u63D2\u982D",
      feedbackWaiting: "\u7B49\u5F85\u4E2D",
      feedbackUnconfirmed: "\u672A\u78BA\u8A8D",
      feedbackUnsaved: "\u672A\u5132\u5B58",
      feedbackCooldown: "\u51B7\u537B\u4E2D",
      feedbackAwaitingHint: "\u7B49\u5F85\u5132\u5B58 \xB7 \u8FD1\u671F\u5E73\u5747 {average}",
      feedbackSavedHint: "\u5DF2\u5132\u5B58 \xB7 {time} \xB7 \u8FD1\u671F\u5E73\u5747 {average}",
      feedbackSimulatedHint: "\u6A21\u64EC\u56DE\u61C9 \xB7 {time} \xB7 \u8FD1\u671F\u5E73\u5747 {average}",
      copyChanged: "\u9810\u89BD\u5DF2\u66F4\u65B0\u3002\u8ACB\u518D\u6B21\u8907\u88FD\u4EE5\u5206\u4EAB\u6700\u65B0\u6587\u5B57\u3002",
      lastClick: "\u4E0A\u6B21\u9EDE\u64CA\uFF1A{time}",
      timezone: "\u4EE5\u4F60\u7684\u7576\u5730\u6642\u5340\u986F\u793A",
      refresh: "\u91CD\u65B0\u6574\u7406\u8A08\u6578",
      share: "\u5206\u4EAB",
      shareHint: "\u9810\u89BD\u8981\u5206\u4EAB\u7684\u7D71\u8A08\u8CC7\u6599",
      ping: "\u5EF6\u9072",
      simPing: "\u6A21\u64EC\u5EF6\u9072",
      pingHint: "\u4E0A\u6B21\u6210\u529F\u7684\u9EDE\u64CA\u8ACB\u6C42\u6240\u82B1\u7684\u5F80\u8FD4\u6642\u9593\u3002\u72C0\u614B\u5713\u9EDE\u6703\u986F\u793A\u662F\u5426\u6709\u5F85\u8655\u7406\u7684\u8ACB\u6C42\u6216\u5132\u5B58\u932F\u8AA4\u3002",
      pingStatus: "{ping}\u3002{status}\u3002",
      noPing: "\u5EF6\u9072\uFF1A\u5C1A\u672A\u6E2C\u91CF\u9EDE\u64CA",
      coolingStatus: "\u4F3A\u670D\u5668\u51B7\u537B\u4E2D\u3002\u5DF2\u66AB\u505C\u9EDE\u64CA",
      offlineStatus: "\u7DB2\u8DEF\u5DF2\u4E2D\u65B7\u3002\u5DF2\u66AB\u505C\u9EDE\u64CA",
      loadingStatus: "\u6B63\u5728\u8655\u7406\u8ACB\u6C42",
      failedStatus: "\u4E0A\u6B21\u8ACB\u6C42\u5931\u6557",
      idleStatus: "\u6C92\u6709\u5F85\u8655\u7406\u7684\u8ACB\u6C42",
      pending: "+{count} \u5F85\u5132\u5B58",
      cooldown: "\u51B7\u537B\u4E2D",
      seconds: "{count} \u79D2",
      streaks: "\u9023\u7E8C\u7D00\u9304",
      streakLabel: "\u9023\u7E8C\u9EDE\u64CA\u7D00\u9304",
      networkNotice: "\u7DB2\u8DEF\u5DF2\u4E2D\u65B7\uFF0C\u9EDE\u64CA\u5DF2\u66AB\u505C\u3002\u91CD\u65B0\u9023\u7DDA\u5F8C\u6703\u66F4\u65B0\u8A08\u6578\u3002",
      playingOffline: "\u7E7C\u7E8C\u96E2\u7DDA\u904A\u73A9\u3002",
      offline: "\u96E2\u7DDA",
      backOnline: "\u8FD4\u56DE\u7DDA\u4E0A\u6A21\u5F0F",
      signOut: "\u767B\u51FA",
      homeGreeting: "\u9EDE\u64CA\u5373\u53EF\u96E2\u7DDA\u904A\u73A9\uFF0C\u6216\u767B\u5165\u5E33\u865F\u4EE5\u5132\u5B58\u9EDE\u64CA\u7D00\u9304\u3002",
      signIn: "\u767B\u5165",
      createAccount: "\u5EFA\u7ACB\u5E33\u865F",
      loadingCounter: "\u6B63\u5728\u8F09\u5165\u8A08\u6578\u2026",
      tryAgain: "\u518D\u8A66\u4E00\u6B21",
      admin: "\u7BA1\u7406",
      options: "\u9078\u9805",
      sound: "\u97F3\u6548",
      soundOn: "\u97F3\u6548\u5DF2\u958B\u555F \xB7 \u95DC\u9589\u97F3\u6548",
      soundOff: "\u97F3\u6548\u5DF2\u95DC\u9589 \xB7 \u958B\u555F\u97F3\u6548",
      motion: "\u958B\u555F\u52D5\u756B\u6548\u679C",
      motionHint: "\u5DF2\u6E1B\u5C11\u52D5\u614B\u6548\u679C\u3002\u9078\u53D6\u6B64\u6309\u9215\u53EF\u958B\u555F\u52D5\u756B\u3002",
      controls: "\u7528\u6ED1\u9F20\u6216\u89F8\u63A7\u6309\u4E0B\u6309\u9215\uFF0C\u518D\u65BC\u6309\u9215\u4E0A\u6216\u9644\u8FD1\u653E\u958B\u3002\u6BCF\u6839\u624B\u6307\u5206\u958B\u8A08\u7B97\u3002\u6309\u9215\u53D6\u5F97\u7126\u9EDE\u6642\uFF0C\u653E\u958B\u7A7A\u767D\u9375\u6216 Enter \u9375\u6703\u8A18\u9304\u4E00\u6B21\u9EDE\u64CA\u3002\u6309\u4F4F\u4E0D\u6703\u589E\u52A0\u984D\u5916\u9EDE\u64CA\u3002",
      loadError: "\u7121\u6CD5\u8F09\u5165\u8A08\u6578\u3002\u8ACB\u8A66\u8457\u91CD\u65B0\u6574\u7406\u8A08\u6578\u3002",
      unconfirmedClick: "\u7121\u6CD5\u78BA\u8A8D\u9019\u6B21\u9EDE\u64CA\u3002\u8ACB\u91CD\u65B0\u6574\u7406\u8A08\u6578\uFF0C\u67E5\u770B\u9EDE\u64CA\u662F\u5426\u5DF2\u5132\u5B58\u3002",
      unsavedClick: "\u9EDE\u64CA\u672A\u5132\u5B58\u3002\u8ACB\u6AA2\u67E5\u7DB2\u8DEF\u9023\u7DDA\u5F8C\u518D\u8A66\u4E00\u6B21\u3002",
      localLoadError: "\u7121\u6CD5\u8F09\u5165\u672C\u6A5F\u5B58\u6A94\u3002\u8ACB\u958B\u555F\u9078\u9805\uFF0C\u532F\u5165\u5099\u4EFD\u6216\u91CD\u8A2D\u672C\u6A5F\u5B58\u6A94\u3002",
      localClickError: "\u672C\u6A5F\u9EDE\u64CA\u672A\u5132\u5B58\u3002\u700F\u89BD\u5668\u5132\u5B58\u7A7A\u9593\u53EF\u80FD\u5DF2\u6EFF\u6216\u7121\u6CD5\u4F7F\u7528\u3002",
      signOutError: "\u7121\u6CD5\u767B\u51FA\u3002\u8ACB\u518D\u8A66\u4E00\u6B21\u3002",
      shareTitle: "\u5206\u4EAB\u7D71\u8A08\u8CC7\u6599",
      done: "\u5B8C\u6210",
      shareInstructions: "\u9078\u64C7\u8981\u5305\u542B\u7684\u9805\u76EE\uFF0C\u518D\u8907\u88FD\u9810\u89BD\u6587\u5B57\u3002",
      include: "\u5305\u542B",
      siteLink: "\u7DB2\u7AD9\u9023\u7D50",
      clickTotal: "\u9EDE\u64CA\u7E3D\u6578",
      shareDataNote: "\u7E3D\u6578\u5305\u542B\u76EE\u524D\u5B58\u6A94\u4E2D\u7684\u6240\u6709\u9EDE\u64CA\u3002",
      preview: "\u9810\u89BD",
      statsToShare: "\u8981\u5206\u4EAB\u7684\u7D71\u8A08\u8CC7\u6599",
      copyText: "\u8907\u88FD\u6587\u5B57",
      copied: "\u5DF2\u8907\u88FD\u7D71\u8A08\u8CC7\u6599\u3002",
      clipboardUnavailable: "\u7121\u6CD5\u4F7F\u7528\u526A\u8CBC\u7C3F\u3002\u8ACB\u9078\u53D6\u4E26\u8907\u88FD\u9810\u89BD\u6587\u5B57\u3002",
      statsClicks: "{label}\uFF1A{count}",
      statsStreaks: "UTC \u9023\u7E8C\u7D00\u9304\uFF1A{day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "\u958B\u59CB\u904A\u6232\uFF1A{url}"
    },
    bn: {
      ...optionsTranslations["bn"],
      fortnightActivity: "\u09A6\u09C1\u0987 \u09B8\u09AA\u09CD\u09A4\u09BE\u09B9\u09C7\u09B0 \u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC\u09A4\u09BE",
      outOf: "{count} / {total}",
      daysActive: "\u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC \u09A6\u09BF\u09A8: {count}",
      activityNote: "\u09B6\u09C7\u09B7 \u09B8\u09C7\u09AD \u09B9\u0993\u09AF\u09BC\u09BE \u0995\u09CD\u09B2\u09BF\u0995\u09C7\u09B0 \u09A6\u09BF\u09A8\u09B8\u09B9 \u0986\u0997\u09C7\u09B0 \u09E7\u09E9 \u09A6\u09BF\u09A8\u09C7\u09B0 \u09B9\u09BF\u09B8\u09BE\u09AC\u0964 \u099F\u09BE\u09A8\u09BE \u0995\u09AF\u09BC\u09C7\u0995 \u09A6\u09BF\u09A8 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09B2\u09C7 \u09AC\u09BE\u09A1\u09BC\u09A4\u09BF \u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u0964",
      nextDay: "\u09AA\u09B0\u09C7\u09B0 UTC \u09A6\u09BF\u09A8",
      timeUntilReset: "\u0986\u09B0 {time} \u09AC\u09BE\u0995\u09BF",
      localReset: "\u09A6\u09BF\u09A8 \u09AC\u09A6\u09B2\u09C7\u09B0 \u09B8\u09AE\u09AF\u09BC (\u09B8\u09CD\u09A5\u09BE\u09A8\u09C0\u09AF\u09BC \u09B8\u09AE\u09AF\u09BC): {time}",
      achievements: "\u0985\u09B0\u09CD\u099C\u09A8",
      offlineAchievements: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8 \u0985\u09B0\u09CD\u099C\u09A8",
      weekRule: "\u09B8\u09CB\u09AE\u09AC\u09BE\u09B0 \u09A5\u09C7\u0995\u09C7 \u09B0\u09AC\u09BF\u09AC\u09BE\u09B0 (UTC) \u0985\u09A8\u09CD\u09A4\u09A4 \u098F\u0995\u099F\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u09B8\u09C7\u09AD \u09B9\u09B2\u09C7\u0987 \u09B8\u09AA\u09CD\u09A4\u09BE\u09B9\u099F\u09BF \u0997\u09A3\u09A8\u09BE \u09B9\u09AC\u09C7\u0964",
      firstClick: "\u09AA\u09CD\u09B0\u09A5\u09AE \u0995\u09CD\u09B2\u09BF\u0995\u099F\u09BF \u09B8\u09C7\u09AD \u0995\u09B0\u09C1\u09A8\u0964",
      clickMilestone: "\u09AE\u09CB\u099F {count}\u099F\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      consecutiveDays: "UTC \u0985\u09A8\u09C1\u09AF\u09BE\u09AF\u09BC\u09C0 \u099F\u09BE\u09A8\u09BE {duration} \u09A7\u09B0\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF\u09A6\u09BF\u09A8 \u0985\u09A8\u09CD\u09A4\u09A4 \u098F\u0995\u09AC\u09BE\u09B0 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      consecutiveWeeks: "UTC \u0985\u09A8\u09C1\u09AF\u09BE\u09AF\u09BC\u09C0 \u099F\u09BE\u09A8\u09BE {duration} \u09A7\u09B0\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF \u09B8\u09AA\u09CD\u09A4\u09BE\u09B9\u09C7 \u0985\u09A8\u09CD\u09A4\u09A4 \u098F\u0995\u09AC\u09BE\u09B0 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      dayClickGoal: "\u098F\u0995\u0987 UTC \u09A6\u09BF\u09A8\u09C7 {count}\u099F\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      weekClickGoal: "\u098F\u0995\u0987 UTC \u09B8\u09AA\u09CD\u09A4\u09BE\u09B9\u09C7 (\u09B8\u09CB\u09AE\u09AC\u09BE\u09B0\u2013\u09B0\u09AC\u09BF\u09AC\u09BE\u09B0) {count}\u099F\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      monthClickGoal: "\u098F\u0995\u0987 UTC \u0995\u09CD\u09AF\u09BE\u09B2\u09C7\u09A8\u09CD\u09A1\u09BE\u09B0 \u09AE\u09BE\u09B8\u09C7 {count}\u099F\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      distinctHoursGoal: "\u098F\u0995\u0987 UTC \u09A6\u09BF\u09A8\u09C7 \u0986\u09B2\u09BE\u09A6\u09BE {count}\u099F\u09BF \u0998\u09A3\u09CD\u099F\u09BE\u09AF\u09BC \u0985\u09A8\u09CD\u09A4\u09A4 \u098F\u0995\u09AC\u09BE\u09B0 \u0995\u09B0\u09C7 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      distinctDaysGoal: "\u0986\u09B2\u09BE\u09A6\u09BE {count}\u099F\u09BF UTC \u09A6\u09BF\u09A8\u09C7 \u0985\u09A8\u09CD\u09A4\u09A4 \u098F\u0995\u09AC\u09BE\u09B0 \u0995\u09B0\u09C7 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964 \u09AE\u09BE\u099D\u09C7 \u09AC\u09BF\u09B0\u09A4\u09BF \u09A5\u09BE\u0995\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u0964",
      distinctMonthsGoal: "\u0986\u09B2\u09BE\u09A6\u09BE {count}\u099F\u09BF UTC \u0995\u09CD\u09AF\u09BE\u09B2\u09C7\u09A8\u09CD\u09A1\u09BE\u09B0 \u09AE\u09BE\u09B8\u09C7 \u0985\u09A8\u09CD\u09A4\u09A4 \u098F\u0995\u09AC\u09BE\u09B0 \u0995\u09B0\u09C7 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964 \u09AE\u09BE\u099D\u09C7 \u09AC\u09BF\u09B0\u09A4\u09BF \u09A5\u09BE\u0995\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u0964",
      otherAchievementsGoal: "\u098F\u099F\u09BF \u09AA\u09C7\u09A4\u09C7 \u0985\u09A8\u09CD\u09AF {count}\u099F\u09BF \u0985\u09B0\u09CD\u099C\u09A8 \u0986\u09A8\u09B2\u0995 \u0995\u09B0\u09C1\u09A8\u0964",
      earned: "\u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u0997\u09C7\u099B\u09C7",
      locked: "\u09B2\u0995 \u0995\u09B0\u09BE",
      allAchievements: "\u09B8\u09AC",
      filterAchievements: "\u0985\u09B0\u09CD\u099C\u09A8 \u09AB\u09BF\u09B2\u09CD\u099F\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8",
      revealRequirements: "\u09B2\u0995 \u0995\u09B0\u09BE \u0985\u09B0\u09CD\u099C\u09A8\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \u09A6\u09C7\u0996\u09BE\u09A8",
      allAchievementsEarned: "\u0986\u09AA\u09A8\u09BF \u09B8\u09AC \u0985\u09B0\u09CD\u099C\u09A8 \u09AA\u09C7\u09AF\u09BC\u09C7\u099B\u09C7\u09A8\u0964",
      noAchievementsEarned: "\u098F\u0996\u09A8\u0993 \u0995\u09CB\u09A8\u09CB \u0985\u09B0\u09CD\u099C\u09A8 \u09AA\u09BE\u09A8\u09A8\u09BF\u0964",
      achievementUnlocked: "\u09A8\u09A4\u09C1\u09A8 \u0985\u09B0\u09CD\u099C\u09A8 \u09AA\u09C7\u09B2\u09C7\u09A8",
      achievementsUnlocked: "\u09A8\u09A4\u09C1\u09A8 \u0985\u09B0\u09CD\u099C\u09A8\u0997\u09C1\u09B2\u09CB \u09AA\u09C7\u09B2\u09C7\u09A8",
      language: "\u09AD\u09BE\u09B7\u09BE",
      account: "\u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F",
      localGame: "\u09B2\u09CB\u0995\u09BE\u09B2 \u0997\u09C7\u09AE",
      languageHint: "\u0997\u09C7\u09AE\u09C7\u09B0 \u09AD\u09BE\u09B7\u09BE \xB7 \u098F\u0987 \u09AC\u09CD\u09B0\u09BE\u0989\u099C\u09BE\u09B0\u09C7 \u09AE\u09A8\u09C7 \u09B0\u09BE\u0996\u09BE \u09B9\u09AC\u09C7",
      languageVisit: "\u0997\u09C7\u09AE\u09C7\u09B0 \u09AD\u09BE\u09B7\u09BE \xB7 \u098F\u09AC\u09BE\u09B0 \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u0997 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7, \u09AC\u09CD\u09B0\u09BE\u0989\u099C\u09BE\u09B0\u09C7 \u09B8\u09C7\u09AD \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF",
      skip: "\u09AE\u09C2\u09B2 \u09AC\u09BF\u09B7\u09AF\u09BC\u09AC\u09B8\u09CD\u09A4\u09C1\u09A4\u09C7 \u09AF\u09BE\u09A8",
      game: "Go Click \u0996\u09C7\u09B2\u09C1\u09A8",
      savedClicks: "\u09B8\u09C7\u09AD \u0995\u09B0\u09BE \u0995\u09CD\u09B2\u09BF\u0995",
      localClicks: "\u09B2\u09CB\u0995\u09BE\u09B2 \u0995\u09CD\u09B2\u09BF\u0995",
      click: "\u0995\u09CD\u09B2\u09BF\u0995",
      clickAction: "\u098F\u0995\u099F\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8",
      outletTest: "\u09B8\u0995\u09C7\u099F \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE",
      cordSlack: "\u09A4\u09BE\u09B0 \u09A2\u09BF\u09B2\u09BE \u0995\u09B0\u09C1\u09A8",
      reconnectPlug: "\u09AA\u09CD\u09B2\u09BE\u0997 \u0986\u09AC\u09BE\u09B0 \u09B2\u09BE\u0997\u09BE\u09A8",
      feedbackWaiting: "\u0985\u09AA\u09C7\u0995\u09CD\u09B7\u09BE\u09AF\u09BC",
      feedbackUnconfirmed: "\u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u09A8\u09AF\u09BC",
      feedbackUnsaved: "\u09B8\u09C7\u09AD \u09B9\u09AF\u09BC\u09A8\u09BF",
      feedbackCooldown: "\u09B8\u09BE\u09AE\u09AF\u09BC\u09BF\u0995 \u09AC\u09BF\u09B0\u09A4\u09BF",
      feedbackAwaitingHint: "\u09B8\u09C7\u09AD\u09C7\u09B0 \u0985\u09AA\u09C7\u0995\u09CD\u09B7\u09BE\u09AF\u09BC \xB7 \u09B8\u09BE\u09AE\u09CD\u09AA\u09CD\u09B0\u09A4\u09BF\u0995 \u0997\u09A1\u09BC {average}",
      feedbackSavedHint: "\u09B8\u09C7\u09AD \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 \xB7 {time} \xB7 \u09B8\u09BE\u09AE\u09CD\u09AA\u09CD\u09B0\u09A4\u09BF\u0995 \u0997\u09A1\u09BC {average}",
      feedbackSimulatedHint: "\u09B8\u09BF\u09AE\u09C1\u09B2\u09C7\u099F\u09C7\u09A1 \u09B8\u09BE\u09A1\u09BC\u09BE \xB7 {time} \xB7 \u09B8\u09BE\u09AE\u09CD\u09AA\u09CD\u09B0\u09A4\u09BF\u0995 \u0997\u09A1\u09BC {average}",
      copyChanged: "\u09AA\u09CD\u09B0\u09BF\u09AD\u09BF\u0989 \u09AC\u09A6\u09B2\u09C7\u099B\u09C7\u0964 \u09A8\u09A4\u09C1\u09A8 \u09B2\u09C7\u0996\u09BE\u099F\u09BF \u09B6\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09A4\u09C7 \u0986\u09AC\u09BE\u09B0 \u0995\u09AA\u09BF \u0995\u09B0\u09C1\u09A8\u0964",
      lastClick: "\u09B6\u09C7\u09B7 \u0995\u09CD\u09B2\u09BF\u0995: {time}",
      timezone: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09B8\u09CD\u09A5\u09BE\u09A8\u09C0\u09AF\u09BC \u09B8\u09AE\u09AF\u09BC\u09C7 \u09A6\u09C7\u0996\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7",
      refresh: "\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09B0\u09BF\u09AB\u09CD\u09B0\u09C7\u09B6 \u0995\u09B0\u09C1\u09A8",
      share: "\u09B6\u09C7\u09AF\u09BC\u09BE\u09B0",
      shareHint: "\u09B6\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09BE\u09B0 \u0986\u0997\u09C7 \u09AA\u09B0\u09BF\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09A8 \u09A6\u09C7\u0996\u09C1\u09A8",
      ping: "\u09AA\u09BF\u0982",
      simPing: "\u09B8\u09BF\u09AE\u09C1\u09B2\u09C7\u099F\u09C7\u09A1 \u09AA\u09BF\u0982",
      pingHint: "\u09B6\u09C7\u09B7 \u09B8\u09AB\u09B2 \u0995\u09CD\u09B2\u09BF\u0995\u09C7\u09B0 \u0985\u09A8\u09C1\u09B0\u09CB\u09A7 \u09AA\u09BE\u09A0\u09BF\u09AF\u09BC\u09C7 \u09B8\u09BE\u09A1\u09BC\u09BE \u09AA\u09C7\u09A4\u09C7 \u09AF\u09A4 \u09B8\u09AE\u09AF\u09BC \u09B2\u09C7\u0997\u09C7\u099B\u09C7\u0964 \u09AC\u09BF\u09A8\u09CD\u09A6\u09C1\u099F\u09BF \u0985\u09AA\u09C7\u0995\u09CD\u09B7\u09AE\u09BE\u09A3 \u0985\u09A8\u09C1\u09B0\u09CB\u09A7 \u09AC\u09BE \u09B8\u09C7\u09AD\u09C7\u09B0 \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u09A6\u09C7\u0996\u09BE\u09AF\u09BC\u0964",
      pingStatus: "{ping}\u0964 {status}\u0964",
      noPing: "\u09AA\u09BF\u0982: \u098F\u0996\u09A8\u0993 \u0995\u09CB\u09A8\u09CB \u0995\u09CD\u09B2\u09BF\u0995\u09C7\u09B0 \u09B8\u09AE\u09AF\u09BC \u09AE\u09BE\u09AA\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF",
      coolingStatus: "\u09B8\u09BE\u09B0\u09CD\u09AD\u09BE\u09B0\u09C7\u09B0 \u09B8\u09BE\u09AE\u09AF\u09BC\u09BF\u0995 \u09AC\u09BF\u09B0\u09A4\u09BF\u0964 \u0995\u09CD\u09B2\u09BF\u0995 \u09AC\u09A8\u09CD\u09A7 \u0986\u099B\u09C7",
      offlineStatus: "\u09B8\u0982\u09AF\u09CB\u0997 \u09A8\u09C7\u0987\u0964 \u0995\u09CD\u09B2\u09BF\u0995 \u09AC\u09A8\u09CD\u09A7 \u0986\u099B\u09C7",
      loadingStatus: "\u0985\u09A8\u09C1\u09B0\u09CB\u09A7 \u099A\u09B2\u099B\u09C7",
      failedStatus: "\u09B6\u09C7\u09B7 \u0985\u09A8\u09C1\u09B0\u09CB\u09A7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7",
      idleStatus: "\u0995\u09CB\u09A8\u09CB \u0985\u09A8\u09C1\u09B0\u09CB\u09A7 \u0985\u09AA\u09C7\u0995\u09CD\u09B7\u09BE\u09AF\u09BC \u09A8\u09C7\u0987",
      pending: "+{count} \u0985\u09AA\u09C7\u0995\u09CD\u09B7\u09BE\u09AF\u09BC",
      cooldown: "\u09B8\u09BE\u09AE\u09AF\u09BC\u09BF\u0995 \u09AC\u09BF\u09B0\u09A4\u09BF",
      seconds: "{count} \u09B8\u09C7.",
      streaks: "\u09A7\u09BE\u09B0\u09BE\u09AC\u09BE\u09B9\u09BF\u0995\u09A4\u09BE",
      streakLabel: "\u0995\u09CD\u09B2\u09BF\u0995\u09C7\u09B0 \u09A7\u09BE\u09B0\u09BE\u09AC\u09BE\u09B9\u09BF\u0995\u09A4\u09BE",
      networkNotice: "\u09B8\u0982\u09AF\u09CB\u0997 \u09A8\u09C7\u0987, \u09A4\u09BE\u0987 \u0995\u09CD\u09B2\u09BF\u0995 \u09B8\u09BE\u09AE\u09AF\u09BC\u09BF\u0995\u09AD\u09BE\u09AC\u09C7 \u09AC\u09A8\u09CD\u09A7\u0964 \u0986\u09AC\u09BE\u09B0 \u09B8\u0982\u09AF\u09CB\u0997 \u09B9\u09B2\u09C7 \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AC\u09C7\u0964",
      playingOffline: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0996\u09C7\u09B2\u09BE \u099A\u09B2\u099B\u09C7\u0964",
      offline: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8",
      backOnline: "\u0985\u09A8\u09B2\u09BE\u0987\u09A8\u09C7 \u09AB\u09BF\u09B0\u09C1\u09A8",
      signOut: "\u09B8\u09BE\u0987\u09A8 \u0986\u0989\u099F",
      homeGreeting: "\u0985\u09AB\u09B2\u09BE\u0987\u09A8\u09C7 \u0996\u09C7\u09B2\u09A4\u09C7 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C1\u09A8, \u0985\u09A5\u09AC\u09BE \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7 \u0995\u09CD\u09B2\u09BF\u0995 \u09B8\u09C7\u09AD \u0995\u09B0\u09A4\u09C7 \u09B8\u09BE\u0987\u09A8 \u0987\u09A8 \u0995\u09B0\u09C1\u09A8\u0964",
      signIn: "\u09B8\u09BE\u0987\u09A8 \u0987\u09A8",
      createAccount: "\u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C1\u09A8",
      loadingCounter: "\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09B2\u09CB\u09A1 \u09B9\u099A\u09CD\u099B\u09C7\u2026",
      tryAgain: "\u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8",
      admin: "\u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8",
      options: "\u0985\u09AA\u09B6\u09A8",
      sound: "\u09B8\u09BE\u0989\u09A8\u09CD\u09A1 \u0987\u09AB\u09C7\u0995\u09CD\u099F",
      soundOn: "\u09B8\u09BE\u0989\u09A8\u09CD\u09A1 \u099A\u09BE\u09B2\u09C1 \xB7 \u09B8\u09BE\u0989\u09A8\u09CD\u09A1 \u0987\u09AB\u09C7\u0995\u09CD\u099F \u09AC\u09A8\u09CD\u09A7 \u0995\u09B0\u09C1\u09A8",
      soundOff: "\u09B8\u09BE\u0989\u09A8\u09CD\u09A1 \u09AC\u09A8\u09CD\u09A7 \xB7 \u09B8\u09BE\u0989\u09A8\u09CD\u09A1 \u0987\u09AB\u09C7\u0995\u09CD\u099F \u099A\u09BE\u09B2\u09C1 \u0995\u09B0\u09C1\u09A8",
      motion: "\u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u09B6\u09A8 \u099A\u09BE\u09B2\u09C1 \u0995\u09B0\u09C1\u09A8",
      motionHint: "\u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u09B6\u09A8 \u0995\u09AE\u09BE\u09A8\u09CB \u0986\u099B\u09C7\u0964 \u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u09B6\u09A8 \u099A\u09BE\u09B2\u09C1 \u0995\u09B0\u09C1\u09A8\u0964",
      controls: "\u09AE\u09BE\u0989\u09B8 \u09A6\u09BF\u09AF\u09BC\u09C7 \u09AC\u09BE \u09B8\u09CD\u09AA\u09B0\u09CD\u09B6 \u0995\u09B0\u09C7 \u09AC\u09CB\u09A4\u09BE\u09AE\u099F\u09BF \u099A\u09BE\u09AA\u09C1\u09A8, \u09A4\u09BE\u09B0\u09AA\u09B0 \u09AC\u09CB\u09A4\u09BE\u09AE\u09C7\u09B0 \u0993\u09AA\u09B0 \u09AC\u09BE \u0995\u09BE\u099B\u09C7 \u099B\u09C7\u09A1\u09BC\u09C7 \u09A6\u09BF\u09A8\u0964 \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u0986\u0999\u09C1\u09B2\u09C7\u09B0 \u09B8\u09CD\u09AA\u09B0\u09CD\u09B6 \u0986\u09B2\u09BE\u09A6\u09BE \u0995\u09B0\u09C7 \u0997\u09A3\u09A8\u09BE \u09B9\u09AF\u09BC\u0964 \u09AC\u09CB\u09A4\u09BE\u09AE\u09C7 \u09AB\u09CB\u0995\u09BE\u09B8 \u09A5\u09BE\u0995\u09B2\u09C7 Space \u09AC\u09BE Enter \u099A\u09C7\u09AA\u09C7 \u099B\u09C7\u09A1\u09BC\u09C7 \u09A6\u09BF\u09B2\u09C7 \u098F\u0995\u099F\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u09AF\u09CB\u0997 \u09B9\u09AF\u09BC\u0964 \u099A\u09C7\u09AA\u09C7 \u09A7\u09B0\u09C7 \u09B0\u09BE\u0996\u09B2\u09C7 \u09AC\u09BE\u09A1\u09BC\u09A4\u09BF \u0995\u09CD\u09B2\u09BF\u0995 \u09AF\u09CB\u0997 \u09B9\u09AF\u09BC \u09A8\u09BE\u0964",
      loadError: "\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09B2\u09CB\u09A1 \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964 \u09B0\u09BF\u09AB\u09CD\u09B0\u09C7\u09B6 \u0995\u09B0\u09C7 \u09A6\u09C7\u0996\u09C1\u09A8\u0964",
      unconfirmedClick: "\u0995\u09CD\u09B2\u09BF\u0995\u099F\u09BF \u09B8\u09C7\u09AD \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 \u0995\u09BF \u09A8\u09BE \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u09B9\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964 \u09A6\u09C7\u0996\u09A4\u09C7 \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09B0\u09BF\u09AB\u09CD\u09B0\u09C7\u09B6 \u0995\u09B0\u09C1\u09A8\u0964",
      unsavedClick: "\u0995\u09CD\u09B2\u09BF\u0995\u099F\u09BF \u09B8\u09C7\u09AD \u09B9\u09AF\u09BC\u09A8\u09BF\u0964 \u09B8\u0982\u09AF\u09CB\u0997 \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09C7 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964",
      localLoadError: "\u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09B2\u09CB\u09A1 \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964 \u0985\u09AA\u09B6\u09A8 \u09A5\u09C7\u0995\u09C7 \u098F\u0995\u099F\u09BF \u0995\u09AA\u09BF \u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F \u0995\u09B0\u09C1\u09A8 \u09AC\u09BE \u09B2\u09CB\u0995\u09BE\u09B2 \u09B8\u09C7\u09AD \u09A8\u09A4\u09C1\u09A8 \u0995\u09B0\u09C7 \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09C1\u09A8\u0964",
      localClickError: "\u09B2\u09CB\u0995\u09BE\u09B2 \u0995\u09CD\u09B2\u09BF\u0995\u099F\u09BF \u09B8\u09C7\u09AD \u09B9\u09AF\u09BC\u09A8\u09BF\u0964 \u09AC\u09CD\u09B0\u09BE\u0989\u099C\u09BE\u09B0\u09C7\u09B0 \u09B8\u09CD\u099F\u09CB\u09B0\u09C7\u099C \u09AA\u09C2\u09B0\u09CD\u09A3 \u09AC\u09BE \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09AF\u09BE\u099A\u09CD\u099B\u09C7 \u09A8\u09BE\u0964",
      signOutError: "\u09B8\u09BE\u0987\u09A8 \u0986\u0989\u099F \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964",
      shareTitle: "\u09AA\u09B0\u09BF\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09A8 \u09B6\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8",
      done: "\u09A0\u09BF\u0995 \u0986\u099B\u09C7",
      shareInstructions: "\u0995\u09C0 \u0995\u09C0 \u09B6\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09AC\u09C7\u09A8 \u09AC\u09C7\u099B\u09C7 \u09A8\u09BF\u09A8, \u09A4\u09BE\u09B0\u09AA\u09B0 \u09AA\u09CD\u09B0\u09BF\u09AD\u09BF\u0989 \u0995\u09AA\u09BF \u0995\u09B0\u09C1\u09A8\u0964",
      include: "\u09AF\u09BE \u09A5\u09BE\u0995\u09AC\u09C7",
      siteLink: "\u09B8\u09BE\u0987\u099F\u09C7\u09B0 \u09B2\u09BF\u0982\u0995",
      clickTotal: "\u09AE\u09CB\u099F \u0995\u09CD\u09B2\u09BF\u0995",
      shareDataNote: "\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u09B8\u09C7\u09AD\u09C7\u09B0 \u09B8\u09AC \u0995\u09CD\u09B2\u09BF\u0995 \u098F\u0987 \u09AE\u09CB\u099F\u09C7 \u09B0\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      preview: "\u09AA\u09CD\u09B0\u09BF\u09AD\u09BF\u0989",
      statsToShare: "\u09B6\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09BE\u09B0 \u09AA\u09B0\u09BF\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09A8",
      copyText: "\u09B2\u09C7\u0996\u09BE \u0995\u09AA\u09BF \u0995\u09B0\u09C1\u09A8",
      copied: "\u09AA\u09B0\u09BF\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09A8 \u0995\u09AA\u09BF \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      clipboardUnavailable: "\u0995\u09CD\u09B2\u09BF\u09AA\u09AC\u09CB\u09B0\u09CD\u09A1 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09AF\u09BE\u099A\u09CD\u099B\u09C7 \u09A8\u09BE\u0964 \u09AA\u09CD\u09B0\u09BF\u09AD\u09BF\u0989\u09AF\u09BC\u09C7\u09B0 \u09B2\u09C7\u0996\u09BE \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C7 \u0995\u09AA\u09BF \u0995\u09B0\u09C1\u09A8\u0964",
      statsClicks: "{label}: {count}",
      statsStreaks: "\u09A7\u09BE\u09B0\u09BE\u09AC\u09BE\u09B9\u09BF\u0995\u09A4\u09BE (UTC): {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "\u0996\u09C7\u09B2\u09C1\u09A8: {url}"
    },
    es: {
      ...optionsTranslations["es"],
      fortnightActivity: "Actividad de 14 d\xEDas",
      outOf: "{count} / {total}",
      daysActive: "D\xEDas activos: {count}",
      activityNote: "Cuenta los 14 d\xEDas hasta el \xFAltimo clic guardado. Haz clic en d\xEDas consecutivos para ganar puntos extra.",
      nextDay: "Pr\xF3ximo d\xEDa UTC",
      timeUntilReset: "Quedan {time}",
      localReset: "Cambio de d\xEDa (hora local): {time}",
      achievements: "Logros",
      offlineAchievements: "Logros sin conexi\xF3n",
      weekRule: "Un clic guardado cuenta para la semana, de lunes a domingo (UTC).",
      firstClick: "Guarda tu primer clic.",
      clickMilestone: "{count} clics en total.",
      consecutiveDays: "{duration} seguidos (UTC). Haz clic al menos una vez al d\xEDa.",
      consecutiveWeeks: "{duration} seguidas (UTC). Haz clic al menos una vez a la semana.",
      dayClickGoal: "{count} clics en un mismo d\xEDa UTC.",
      weekClickGoal: "{count} clics en una misma semana UTC (de lunes a domingo).",
      monthClickGoal: "{count} clics en un mismo mes calendario UTC.",
      distinctHoursGoal: "Haz clic en {count} horas distintas del mismo d\xEDa UTC.",
      distinctDaysGoal: "Haz clic en {count} d\xEDas distintos seg\xFAn UTC. Pueden ser no consecutivos.",
      distinctMonthsGoal: "Haz clic en {count} meses calendario distintos seg\xFAn UTC. Pueden ser no consecutivos.",
      otherAchievementsGoal: "Consigue otros {count} logros.",
      earned: "Conseguido",
      locked: "Bloqueado",
      allAchievements: "Todos",
      filterAchievements: "Filtrar logros",
      revealRequirements: "Mostrar los requisitos de los logros bloqueados",
      allAchievementsEarned: "Has conseguido todos los logros.",
      noAchievementsEarned: "A\xFAn no has conseguido ning\xFAn logro.",
      achievementUnlocked: "Logro desbloqueado",
      achievementsUnlocked: "Logros desbloqueados",
      language: "Idioma",
      account: "Cuenta",
      localGame: "Juego local",
      languageHint: "Idioma del juego \xB7 se guarda en este navegador",
      languageVisit: "Idioma del juego \xB7 aplicado en esta visita; almacenamiento no disponible",
      skip: "Saltar al contenido",
      game: "Jugar a Go Click",
      savedClicks: "Clics guardados",
      localClicks: "Clics locales",
      click: "Clic",
      clickAction: "Registrar un clic",
      outletTest: "Probar la toma de corriente",
      cordSlack: "Aflojar el cable",
      reconnectPlug: "Volver a conectar la clavija",
      feedbackWaiting: "esperando",
      feedbackUnconfirmed: "sin confirmar",
      feedbackUnsaved: "no guardado",
      feedbackCooldown: "pausa",
      feedbackAwaitingHint: "Esperando guardado \xB7 media reciente {average}",
      feedbackSavedHint: "Guardado \xB7 {time} \xB7 media reciente {average}",
      feedbackSimulatedHint: "Respuesta simulada \xB7 {time} \xB7 media reciente {average}",
      copyChanged: "La vista previa cambi\xF3. Copia de nuevo para compartir el texto actualizado.",
      lastClick: "\xDAltimo clic: {time}",
      timezone: "Se muestra en tu zona horaria local",
      refresh: "Actualizar contador",
      share: "Compartir",
      shareHint: "Previsualizar estad\xEDsticas para compartir",
      ping: "Latencia",
      simPing: "Latencia simulada",
      pingHint: "Tiempo de ida y vuelta del \xFAltimo clic guardado. El punto de estado indica solicitudes pendientes o un error al guardar.",
      pingStatus: "{ping}. {status}.",
      noPing: "Latencia: a\xFAn no se ha medido ning\xFAn clic",
      coolingStatus: "Pausa del servidor. Clics en pausa",
      offlineStatus: "Sin conexi\xF3n. Clics en pausa",
      loadingStatus: "Solicitud en curso",
      failedStatus: "La \xFAltima solicitud fall\xF3",
      idleStatus: "No hay solicitudes pendientes",
      pending: "+{count} en espera",
      cooldown: "En pausa",
      seconds: "{count} s",
      streaks: "Rachas",
      streakLabel: "Rachas de clics",
      networkNotice: "No tienes conexi\xF3n. Los clics est\xE1n en pausa. Tu progreso guardado se actualizar\xE1 al reconectarte.",
      playingOffline: "Seguimos sin conexi\xF3n.",
      offline: "Sin conexi\xF3n",
      backOnline: "Volver al modo en l\xEDnea",
      signOut: "Cerrar sesi\xF3n",
      homeGreeting: "Haz clic para jugar sin conexi\xF3n o inicia sesi\xF3n para guardar tus clics en tu cuenta.",
      signIn: "Iniciar sesi\xF3n",
      createAccount: "Crear cuenta",
      loadingCounter: "Cargando contador\u2026",
      tryAgain: "Volver a intentar",
      admin: "Administraci\xF3n",
      options: "Opciones",
      sound: "Efectos de sonido",
      soundOn: "Sonido activado \xB7 Desactivar efectos de sonido",
      soundOff: "Sonido desactivado \xB7 Activar efectos de sonido",
      motion: "Activar efectos de movimiento",
      motionHint: "El movimiento reducido est\xE1 activado. Activar efectos de movimiento.",
      controls: "Pulsa con el rat\xF3n o el dedo y suelta sobre el bot\xF3n o cerca de \xE9l. Cada dedo cuenta por separado. Con el bot\xF3n enfocado, suelta Espacio o Intro para registrar un clic. Mantener pulsado no a\xF1ade clics.",
      loadError: "No se pudo cargar el contador. Intenta actualizarlo.",
      unconfirmedClick: "No se pudo confirmar tu clic. Actualiza el contador para comprobar si se guard\xF3.",
      unsavedClick: "Tu clic no se guard\xF3. Comprueba tu conexi\xF3n e int\xE9ntalo de nuevo.",
      localLoadError: "No se pudo cargar la partida local. Abre Opciones para importar una copia o reiniciar la partida.",
      localClickError: "Tu clic local no se guard\xF3. El almacenamiento del navegador puede estar lleno o no disponible.",
      signOutError: "No se pudo cerrar sesi\xF3n. Int\xE9ntalo de nuevo.",
      shareTitle: "Compartir estad\xEDsticas",
      done: "Listo",
      shareInstructions: "Elige qu\xE9 incluir y copia la vista previa.",
      include: "Incluir",
      siteLink: "Enlace al sitio",
      clickTotal: "Total de clics",
      shareDataNote: "El total incluye todos los clics de la partida actual.",
      preview: "Vista previa",
      statsToShare: "Estad\xEDsticas para compartir",
      copyText: "Copiar texto",
      copied: "Estad\xEDsticas copiadas.",
      clipboardUnavailable: "Portapapeles no disponible. Selecciona y copia el texto de la vista previa.",
      statsClicks: "{label}: {count}",
      statsStreaks: "Rachas UTC: {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "Jugar: {url}"
    },
    ar: {
      ...optionsTranslations["ar"],
      fortnightActivity: "\u0646\u0634\u0627\u0637 \u0622\u062E\u0631 \u0623\u0633\u0628\u0648\u0639\u064A\u0646",
      outOf: "{count} \u0645\u0646 {total}",
      daysActive: "\u0623\u064A\u0627\u0645 \u0627\u0644\u0646\u0634\u0627\u0637: {count}",
      activityNote: "\u064A\u0634\u0645\u0644 \u0622\u062E\u0631 \u0661\u0664 \u064A\u0648\u0645\u064B\u0627 \u062D\u062A\u0649 \u064A\u0648\u0645 \u0622\u062E\u0631 \u0646\u0642\u0631\u0629 \u0645\u062D\u0641\u0648\u0638\u0629. \u0627\u0646\u0642\u0631 \u0641\u064A \u0623\u064A\u0627\u0645 \u0645\u062A\u062A\u0627\u0644\u064A\u0629 \u0644\u062A\u062D\u0635\u0644 \u0639\u0644\u0649 \u0646\u0642\u0627\u0637 \u0625\u0636\u0627\u0641\u064A\u0629.",
      nextDay: "\u0627\u0644\u064A\u0648\u0645 \u0627\u0644\u062A\u0627\u0644\u064A \u0628\u062A\u0648\u0642\u064A\u062A UTC",
      timeUntilReset: "\u0645\u062A\u0628\u0642\u064D\u0651 {time}",
      localReset: "\u0628\u062F\u0627\u064A\u0629 \u0627\u0644\u064A\u0648\u0645 \u0627\u0644\u062A\u0627\u0644\u064A (\u0628\u062A\u0648\u0642\u064A\u062A\u0643 \u0627\u0644\u0645\u062D\u0644\u064A): {time}",
      achievements: "\u0627\u0644\u0625\u0646\u062C\u0627\u0632\u0627\u062A",
      offlineAchievements: "\u0627\u0644\u0625\u0646\u062C\u0627\u0632\u0627\u062A \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644",
      weekRule: "\u062A\u0643\u0641\u064A \u0646\u0642\u0631\u0629 \u0645\u062D\u0641\u0648\u0638\u0629 \u0648\u0627\u062D\u062F\u0629 \u0644\u0627\u062D\u062A\u0633\u0627\u0628 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u060C \u0645\u0646 \u0627\u0644\u0627\u062B\u0646\u064A\u0646 \u0625\u0644\u0649 \u0627\u0644\u0623\u062D\u062F (UTC).",
      firstClick: "\u0627\u062D\u0641\u0638 \u0646\u0642\u0631\u062A\u0643 \u0627\u0644\u0623\u0648\u0644\u0649.",
      clickMilestone: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0646\u0642\u0631\u0627\u062A {count}.",
      consecutiveDays: "{duration} \u0645\u062A\u062A\u0627\u0644\u064A\u0629 \u0628\u062A\u0648\u0642\u064A\u062A UTC. \u0627\u0646\u0642\u0631 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0643\u0644 \u064A\u0648\u0645.",
      consecutiveWeeks: "{duration} \u0645\u062A\u062A\u0627\u0644\u064A\u0629 \u0628\u062A\u0648\u0642\u064A\u062A UTC. \u0627\u0646\u0642\u0631 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0643\u0644 \u0623\u0633\u0628\u0648\u0639.",
      dayClickGoal: "{count} \u0646\u0642\u0631\u0629 \u0641\u064A \u064A\u0648\u0645 \u0648\u0627\u062D\u062F \u0628\u062A\u0648\u0642\u064A\u062A UTC.",
      weekClickGoal: "{count} \u0646\u0642\u0631\u0629 \u0641\u064A \u0623\u0633\u0628\u0648\u0639 \u0648\u0627\u062D\u062F \u0628\u062A\u0648\u0642\u064A\u062A UTC (\u0645\u0646 \u0627\u0644\u0627\u062B\u0646\u064A\u0646 \u0625\u0644\u0649 \u0627\u0644\u0623\u062D\u062F).",
      monthClickGoal: "{count} \u0646\u0642\u0631\u0629 \u0641\u064A \u0634\u0647\u0631 \u062A\u0642\u0648\u064A\u0645\u064A \u0648\u0627\u062D\u062F \u0628\u062A\u0648\u0642\u064A\u062A UTC.",
      distinctHoursGoal: "\u0627\u0646\u0642\u0631 \u0641\u064A {count} \u0633\u0627\u0639\u0627\u062A \u0645\u062E\u062A\u0644\u0641\u0629 \u0645\u0646 \u0627\u0644\u064A\u0648\u0645 \u0646\u0641\u0633\u0647 \u0628\u062A\u0648\u0642\u064A\u062A UTC.",
      distinctDaysGoal: "\u0627\u0646\u0642\u0631 \u0641\u064A {count} \u0623\u064A\u0627\u0645 \u0645\u062E\u062A\u0644\u0641\u0629 \u0628\u062A\u0648\u0642\u064A\u062A UTC. \u064A\u0645\u0643\u0646 \u0623\u0646 \u062A\u0643\u0648\u0646 \u063A\u064A\u0631 \u0645\u062A\u062A\u0627\u0644\u064A\u0629.",
      distinctMonthsGoal: "\u0627\u0646\u0642\u0631 \u0641\u064A {count} \u0623\u0634\u0647\u0631 \u062A\u0642\u0648\u064A\u0645\u064A\u0629 \u0645\u062E\u062A\u0644\u0641\u0629 \u0628\u062A\u0648\u0642\u064A\u062A UTC. \u064A\u0645\u0643\u0646 \u0623\u0646 \u062A\u0643\u0648\u0646 \u063A\u064A\u0631 \u0645\u062A\u062A\u0627\u0644\u064A\u0629.",
      otherAchievementsGoal: "\u062D\u0642\u0642 {count} \u0625\u0646\u062C\u0627\u0632\u0627\u062A \u0623\u062E\u0631\u0649.",
      earned: "\u062A\u0645 \u062A\u062D\u0642\u064A\u0642\u0647",
      locked: "\u0645\u0642\u0641\u0644",
      allAchievements: "\u0627\u0644\u0643\u0644",
      filterAchievements: "\u062A\u0635\u0641\u064A\u0629 \u0627\u0644\u0625\u0646\u062C\u0627\u0632\u0627\u062A",
      revealRequirements: "\u0625\u0638\u0647\u0627\u0631 \u0634\u0631\u0648\u0637 \u0627\u0644\u0625\u0646\u062C\u0627\u0632\u0627\u062A \u0627\u0644\u0645\u0642\u0641\u0644\u0629",
      allAchievementsEarned: "\u0644\u0642\u062F \u062D\u0635\u0644\u062A \u0639\u0644\u0649 \u062C\u0645\u064A\u0639 \u0627\u0644\u0625\u0646\u062C\u0627\u0632\u0627\u062A.",
      noAchievementsEarned: "\u0644\u0645 \u062A\u062D\u0635\u0644 \u0639\u0644\u0649 \u0623\u064A \u0625\u0646\u062C\u0627\u0632 \u0628\u0639\u062F.",
      achievementUnlocked: "\u062A\u0645 \u0641\u062A\u062D \u0625\u0646\u062C\u0627\u0632",
      achievementsUnlocked: "\u062A\u0645 \u0641\u062A\u062D \u0639\u062F\u0629 \u0625\u0646\u062C\u0627\u0632\u0627\u062A",
      language: "\u0627\u0644\u0644\u063A\u0629",
      account: "\u0627\u0644\u062D\u0633\u0627\u0628",
      localGame: "\u0644\u0639\u0628\u0629 \u0645\u062D\u0644\u064A\u0629",
      languageHint: "\u0644\u063A\u0629 \u0627\u0644\u0644\u0639\u0628\u0629 \xB7 \u062A\u064F\u062D\u0641\u0638 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u062A\u0635\u0641\u062D",
      languageVisit: "\u0644\u063A\u0629 \u0627\u0644\u0644\u0639\u0628\u0629 \xB7 \u0645\u0637\u0628\u0651\u0642\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0632\u064A\u0627\u0631\u0629\u061B \u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u063A\u064A\u0631 \u0645\u062A\u0627\u062D",
      skip: "\u0627\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u062D\u062A\u0648\u0649",
      game: "\u0627\u0644\u0639\u0628 Go Click",
      savedClicks: "\u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629",
      localClicks: "\u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0627\u0644\u0645\u062D\u0644\u064A\u0629",
      click: "\u0627\u0646\u0642\u0631",
      clickAction: "\u0625\u0636\u0627\u0641\u0629 \u0646\u0642\u0631\u0629",
      outletTest: "\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0645\u0642\u0628\u0633",
      cordSlack: "\u0625\u0631\u062E\u0627\u0621 \u0627\u0644\u0633\u0644\u0643",
      reconnectPlug: "\u0625\u0639\u0627\u062F\u0629 \u062A\u0648\u0635\u064A\u0644 \u0627\u0644\u0642\u0627\u0628\u0633",
      feedbackWaiting: "\u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631",
      feedbackUnconfirmed: "\u063A\u064A\u0631 \u0645\u0624\u0643\u062F\u0629",
      feedbackUnsaved: "\u0644\u0645 \u062A\u064F\u062D\u0641\u0638",
      feedbackCooldown: "\u0641\u062A\u0631\u0629 \u0627\u0646\u062A\u0638\u0627\u0631",
      feedbackAwaitingHint: "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062D\u0641\u0638 \xB7 \u0627\u0644\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0623\u062E\u064A\u0631 {average}",
      feedbackSavedHint: "\u062A\u0645 \u0627\u0644\u062D\u0641\u0638 \xB7 {time} \xB7 \u0627\u0644\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0623\u062E\u064A\u0631 {average}",
      feedbackSimulatedHint: "\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0645\u062D\u0627\u0643\u0627\u0629 \xB7 {time} \xB7 \u0627\u0644\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u0623\u062E\u064A\u0631 {average}",
      copyChanged: "\u062A\u063A\u064A\u0651\u0631\u062A \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629. \u0627\u0646\u0633\u062E \u0645\u062C\u062F\u062F\u064B\u0627 \u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u062D\u062F\u0651\u062B.",
      lastClick: "\u0622\u062E\u0631 \u0646\u0642\u0631\u0629: {time}",
      timezone: "\u064A\u064F\u0639\u0631\u0636 \u0628\u062A\u0648\u0642\u064A\u062A\u0643 \u0627\u0644\u0645\u062D\u0644\u064A",
      refresh: "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0639\u062F\u0627\u062F",
      share: "\u0645\u0634\u0627\u0631\u0643\u0629",
      shareHint: "\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A \u0642\u0628\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629",
      ping: "\u0632\u0645\u0646 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629",
      simPing: "\u0632\u0645\u0646 \u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0645\u062D\u0627\u0643\u0649",
      pingHint: "\u0645\u062F\u0629 \u0622\u062E\u0631 \u0637\u0644\u0628 \u0646\u0642\u0631\u0629 \u0646\u0627\u062C\u062D \u0630\u0647\u0627\u0628\u064B\u0627 \u0648\u0625\u064A\u0627\u0628\u064B\u0627. \u062A\u0634\u064A\u0631 \u0646\u0642\u0637\u0629 \u0627\u0644\u062D\u0627\u0644\u0629 \u0625\u0644\u0649 \u0637\u0644\u0628\u0627\u062A \u0645\u0639\u0644\u0651\u0642\u0629 \u0623\u0648 \u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u062D\u0641\u0638.",
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
      networkNotice: "\u0623\u0646\u062A \u063A\u064A\u0631 \u0645\u062A\u0635\u0644. \u0627\u0644\u0646\u0642\u0631 \u0645\u062A\u0648\u0642\u0641 \u0645\u0624\u0642\u062A\u064B\u0627. \u0633\u064A\u064F\u062D\u062F\u064E\u0651\u062B \u062A\u0642\u062F\u0645\u0643 \u0627\u0644\u0645\u062D\u0641\u0648\u0638 \u0639\u0646\u062F \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644.",
      playingOffline: "\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0644\u0639\u0628 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644.",
      offline: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644",
      backOnline: "\u0627\u0644\u0639\u0648\u062F\u0629 \u0644\u0644\u0627\u062A\u0635\u0627\u0644",
      signOut: "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C",
      homeGreeting: "\u0627\u0646\u0642\u0631 \u0644\u0644\u0639\u0628 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644\u060C \u0623\u0648 \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0644\u062D\u0641\u0638 \u0646\u0642\u0631\u0627\u062A\u0643 \u0641\u064A \u062D\u0633\u0627\u0628\u0643.",
      signIn: "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644",
      createAccount: "\u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628",
      loadingCounter: "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0639\u062F\u0627\u062F\u2026",
      tryAgain: "\u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u064B\u0627",
      admin: "\u0627\u0644\u0625\u062F\u0627\u0631\u0629",
      options: "\u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A",
      sound: "\u0627\u0644\u0645\u0624\u062B\u0631\u0627\u062A \u0627\u0644\u0635\u0648\u062A\u064A\u0629",
      soundOn: "\u0627\u0644\u0635\u0648\u062A \u0645\u0641\u0639\u0651\u0644 \xB7 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0645\u0624\u062B\u0631\u0627\u062A \u0627\u0644\u0635\u0648\u062A\u064A\u0629",
      soundOff: "\u0627\u0644\u0635\u0648\u062A \u0645\u062A\u0648\u0642\u0641 \xB7 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0624\u062B\u0631\u0627\u062A \u0627\u0644\u0635\u0648\u062A\u064A\u0629",
      motion: "\u062A\u0641\u0639\u064A\u0644 \u062A\u0623\u062B\u064A\u0631\u0627\u062A \u0627\u0644\u062D\u0631\u0643\u0629",
      motionHint: "\u062A\u0642\u0644\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0629 \u0645\u0641\u0639\u0651\u0644. \u062A\u0641\u0639\u064A\u0644 \u062A\u0623\u062B\u064A\u0631\u0627\u062A \u0627\u0644\u062D\u0631\u0643\u0629.",
      controls: "\u0627\u0636\u063A\u0637 \u0628\u0627\u0644\u0641\u0623\u0631\u0629 \u0623\u0648 \u0628\u0627\u0644\u0644\u0645\u0633\u060C \u062B\u0645 \u0623\u0641\u0644\u062A \u0641\u0648\u0642 \u0627\u0644\u0632\u0631 \u0623\u0648 \u0628\u0627\u0644\u0642\u0631\u0628 \u0645\u0646\u0647. \u064A\u064F\u062D\u0633\u0628 \u0643\u0644 \u0625\u0635\u0628\u0639 \u0639\u0644\u0649 \u062D\u062F\u0629. \u0639\u0646\u062F\u0645\u0627 \u064A\u0643\u0648\u0646 \u0627\u0644\u0632\u0631 \u0645\u0648\u0636\u0639 \u0627\u0644\u062A\u0631\u0643\u064A\u0632\u060C \u0623\u0641\u0644\u062A \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0623\u0648 Enter \u0644\u0625\u0636\u0627\u0641\u0629 \u0646\u0642\u0631\u0629 \u0648\u0627\u062D\u062F\u0629. \u0644\u0627 \u064A\u0636\u064A\u0641 \u0627\u0644\u0636\u063A\u0637 \u0627\u0644\u0645\u0637\u0648\u0651\u0644 \u0646\u0642\u0631\u0627\u062A.",
      loadError: "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0639\u062F\u0627\u062F. \u062D\u0627\u0648\u0644 \u062A\u062D\u062F\u064A\u062B\u0647.",
      unconfirmedClick: "\u062A\u0639\u0630\u0651\u0631 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0646\u0642\u0631\u0629. \u062D\u062F\u0651\u062B \u0627\u0644\u0639\u062F\u0627\u062F \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u062D\u0641\u0638\u0647\u0627.",
      unsavedClick: "\u0644\u0645 \u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0646\u0642\u0631\u0629. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u062A\u0635\u0627\u0644\u0643 \u0648\u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u064B\u0627.",
      localLoadError: "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u0645\u062D\u0644\u064A. \u0627\u0641\u062A\u062D \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0646\u0633\u062E\u0629 \u0623\u0648 \u0628\u062F\u0621 \u062D\u0641\u0638 \u062C\u062F\u064A\u062F.",
      localClickError: "\u0644\u0645 \u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0646\u0642\u0631\u0629 \u0645\u062D\u0644\u064A\u064B\u0627. \u0642\u062F \u062A\u0643\u0648\u0646 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0645\u0645\u062A\u0644\u0626\u0629 \u0623\u0648 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629.",
      signOutError: "\u062A\u0639\u0630\u0651\u0631 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C. \u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u064B\u0627.",
      shareTitle: "\u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A",
      done: "\u062A\u0645",
      shareInstructions: "\u0627\u062E\u062A\u0631 \u0645\u0627 \u062A\u0631\u064A\u062F \u062A\u0636\u0645\u064A\u0646\u0647\u060C \u062B\u0645 \u0627\u0646\u0633\u062E \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629.",
      include: "\u062A\u0636\u0645\u064A\u0646",
      siteLink: "\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0648\u0642\u0639",
      clickTotal: "\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0646\u0642\u0631\u0627\u062A",
      shareDataNote: "\u064A\u0634\u0645\u0644 \u0627\u0644\u0645\u062C\u0645\u0648\u0639 \u0643\u0644 \u0627\u0644\u0646\u0642\u0631\u0627\u062A \u0641\u064A \u0627\u0644\u062D\u0641\u0638 \u0627\u0644\u062D\u0627\u0644\u064A.",
      preview: "\u0645\u0639\u0627\u064A\u0646\u0629",
      statsToShare: "\u0625\u062D\u0635\u0627\u0621\u0627\u062A \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629",
      copyText: "\u0646\u0633\u062E \u0627\u0644\u0646\u0635",
      copied: "\u062A\u0645 \u0646\u0633\u062E \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A.",
      clipboardUnavailable: "\u0627\u0644\u062D\u0627\u0641\u0638\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629. \u062D\u062F\u0651\u062F \u0646\u0635 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0648\u0627\u0646\u0633\u062E\u0647.",
      statsClicks: "{label}: {count}",
      statsStreaks: "\u0627\u0644\u0633\u0644\u0627\u0633\u0644 \u0628\u062A\u0648\u0642\u064A\u062A UTC: {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "\u0627\u0644\u0639\u0628: {url}"
    },
    hi: {
      ...optionsTranslations["hi"],
      fortnightActivity: "14 \u0926\u093F\u0928\u094B\u0902 \u0915\u0940 \u0917\u0924\u093F\u0935\u093F\u0927\u093F",
      outOf: "{count} / {total}",
      daysActive: "\u0938\u0915\u094D\u0930\u093F\u092F \u0926\u093F\u0928: {count}",
      activityNote: "\u092A\u093F\u091B\u0932\u0947 \u0938\u0947\u0935 \u0915\u093F\u090F \u0917\u090F \u0915\u094D\u0932\u093F\u0915 \u0915\u0947 \u0926\u093F\u0928 \u0924\u0915 \u0915\u0947 14 \u0926\u093F\u0928\u094B\u0902 \u0915\u093E \u0939\u093F\u0938\u093E\u092C\u0964 \u0932\u0917\u093E\u0924\u093E\u0930 \u0915\u0908 \u0926\u093F\u0928\u094B\u0902 \u0924\u0915 \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0928\u0947 \u092A\u0930 \u092C\u094B\u0928\u0938 \u0905\u0902\u0915 \u092E\u093F\u0932\u0924\u0947 \u0939\u0948\u0902\u0964",
      nextDay: "\u0905\u0917\u0932\u093E UTC \u0926\u093F\u0928",
      timeUntilReset: "{time} \u0936\u0947\u0937",
      localReset: "\u0926\u093F\u0928 \u092C\u0926\u0932\u0928\u0947 \u0915\u093E \u0938\u092E\u092F (\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u092E\u092F): {time}",
      achievements: "\u0909\u092A\u0932\u092C\u094D\u0927\u093F\u092F\u093E\u0901",
      offlineAchievements: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0909\u092A\u0932\u092C\u094D\u0927\u093F\u092F\u093E\u0901",
      weekRule: "\u0938\u094B\u092E\u0935\u093E\u0930 \u0938\u0947 \u0930\u0935\u093F\u0935\u093E\u0930 (UTC) \u0915\u0947 \u092C\u0940\u091A \u090F\u0915 \u0938\u0939\u0947\u091C\u093E \u0917\u092F\u093E \u0915\u094D\u0932\u093F\u0915 \u0909\u0938 \u0938\u092A\u094D\u0924\u093E\u0939 \u0915\u0947 \u0932\u093F\u090F \u0915\u093E\u092B\u093C\u0940 \u0939\u0948\u0964",
      firstClick: "\u0905\u092A\u0928\u093E \u092A\u0939\u0932\u093E \u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u0947\u0902\u0964",
      clickMilestone: "\u0915\u0941\u0932 {count} \u0915\u094D\u0932\u093F\u0915\u0964",
      consecutiveDays: "\u0932\u0917\u093E\u0924\u093E\u0930 {duration} \u0924\u0915 \u0939\u0930 \u0926\u093F\u0928 \u0915\u092E \u0938\u0947 \u0915\u092E \u090F\u0915 \u092C\u093E\u0930 \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0947\u0902 (UTC)\u0964",
      consecutiveWeeks: "\u0932\u0917\u093E\u0924\u093E\u0930 {duration} \u0924\u0915 \u0939\u0930 \u0939\u092B\u093C\u094D\u0924\u0947 \u0915\u092E \u0938\u0947 \u0915\u092E \u090F\u0915 \u092C\u093E\u0930 \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0947\u0902 (UTC)\u0964",
      dayClickGoal: "\u090F\u0915 \u0939\u0940 UTC \u0926\u093F\u0928 \u092E\u0947\u0902 {count} \u0915\u094D\u0932\u093F\u0915\u0964",
      weekClickGoal: "\u090F\u0915 \u0939\u0940 UTC \u0939\u092B\u093C\u094D\u0924\u0947 \u092E\u0947\u0902 {count} \u0915\u094D\u0932\u093F\u0915 (\u0938\u094B\u092E\u0935\u093E\u0930 \u0938\u0947 \u0930\u0935\u093F\u0935\u093E\u0930)\u0964",
      monthClickGoal: "UTC \u0915\u0947 \u0939\u093F\u0938\u093E\u092C \u0938\u0947 \u090F\u0915 \u0939\u0940 \u0915\u0948\u0932\u0947\u0902\u0921\u0930 \u092E\u0939\u0940\u0928\u0947 \u092E\u0947\u0902 {count} \u0915\u094D\u0932\u093F\u0915\u0964",
      distinctHoursGoal: "\u090F\u0915 \u0939\u0940 UTC \u0926\u093F\u0928 \u092E\u0947\u0902 {count} \u0905\u0932\u0917-\u0905\u0932\u0917 \u0918\u0902\u091F\u094B\u0902 \u092E\u0947\u0902 \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0947\u0902\u0964",
      distinctDaysGoal: "{count} \u0905\u0932\u0917-\u0905\u0932\u0917 UTC \u0926\u093F\u0928\u094B\u0902 \u092E\u0947\u0902 \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0947\u0902\u0964 \u092C\u0940\u091A \u092E\u0947\u0902 \u0905\u0902\u0924\u0930 \u0939\u094B \u0938\u0915\u0924\u093E \u0939\u0948\u0964",
      distinctMonthsGoal: "UTC \u0915\u0947 \u0939\u093F\u0938\u093E\u092C \u0938\u0947 {count} \u0905\u0932\u0917-\u0905\u0932\u0917 \u0915\u0948\u0932\u0947\u0902\u0921\u0930 \u092E\u0939\u0940\u0928\u094B\u0902 \u092E\u0947\u0902 \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0947\u0902\u0964 \u092C\u0940\u091A \u092E\u0947\u0902 \u0905\u0902\u0924\u0930 \u0939\u094B \u0938\u0915\u0924\u093E \u0939\u0948\u0964",
      otherAchievementsGoal: "{count} \u0905\u0928\u094D\u092F \u0909\u092A\u0932\u092C\u094D\u0927\u093F\u092F\u093E\u0901 \u0939\u093E\u0938\u093F\u0932 \u0915\u0930\u0947\u0902\u0964",
      earned: "\u092A\u094D\u0930\u093E\u092A\u094D\u0924",
      locked: "\u0932\u0949\u0915 \u0939\u0948",
      allAchievements: "\u0938\u092D\u0940",
      filterAchievements: "\u0909\u092A\u0932\u092C\u094D\u0927\u093F\u092F\u093E\u0901 \u091B\u093E\u0901\u091F\u0947\u0902",
      revealRequirements: "\u0932\u0949\u0915 \u0915\u0940 \u0917\u0908 \u0909\u092A\u0932\u092C\u094D\u0927\u093F\u092F\u094B\u0902 \u0915\u0940 \u0936\u0930\u094D\u0924\u0947\u0902 \u0926\u093F\u0916\u093E\u090F\u0901",
      allAchievementsEarned: "\u0906\u092A\u0928\u0947 \u0938\u092D\u0940 \u0909\u092A\u0932\u092C\u094D\u0927\u093F\u092F\u093E\u0901 \u0939\u093E\u0938\u093F\u0932 \u0915\u0930 \u0932\u0940 \u0939\u0948\u0902\u0964",
      noAchievementsEarned: "\u0905\u092D\u0940 \u0915\u094B\u0908 \u0909\u092A\u0932\u092C\u094D\u0927\u093F \u0939\u093E\u0938\u093F\u0932 \u0928\u0939\u0940\u0902 \u0939\u0941\u0908 \u0939\u0948\u0964",
      achievementUnlocked: "\u0909\u092A\u0932\u092C\u094D\u0927\u093F \u0905\u0928\u0932\u0949\u0915 \u0939\u0941\u0908",
      achievementsUnlocked: "\u0909\u092A\u0932\u092C\u094D\u0927\u093F\u092F\u093E\u0901 \u0905\u0928\u0932\u0949\u0915 \u0939\u0941\u0908\u0902",
      language: "\u092D\u093E\u0937\u093E",
      account: "\u0916\u093E\u0924\u093E",
      localGame: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0916\u0947\u0932",
      languageHint: "\u0916\u0947\u0932 \u0915\u0940 \u092D\u093E\u0937\u093E \xB7 \u0907\u0938 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u092E\u0947\u0902 \u092F\u093E\u0926 \u0930\u0916\u0940 \u091C\u093E\u090F\u0917\u0940",
      languageVisit: "\u0916\u0947\u0932 \u0915\u0940 \u092D\u093E\u0937\u093E \xB7 \u0907\u0938 \u092C\u093E\u0930 \u0932\u093E\u0917\u0942; \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u0938\u094D\u091F\u094B\u0930\u0947\u091C \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948",
      skip: "\u0938\u093E\u092E\u0917\u094D\u0930\u0940 \u092A\u0930 \u091C\u093E\u090F\u0901",
      game: "Go Click \u0916\u0947\u0932\u0947\u0902",
      savedClicks: "\u0938\u0939\u0947\u091C\u0947 \u0917\u090F \u0915\u094D\u0932\u093F\u0915",
      localClicks: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0915\u094D\u0932\u093F\u0915",
      click: "\u0915\u094D\u0932\u093F\u0915",
      clickAction: "\u090F\u0915 \u0915\u094D\u0932\u093F\u0915 \u091C\u094B\u0921\u093C\u0947\u0902",
      outletTest: "\u0938\u0949\u0915\u0947\u091F \u0915\u0940 \u091C\u093E\u0901\u091A",
      cordSlack: "\u0924\u093E\u0930 \u0922\u0940\u0932\u0940 \u0915\u0930\u0947\u0902",
      reconnectPlug: "\u092A\u094D\u0932\u0917 \u092B\u093F\u0930 \u0938\u0947 \u0932\u0917\u093E\u090F\u0901",
      feedbackWaiting: "\u092A\u094D\u0930\u0924\u0940\u0915\u094D\u0937\u093E \u091C\u093E\u0930\u0940",
      feedbackUnconfirmed: "\u0905\u092A\u0941\u0937\u094D\u091F",
      feedbackUnsaved: "\u0938\u0939\u0947\u091C\u093E \u0928\u0939\u0940\u0902 \u0917\u092F\u093E",
      feedbackCooldown: "\u0935\u093F\u0930\u093E\u092E",
      feedbackAwaitingHint: "\u0938\u0939\u0947\u091C\u0928\u0947 \u0915\u0940 \u092A\u094D\u0930\u0924\u0940\u0915\u094D\u0937\u093E \xB7 \u0939\u093E\u0932 \u0915\u093E \u0914\u0938\u0924 {average}",
      feedbackSavedHint: "\u0938\u0939\u0947\u091C\u093E \u0917\u092F\u093E \xB7 {time} \xB7 \u0939\u093E\u0932 \u0915\u093E \u0914\u0938\u0924 {average}",
      feedbackSimulatedHint: "\u0938\u093F\u092E\u094D\u092F\u0941\u0932\u0947\u091F\u0947\u0921 \u092A\u094D\u0930\u0924\u093F\u0915\u094D\u0930\u093F\u092F\u093E \xB7 {time} \xB7 \u0939\u093E\u0932 \u0915\u093E \u0914\u0938\u0924 {average}",
      copyChanged: "\u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928 \u092C\u0926\u0932 \u0917\u092F\u093E \u0939\u0948\u0964 \u0928\u092F\u093E \u091F\u0947\u0915\u094D\u0938\u094D\u091F \u0938\u093E\u091D\u093E \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u092B\u093F\u0930 \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902\u0964",
      lastClick: "\u092A\u093F\u091B\u0932\u093E \u0915\u094D\u0932\u093F\u0915: {time}",
      timezone: "\u0906\u092A\u0915\u0947 \u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0938\u092E\u092F \u0915\u094D\u0937\u0947\u0924\u094D\u0930 \u092E\u0947\u0902 \u0926\u093F\u0916\u093E\u092F\u093E \u0917\u092F\u093E \u0939\u0948",
      refresh: "\u0915\u093E\u0909\u0902\u091F\u0930 \u0930\u0940\u092B\u093C\u094D\u0930\u0947\u0936 \u0915\u0930\u0947\u0902",
      share: "\u0938\u093E\u091D\u093E \u0915\u0930\u0947\u0902",
      shareHint: "\u0938\u093E\u091D\u093E \u0915\u0930\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947 \u0906\u0901\u0915\u0921\u093C\u094B\u0902 \u0915\u093E \u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928 \u0915\u0930\u0947\u0902",
      ping: "\u092A\u093F\u0902\u0917",
      simPing: "\u0938\u093F\u092E\u094D\u092F\u0941\u0932\u0947\u091F\u0947\u0921 \u092A\u093F\u0902\u0917",
      pingHint: "\u092A\u093F\u091B\u0932\u0947 \u0938\u092B\u0932 \u0915\u094D\u0932\u093F\u0915 \u0905\u0928\u0941\u0930\u094B\u0927 \u0915\u093E \u0906\u0928\u0947-\u091C\u093E\u0928\u0947 \u0915\u093E \u0938\u092E\u092F\u0964 \u0938\u094D\u0925\u093F\u0924\u093F \u092C\u093F\u0902\u0926\u0941 \u0932\u0902\u092C\u093F\u0924 \u0905\u0928\u0941\u0930\u094B\u0927 \u092F\u093E \u0938\u0939\u0947\u091C\u0928\u0947 \u0915\u0940 \u0924\u094D\u0930\u0941\u091F\u093F \u0926\u093F\u0916\u093E\u0924\u093E \u0939\u0948\u0964",
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
      streaks: "\u0932\u0917\u093E\u0924\u093E\u0930 \u0916\u0947\u0932\u0928\u0947 \u0915\u0947 \u0915\u094D\u0930\u092E",
      streakLabel: "\u0932\u0917\u093E\u0924\u093E\u0930 \u0916\u0947\u0932\u0928\u0947 \u0915\u0947 \u0915\u094D\u0930\u092E",
      networkNotice: "\u0906\u092A \u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0939\u0948\u0902\u0964 \u0915\u094D\u0932\u093F\u0915 \u0930\u0941\u0915\u0947 \u0939\u0941\u090F \u0939\u0948\u0902\u0964 \u0926\u094B\u092C\u093E\u0930\u093E \u091C\u0941\u0921\u093C\u0928\u0947 \u092A\u0930 \u0938\u0939\u0947\u091C\u0940 \u0917\u0908 \u092A\u094D\u0930\u0917\u0924\u093F \u0930\u0940\u092B\u093C\u094D\u0930\u0947\u0936 \u0939\u094B\u0917\u0940\u0964",
      playingOffline: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0916\u0947\u0932 \u091C\u093E\u0930\u0940 \u0939\u0948\u0964",
      offline: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928",
      backOnline: "\u0911\u0928\u0932\u093E\u0907\u0928 \u0932\u094C\u091F\u0947\u0902",
      signOut: "\u0938\u093E\u0907\u0928 \u0906\u0909\u091F \u0915\u0930\u0947\u0902",
      homeGreeting: "\u0911\u092B\u093C\u0932\u093E\u0907\u0928 \u0916\u0947\u0932\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0947\u0902, \u092F\u093E \u0905\u092A\u0928\u0947 \u0916\u093E\u0924\u0947 \u092E\u0947\u0902 \u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0938\u093E\u0907\u0928 \u0907\u0928 \u0915\u0930\u0947\u0902\u0964",
      signIn: "\u0938\u093E\u0907\u0928 \u0907\u0928 \u0915\u0930\u0947\u0902",
      createAccount: "\u0916\u093E\u0924\u093E \u092C\u0928\u093E\u090F\u0901",
      loadingCounter: "\u0915\u093E\u0909\u0902\u091F\u0930 \u0932\u094B\u0921 \u0939\u094B \u0930\u0939\u093E \u0939\u0948\u2026",
      tryAgain: "\u092B\u093F\u0930 \u0915\u094B\u0936\u093F\u0936 \u0915\u0930\u0947\u0902",
      admin: "\u0935\u094D\u092F\u0935\u0938\u094D\u0925\u093E\u092A\u0928",
      options: "\u0935\u093F\u0915\u0932\u094D\u092A",
      sound: "\u0927\u094D\u0935\u0928\u093F \u092A\u094D\u0930\u092D\u093E\u0935",
      soundOn: "\u0927\u094D\u0935\u0928\u093F \u091A\u093E\u0932\u0942 \xB7 \u0927\u094D\u0935\u0928\u093F \u092A\u094D\u0930\u092D\u093E\u0935 \u092C\u0902\u0926 \u0915\u0930\u0947\u0902",
      soundOff: "\u0927\u094D\u0935\u0928\u093F \u092C\u0902\u0926 \xB7 \u0927\u094D\u0935\u0928\u093F \u092A\u094D\u0930\u092D\u093E\u0935 \u091A\u093E\u0932\u0942 \u0915\u0930\u0947\u0902",
      motion: "\u0910\u0928\u093F\u092E\u0947\u0936\u0928 \u091A\u093E\u0932\u0942 \u0915\u0930\u0947\u0902",
      motionHint: "\u0910\u0928\u093F\u092E\u0947\u0936\u0928 \u0914\u0930 \u091A\u092E\u0915 \u0935\u093E\u0932\u0947 \u0907\u092B\u093C\u0947\u0915\u094D\u091F \u092C\u0902\u0926 \u0939\u0948\u0902\u0964 \u0909\u0928\u094D\u0939\u0947\u0902 \u091A\u093E\u0932\u0942 \u0915\u0930\u0947\u0902\u0964",
      controls: "\u092E\u093E\u0909\u0938 \u092F\u093E \u0938\u094D\u092A\u0930\u094D\u0936 \u0938\u0947 \u0926\u092C\u093E\u090F\u0901, \u092B\u093F\u0930 \u092C\u091F\u0928 \u092A\u0930 \u092F\u093E \u0909\u0938\u0915\u0947 \u092A\u093E\u0938 \u091B\u094B\u0921\u093C\u0947\u0902\u0964 \u0939\u0930 \u0909\u0901\u0917\u0932\u0940 \u0905\u0932\u0917 \u0917\u093F\u0928\u0940 \u091C\u093E\u0924\u0940 \u0939\u0948\u0964 \u092C\u091F\u0928 \u092A\u0930 \u092B\u093C\u094B\u0915\u0938 \u0939\u094B\u0928\u0947 \u092A\u0930 \u0938\u094D\u092A\u0947\u0938 \u092F\u093E \u090F\u0902\u091F\u0930 \u091B\u094B\u0921\u093C\u0928\u0947 \u0938\u0947 \u090F\u0915 \u0915\u094D\u0932\u093F\u0915 \u091C\u0941\u0921\u093C\u0924\u093E \u0939\u0948\u0964 \u0926\u092C\u093E\u090F \u0930\u0916\u0928\u0947 \u0938\u0947 \u0905\u0924\u093F\u0930\u093F\u0915\u094D\u0924 \u0915\u094D\u0932\u093F\u0915 \u0928\u0939\u0940\u0902 \u091C\u0941\u0921\u093C\u0924\u0947\u0964",
      loadError: "\u0915\u093E\u0909\u0902\u091F\u0930 \u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u0941\u0906\u0964 \u0909\u0938\u0947 \u0930\u0940\u092B\u093C\u094D\u0930\u0947\u0936 \u0915\u0930\u0915\u0947 \u0926\u0947\u0916\u0947\u0902\u0964",
      unconfirmedClick: "\u0915\u094D\u0932\u093F\u0915 \u0915\u0940 \u092A\u0941\u0937\u094D\u091F\u093F \u0928\u0939\u0940\u0902 \u0939\u0941\u0908\u0964 \u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u093E \u0917\u092F\u093E \u092F\u093E \u0928\u0939\u0940\u0902, \u092F\u0939 \u0926\u0947\u0916\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0915\u093E\u0909\u0902\u091F\u0930 \u0930\u0940\u092B\u093C\u094D\u0930\u0947\u0936 \u0915\u0930\u0947\u0902\u0964",
      unsavedClick: "\u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u093E \u0928\u0939\u0940\u0902 \u0917\u092F\u093E\u0964 \u0915\u0928\u0947\u0915\u094D\u0936\u0928 \u091C\u093E\u0901\u091A\u0947\u0902 \u0914\u0930 \u092B\u093F\u0930 \u0915\u094B\u0936\u093F\u0936 \u0915\u0930\u0947\u0902\u0964",
      localLoadError: "\u0932\u094B\u0915\u0932 \u0938\u0947\u0935 \u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u094B \u0938\u0915\u093E\u0964 \u0935\u093F\u0915\u0932\u094D\u092A \u0916\u094B\u0932\u0947\u0902 \u0914\u0930 \u0909\u0938\u0915\u0940 \u0915\u0949\u092A\u0940 \u0907\u0902\u092A\u094B\u0930\u094D\u091F \u0915\u0930\u0947\u0902 \u092F\u093E \u0938\u0947\u0935 \u092B\u093F\u0930 \u0938\u0947 \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902\u0964",
      localClickError: "\u0938\u094D\u0925\u093E\u0928\u0940\u092F \u0915\u094D\u0932\u093F\u0915 \u0938\u0939\u0947\u091C\u093E \u0928\u0939\u0940\u0902 \u0917\u092F\u093E\u0964 \u092C\u094D\u0930\u093E\u0909\u091C\u093C\u0930 \u0938\u094D\u091F\u094B\u0930\u0947\u091C \u092D\u0930\u093E \u092F\u093E \u0905\u0928\u0941\u092A\u0932\u092C\u094D\u0927 \u0939\u094B \u0938\u0915\u0924\u093E \u0939\u0948\u0964",
      signOutError: "\u0938\u093E\u0907\u0928 \u0906\u0909\u091F \u0928\u0939\u0940\u0902 \u0939\u0941\u0906\u0964 \u092B\u093F\u0930 \u0915\u094B\u0936\u093F\u0936 \u0915\u0930\u0947\u0902\u0964",
      shareTitle: "\u0906\u0901\u0915\u0921\u093C\u0947 \u0938\u093E\u091D\u093E \u0915\u0930\u0947\u0902",
      done: "\u0939\u094B \u0917\u092F\u093E",
      shareInstructions: "\u091A\u0941\u0928\u0947\u0902 \u0915\u093F \u0915\u094D\u092F\u093E \u0936\u093E\u092E\u093F\u0932 \u0915\u0930\u0928\u093E \u0939\u0948, \u092B\u093F\u0930 \u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928 \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902\u0964",
      include: "\u0936\u093E\u092E\u093F\u0932 \u0915\u0930\u0947\u0902",
      siteLink: "\u0938\u093E\u0907\u091F \u0932\u093F\u0902\u0915",
      clickTotal: "\u0915\u0941\u0932 \u0915\u094D\u0932\u093F\u0915",
      shareDataNote: "\u0915\u0941\u0932 \u092E\u0947\u0902 \u092E\u094C\u091C\u0942\u0926\u093E \u0938\u0947\u0935 \u0915\u0947 \u0938\u092D\u0940 \u0915\u094D\u0932\u093F\u0915 \u0936\u093E\u092E\u093F\u0932 \u0939\u0948\u0902\u0964",
      preview: "\u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928",
      statsToShare: "\u0938\u093E\u091D\u093E \u0915\u093F\u090F \u091C\u093E\u0928\u0947 \u0935\u093E\u0932\u0947 \u0906\u0901\u0915\u0921\u093C\u0947",
      copyText: "\u091F\u0947\u0915\u094D\u0938\u094D\u091F \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902",
      copied: "\u0906\u0901\u0915\u0921\u093C\u0947 \u0915\u0949\u092A\u0940 \u0939\u094B \u0917\u090F\u0964",
      clipboardUnavailable: "\u0915\u094D\u0932\u093F\u092A\u092C\u094B\u0930\u094D\u0921 \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964 \u092A\u0942\u0930\u094D\u0935\u093E\u0935\u0932\u094B\u0915\u0928 \u0915\u093E \u091F\u0947\u0915\u094D\u0938\u094D\u091F \u091A\u0941\u0928\u0915\u0930 \u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902\u0964",
      statsClicks: "{label}: {count}",
      statsStreaks: "\u0932\u0917\u093E\u0924\u093E\u0930 \u0916\u0947\u0932\u0928\u0947 \u0915\u0947 \u0915\u094D\u0930\u092E (UTC): {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "\u0916\u0947\u0932\u0947\u0902: {url}"
    },
    id: {
      ...optionsTranslations["id"],
      fortnightActivity: "Aktivitas dua pekan",
      outOf: "{count} / {total}",
      daysActive: "Hari aktif: {count}",
      activityNote: "Menghitung 14 hari hingga hari terakhir klik tersimpan. Klik pada hari-hari berturut-turut untuk mendapat poin bonus.",
      nextDay: "Hari UTC berikutnya",
      timeUntilReset: "Tersisa {time}",
      localReset: "Pergantian hari (waktu setempat): {time}",
      achievements: "Pencapaian",
      offlineAchievements: "Pencapaian luring",
      weekRule: "Satu klik tersimpan sudah cukup untuk satu minggu, Senin sampai Minggu (UTC).",
      firstClick: "Simpan klik pertama Anda.",
      clickMilestone: "Total {count} klik.",
      consecutiveDays: "{duration} berturut-turut (UTC). Klik setidaknya sekali setiap hari.",
      consecutiveWeeks: "{duration} berturut-turut (UTC). Klik setidaknya sekali setiap minggu.",
      dayClickGoal: "{count} klik dalam satu hari UTC.",
      weekClickGoal: "{count} klik dalam satu minggu UTC (Senin\u2013Minggu).",
      monthClickGoal: "{count} klik dalam satu bulan kalender UTC.",
      distinctHoursGoal: "Klik pada {count} jam berbeda dalam satu hari UTC.",
      distinctDaysGoal: "Klik pada {count} hari UTC yang berbeda. Tidak harus berturut-turut.",
      distinctMonthsGoal: "Klik pada {count} bulan kalender UTC yang berbeda. Tidak harus berturut-turut.",
      otherAchievementsGoal: "Raih {count} pencapaian lain.",
      earned: "Diraih",
      locked: "Terkunci",
      allAchievements: "Semua",
      filterAchievements: "Filter pencapaian",
      revealRequirements: "Tampilkan syarat pencapaian yang terkunci",
      allAchievementsEarned: "Anda sudah meraih semua pencapaian.",
      noAchievementsEarned: "Belum ada pencapaian yang diraih.",
      achievementUnlocked: "Pencapaian terbuka",
      achievementsUnlocked: "Pencapaian terbuka",
      language: "Bahasa",
      account: "Akun",
      localGame: "Permainan lokal",
      languageHint: "Bahasa permainan \xB7 disimpan di peramban ini",
      languageVisit: "Bahasa permainan \xB7 berlaku untuk kunjungan ini; penyimpanan tidak tersedia",
      skip: "Lewati ke konten",
      game: "Main Go Click",
      savedClicks: "Klik tersimpan",
      localClicks: "Klik lokal",
      click: "Klik",
      clickAction: "Tambahkan satu klik",
      outletTest: "Uji stopkontak",
      cordSlack: "Longgarkan kabel",
      reconnectPlug: "Pasang kembali steker",
      feedbackWaiting: "menunggu",
      feedbackUnconfirmed: "belum terkonfirmasi",
      feedbackUnsaved: "tidak tersimpan",
      feedbackCooldown: "jeda",
      feedbackAwaitingHint: "Menunggu penyimpanan \xB7 rata-rata terkini {average}",
      feedbackSavedHint: "Tersimpan \xB7 {time} \xB7 rata-rata terkini {average}",
      feedbackSimulatedHint: "Respons simulasi \xB7 {time} \xB7 rata-rata terkini {average}",
      copyChanged: "Pratinjau berubah. Salin lagi untuk membagikan teks terbaru.",
      lastClick: "Klik terakhir: {time}",
      timezone: "Ditampilkan dalam zona waktu lokal Anda",
      refresh: "Muat ulang penghitung",
      share: "Bagikan",
      shareHint: "Pratinjau statistik untuk dibagikan",
      ping: "Ping",
      simPing: "Ping simulasi",
      pingHint: "Waktu dari pengiriman permintaan klik terakhir yang berhasil hingga balasannya diterima. Titik status menunjukkan permintaan tertunda atau kesalahan penyimpanan.",
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
      networkNotice: "Anda sedang luring. Klik dijeda. Progres tersimpan akan diperbarui saat tersambung kembali.",
      playingOffline: "Melanjutkan permainan secara luring.",
      offline: "Luring",
      backOnline: "Kembali daring",
      signOut: "Keluar",
      homeGreeting: "Klik untuk bermain luring, atau masuk untuk menyimpan klik ke akun Anda.",
      signIn: "Masuk",
      createAccount: "Buat akun",
      loadingCounter: "Memuat penghitung\u2026",
      tryAgain: "Coba lagi",
      admin: "Admin",
      options: "Opsi",
      sound: "Efek suara",
      soundOn: "Suara aktif \xB7 Nonaktifkan efek suara",
      soundOff: "Suara nonaktif \xB7 Aktifkan efek suara",
      motion: "Aktifkan efek gerakan",
      motionHint: "Gerakan terbatas aktif. Aktifkan efek gerakan.",
      controls: "Tekan dengan tetikus atau sentuhan, lalu lepaskan di atas atau dekat tombol. Setiap jari dihitung terpisah. Saat tombol terfokus, lepas Spasi atau Enter untuk menambah satu klik. Menahan tidak menambah klik.",
      loadError: "Penghitung tidak dapat dimuat. Coba muat ulang.",
      unconfirmedClick: "Klik belum terkonfirmasi. Muat ulang penghitung untuk memeriksa apakah klik sudah tersimpan.",
      unsavedClick: "Klik Anda tidak tersimpan. Periksa koneksi dan coba lagi.",
      localLoadError: "Simpanan lokal tidak dapat dimuat. Buka Opsi untuk mengimpor salinan atau memulai ulang.",
      localClickError: "Klik lokal tidak tersimpan. Penyimpanan peramban mungkin penuh atau tidak tersedia.",
      signOutError: "Tidak dapat keluar. Silakan coba lagi.",
      shareTitle: "Bagikan statistik",
      done: "Selesai",
      shareInstructions: "Pilih yang ingin disertakan, lalu salin pratinjau.",
      include: "Sertakan",
      siteLink: "Tautan situs",
      clickTotal: "Total klik",
      shareDataNote: "Total mencakup semua klik dalam simpanan saat ini.",
      preview: "Pratinjau",
      statsToShare: "Statistik untuk dibagikan",
      copyText: "Salin teks",
      copied: "Statistik disalin.",
      clipboardUnavailable: "Papan klip tidak tersedia. Pilih dan salin teks pratinjau.",
      statsClicks: "{label}: {count}",
      statsStreaks: "Rentetan UTC: {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "Main: {url}"
    },
    "pt-BR": {
      ...optionsTranslations["pt-BR"],
      fortnightActivity: "Atividade de 14 dias",
      outOf: "{count} / {total}",
      daysActive: "Dias ativos: {count}",
      activityNote: "Conta os 14 dias at\xE9 o \xFAltimo clique salvo. Clicar em dias consecutivos rende pontos extras.",
      nextDay: "Pr\xF3ximo dia em UTC",
      timeUntilReset: "Restam {time}",
      localReset: "Mudan\xE7a de dia (hor\xE1rio local): {time}",
      achievements: "Conquistas",
      offlineAchievements: "Conquistas offline",
      weekRule: "Um clique salvo conta para a semana, de segunda a domingo (UTC).",
      firstClick: "Salve seu primeiro clique.",
      clickMilestone: "{count} cliques no total.",
      consecutiveDays: "{duration} seguidos (UTC). Clique pelo menos uma vez por dia.",
      consecutiveWeeks: "{duration} seguidas (UTC). Clique pelo menos uma vez por semana.",
      dayClickGoal: "{count} cliques em um \xFAnico dia UTC.",
      weekClickGoal: "{count} cliques em uma \xFAnica semana UTC (de segunda a domingo).",
      monthClickGoal: "{count} cliques em um \xFAnico m\xEAs do calend\xE1rio UTC.",
      distinctHoursGoal: "Clique em {count} horas distintas do mesmo dia UTC.",
      distinctDaysGoal: "Clique em {count} dias distintos em UTC. Eles podem ter intervalos.",
      distinctMonthsGoal: "Clique em {count} meses distintos do calend\xE1rio UTC. Eles podem ter intervalos.",
      otherAchievementsGoal: "Desbloqueie outras {count} conquistas.",
      earned: "Conquistado",
      locked: "Bloqueado",
      allAchievements: "Todas",
      filterAchievements: "Filtrar conquistas",
      revealRequirements: "Mostrar requisitos das conquistas bloqueadas",
      allAchievementsEarned: "Voc\xEA ganhou todas as conquistas.",
      noAchievementsEarned: "Voc\xEA ainda n\xE3o ganhou nenhuma conquista.",
      achievementUnlocked: "Conquista desbloqueada",
      achievementsUnlocked: "Conquistas desbloqueadas",
      language: "Idioma",
      account: "Conta",
      localGame: "Jogo local",
      languageHint: "Idioma do jogo \xB7 salvo neste navegador",
      languageVisit: "Idioma do jogo \xB7 aplicado nesta visita; armazenamento indispon\xEDvel",
      skip: "Pular para o conte\xFAdo",
      game: "Jogar Go Click",
      savedClicks: "Cliques salvos",
      localClicks: "Cliques locais",
      click: "Clique",
      clickAction: "Adicionar um clique",
      outletTest: "Teste da tomada",
      cordSlack: "Afrouxar o cabo",
      reconnectPlug: "Reconectar o plugue",
      feedbackWaiting: "aguardando",
      feedbackUnconfirmed: "n\xE3o confirmado",
      feedbackUnsaved: "n\xE3o salvo",
      feedbackCooldown: "pausa",
      feedbackAwaitingHint: "Aguardando salvamento \xB7 m\xE9dia recente {average}",
      feedbackSavedHint: "Salvo \xB7 {time} \xB7 m\xE9dia recente {average}",
      feedbackSimulatedHint: "Resposta simulada \xB7 {time} \xB7 m\xE9dia recente {average}",
      copyChanged: "A pr\xE9via mudou. Copie novamente para compartilhar o texto atualizado.",
      lastClick: "\xDAltimo clique: {time}",
      timezone: "Exibido no seu fuso hor\xE1rio local",
      refresh: "Atualizar contador",
      share: "Compartilhar",
      shareHint: "Pr\xE9-visualizar estat\xEDsticas para compartilhar",
      ping: "Ping",
      simPing: "Ping simulado",
      pingHint: "Tempo de ida e volta da \xFAltima solicita\xE7\xE3o de clique bem-sucedida. O ponto de status indica solicita\xE7\xF5es pendentes ou erro ao salvar.",
      pingStatus: "{ping}. {status}.",
      noPing: "Ping: nenhum clique medido ainda",
      coolingStatus: "Pausa do servidor. Cliques pausados",
      offlineStatus: "Sem conex\xE3o. Cliques pausados",
      loadingStatus: "Solicita\xE7\xE3o em andamento",
      failedStatus: "A \xFAltima solicita\xE7\xE3o falhou",
      idleStatus: "Nenhuma solicita\xE7\xE3o pendente",
      pending: "+{count} em espera",
      cooldown: "Em pausa",
      seconds: "{count} s",
      streaks: "Sequ\xEAncias",
      streakLabel: "Sequ\xEAncias de cliques",
      networkNotice: "Voc\xEA est\xE1 sem conex\xE3o. Os cliques est\xE3o pausados. Seu progresso salvo ser\xE1 atualizado ao reconectar.",
      playingOffline: "Continuando offline.",
      offline: "Offline",
      backOnline: "Voltar ao modo online",
      signOut: "Sair",
      homeGreeting: "Clique para jogar offline ou entre para salvar seus cliques na conta.",
      signIn: "Entrar",
      createAccount: "Criar conta",
      loadingCounter: "Carregando contador\u2026",
      tryAgain: "Tentar novamente",
      admin: "Administra\xE7\xE3o",
      options: "Op\xE7\xF5es",
      sound: "Efeitos sonoros",
      soundOn: "Som ativado \xB7 Desativar efeitos sonoros",
      soundOff: "Som desativado \xB7 Ativar efeitos sonoros",
      motion: "Ativar efeitos de movimento",
      motionHint: "Movimento reduzido ativado. Ativar efeitos de movimento.",
      controls: "Pressione com o mouse ou toque e solte sobre o bot\xE3o ou perto dele. Cada dedo conta separadamente. Com o bot\xE3o em foco, solte Espa\xE7o ou Enter para adicionar um clique. Segurar n\xE3o adiciona cliques.",
      loadError: "N\xE3o foi poss\xEDvel carregar o contador. Tente atualiz\xE1-lo.",
      unconfirmedClick: "N\xE3o foi poss\xEDvel confirmar seu clique. Atualize o contador para verificar se ele foi salvo.",
      unsavedClick: "Seu clique n\xE3o foi salvo. Verifique sua conex\xE3o e tente novamente.",
      localLoadError: "N\xE3o foi poss\xEDvel carregar o save local. Abra Op\xE7\xF5es para importar uma c\xF3pia ou reiniciar.",
      localClickError: "Seu clique local n\xE3o foi salvo. O armazenamento do navegador pode estar cheio ou indispon\xEDvel.",
      signOutError: "N\xE3o foi poss\xEDvel sair. Tente novamente.",
      shareTitle: "Compartilhar estat\xEDsticas",
      done: "Conclu\xEDdo",
      shareInstructions: "Escolha o que incluir e copie a pr\xE9via.",
      include: "Incluir",
      siteLink: "Link do site",
      clickTotal: "Total de cliques",
      shareDataNote: "O total inclui todos os cliques do save atual.",
      preview: "Pr\xE9via",
      statsToShare: "Estat\xEDsticas para compartilhar",
      copyText: "Copiar texto",
      copied: "Estat\xEDsticas copiadas.",
      clipboardUnavailable: "\xC1rea de transfer\xEAncia indispon\xEDvel. Selecione e copie o texto da pr\xE9via.",
      statsClicks: "{label}: {count}",
      statsStreaks: "Sequ\xEAncias UTC: {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "Jogar: {url}"
    },
    fr: {
      ...optionsTranslations["fr"],
      fortnightActivity: "Activit\xE9 sur deux semaines",
      outOf: "{count} / {total}",
      daysActive: "Jours actifs : {count}",
      activityNote: "Compte les 14 jours jusqu\u2019au dernier clic enregistr\xE9. Cliquer plusieurs jours de suite rapporte des points bonus.",
      nextDay: "Prochain jour UTC",
      timeUntilReset: "Encore {time}",
      localReset: "Changement de jour (heure locale) : {time}",
      achievements: "Succ\xE8s",
      offlineAchievements: "Succ\xE8s hors ligne",
      weekRule: "Un clic enregistr\xE9 compte pour la semaine, du lundi au dimanche (UTC).",
      firstClick: "Enregistrez votre premier clic.",
      clickMilestone: "{count} clics au total.",
      consecutiveDays: "{duration} de suite (UTC). Cliquez au moins une fois par jour.",
      consecutiveWeeks: "{duration} de suite (UTC). Cliquez au moins une fois par semaine.",
      dayClickGoal: "{count} clics au cours d\u2019une m\xEAme journ\xE9e UTC.",
      weekClickGoal: "{count} clics au cours d\u2019une m\xEAme semaine UTC (du lundi au dimanche).",
      monthClickGoal: "{count} clics au cours d\u2019un m\xEAme mois civil UTC.",
      distinctHoursGoal: "Cliquez \xE0 {count} heures diff\xE9rentes au cours d\u2019une m\xEAme journ\xE9e UTC.",
      distinctDaysGoal: "Cliquez lors de {count} journ\xE9es UTC diff\xE9rentes, m\xEAme non cons\xE9cutives.",
      distinctMonthsGoal: "Cliquez au cours de {count} mois civils UTC diff\xE9rents, m\xEAme non cons\xE9cutifs.",
      otherAchievementsGoal: "Obtenez {count} autres succ\xE8s.",
      earned: "Obtenu",
      locked: "Verrouill\xE9",
      allAchievements: "Tous",
      filterAchievements: "Filtrer les succ\xE8s",
      revealRequirements: "Afficher les conditions des succ\xE8s verrouill\xE9s",
      allAchievementsEarned: "Vous avez obtenu tous les succ\xE8s.",
      noAchievementsEarned: "Vous n\u2019avez encore obtenu aucun succ\xE8s.",
      achievementUnlocked: "Succ\xE8s d\xE9verrouill\xE9",
      achievementsUnlocked: "Succ\xE8s d\xE9verrouill\xE9s",
      language: "Langue",
      account: "Compte",
      localGame: "Partie locale",
      languageHint: "Langue du jeu \xB7 m\xE9moris\xE9e dans ce navigateur",
      languageVisit: "Langue du jeu \xB7 appliqu\xE9e pour cette visite ; stockage indisponible",
      skip: "Aller au contenu",
      game: "Jouer \xE0 Go Click",
      savedClicks: "Clics enregistr\xE9s",
      localClicks: "Clics locaux",
      click: "Cliquez",
      clickAction: "Ajouter un clic",
      outletTest: "Test de la prise",
      cordSlack: "D\xE9tendre le c\xE2ble",
      reconnectPlug: "Rebrancher la fiche",
      feedbackWaiting: "en attente",
      feedbackUnconfirmed: "non confirm\xE9",
      feedbackUnsaved: "non enregistr\xE9",
      feedbackCooldown: "pause",
      feedbackAwaitingHint: "En attente d\u2019enregistrement \xB7 moyenne r\xE9cente {average}",
      feedbackSavedHint: "Enregistr\xE9 \xB7 {time} \xB7 moyenne r\xE9cente {average}",
      feedbackSimulatedHint: "R\xE9ponse simul\xE9e \xB7 {time} \xB7 moyenne r\xE9cente {average}",
      copyChanged: "L\u2019aper\xE7u a chang\xE9. Copiez \xE0 nouveau pour partager le texte actualis\xE9.",
      lastClick: "Dernier clic : {time}",
      timezone: "Affich\xE9 dans votre fuseau horaire local",
      refresh: "Actualiser le compteur",
      share: "Partager",
      shareHint: "Pr\xE9visualiser les statistiques \xE0 partager",
      ping: "Latence",
      simPing: "Latence simul\xE9e",
      pingHint: "Dur\xE9e aller-retour de la derni\xE8re requ\xEAte de clic r\xE9ussie. Le point de statut indique les requ\xEAtes en attente ou une erreur de sauvegarde.",
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
      networkNotice: "Vous \xEAtes hors ligne. Les clics sont suspendus. Votre progression sera actualis\xE9e \xE0 la reconnexion.",
      playingOffline: "La partie continue hors ligne.",
      offline: "Hors ligne",
      backOnline: "Revenir en ligne",
      signOut: "Se d\xE9connecter",
      homeGreeting: "Cliquez pour jouer hors ligne ou connectez-vous pour enregistrer vos clics sur votre compte.",
      signIn: "Se connecter",
      createAccount: "Cr\xE9er un compte",
      loadingCounter: "Chargement du compteur\u2026",
      tryAgain: "R\xE9essayer",
      admin: "Administration",
      options: "Options",
      sound: "Effets sonores",
      soundOn: "Son activ\xE9 \xB7 D\xE9sactiver les effets sonores",
      soundOff: "Son d\xE9sactiv\xE9 \xB7 Activer les effets sonores",
      motion: "Activer les animations",
      motionHint: "Les animations sont d\xE9sactiv\xE9es. Activez-les pour voir les effets.",
      controls: "Appuyez avec la souris ou le doigt, puis rel\xE2chez sur le bouton ou \xE0 proximit\xE9. Chaque doigt compte s\xE9par\xE9ment. Lorsque le bouton a le focus, rel\xE2chez Espace ou Entr\xE9e pour ajouter un clic. Maintenir le bouton enfonc\xE9 n\u2019ajoute pas de clics.",
      loadError: "Impossible de charger le compteur. Essayez de l\u2019actualiser.",
      unconfirmedClick: "Impossible de confirmer votre clic. Actualisez le compteur pour v\xE9rifier s\u2019il a \xE9t\xE9 enregistr\xE9.",
      unsavedClick: "Votre clic n\u2019a pas \xE9t\xE9 enregistr\xE9. V\xE9rifiez votre connexion et r\xE9essayez.",
      localLoadError: "Impossible de charger la sauvegarde locale. Ouvrez les Options pour importer une copie ou r\xE9initialiser la sauvegarde.",
      localClickError: "Votre clic local n\u2019a pas \xE9t\xE9 enregistr\xE9. Le stockage du navigateur est peut-\xEAtre plein ou indisponible.",
      signOutError: "Impossible de se d\xE9connecter. R\xE9essayez.",
      shareTitle: "Partager les statistiques",
      done: "Termin\xE9",
      shareInstructions: "Choisissez les \xE9l\xE9ments \xE0 inclure, puis copiez l\u2019aper\xE7u.",
      include: "Inclure",
      siteLink: "Lien du site",
      clickTotal: "Total des clics",
      shareDataNote: "Le total comprend tous les clics de la sauvegarde actuelle.",
      preview: "Aper\xE7u",
      statsToShare: "Statistiques \xE0 partager",
      copyText: "Copier le texte",
      copied: "Statistiques copi\xE9es.",
      clipboardUnavailable: "Presse-papiers indisponible. S\xE9lectionnez et copiez le texte de l\u2019aper\xE7u.",
      statsClicks: "{label} : {count}",
      statsStreaks: "S\xE9ries UTC : {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "Jouer : {url}"
    },
    ja: {
      ...optionsTranslations["ja"],
      fortnightActivity: "2\u9031\u9593\u306E\u30A2\u30AF\u30C6\u30A3\u30D3\u30C6\u30A3",
      outOf: "{count} / {total}",
      daysActive: "\u30A2\u30AF\u30C6\u30A3\u30D6\u65E5\u6570\uFF1A{count}",
      activityNote: "\u6700\u5F8C\u306B\u30AF\u30EA\u30C3\u30AF\u3092\u4FDD\u5B58\u3057\u305F\u65E5\u307E\u3067\u306E14\u65E5\u9593\u3092\u96C6\u8A08\u3057\u307E\u3059\u3002\u6BCE\u65E5\u7D9A\u3051\u3066\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3068\u30DC\u30FC\u30CA\u30B9\u30DD\u30A4\u30F3\u30C8\u304C\u52A0\u7B97\u3055\u308C\u307E\u3059\u3002",
      nextDay: "\u6B21\u306E UTC \u65E5",
      timeUntilReset: "\u6B8B\u308A {time}",
      localReset: "\u65E5\u4ED8\u304C\u5909\u308F\u308B\u6642\u523B\uFF08\u73FE\u5730\u6642\u9593\uFF09\uFF1A{time}",
      achievements: "\u5B9F\u7E3E",
      offlineAchievements: "\u30AA\u30D5\u30E9\u30A4\u30F3\u306E\u5B9F\u7E3E",
      weekRule: "\u6708\u66DC\u304B\u3089\u65E5\u66DC\u307E\u3067\uFF08UTC\uFF09\u306B1\u56DE\u30AF\u30EA\u30C3\u30AF\u3092\u4FDD\u5B58\u3059\u308B\u3068\u3001\u305D\u306E\u9031\u304C\u8A18\u9332\u3055\u308C\u307E\u3059\u3002",
      firstClick: "\u6700\u521D\u306E\u30AF\u30EA\u30C3\u30AF\u3092\u4FDD\u5B58\u3059\u308B\u3002",
      clickMilestone: "\u5408\u8A08 {count} \u56DE\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3002",
      consecutiveDays: "{duration}\u9023\u7D9A\u3067\u3001\u6BCE\u65E5\u5C11\u306A\u304F\u3068\u30821\u56DE\u30AF\u30EA\u30C3\u30AF\u3059\u308B\uFF08UTC\uFF09\u3002",
      consecutiveWeeks: "{duration}\u9023\u7D9A\u3067\u3001\u6BCE\u9031\u5C11\u306A\u304F\u3068\u30821\u56DE\u30AF\u30EA\u30C3\u30AF\u3059\u308B\uFF08UTC\uFF09\u3002",
      dayClickGoal: "UTC \u306E\u540C\u3058\u65E5\u306B {count} \u56DE\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3002",
      weekClickGoal: "UTC \u306E\u540C\u3058\u9031\uFF08\u6708\u66DC\u304B\u3089\u65E5\u66DC\uFF09\u306B {count} \u56DE\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3002",
      monthClickGoal: "UTC \u306E\u540C\u3058\u66A6\u6708\u306B {count} \u56DE\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3002",
      distinctHoursGoal: "UTC \u306E\u540C\u3058\u65E5\u306E\u3046\u3061\u3001\u7570\u306A\u308B {count} \u3064\u306E\u6642\u9593\u5E2F\u3067\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3002",
      distinctDaysGoal: "UTC \u3067\u7570\u306A\u308B {count} \u65E5\u306B\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3002\u9023\u7D9A\u3057\u3066\u3044\u306A\u304F\u3066\u3082\u53EF\u3002",
      distinctMonthsGoal: "UTC \u3067\u7570\u306A\u308B {count} \u3064\u306E\u66A6\u6708\u306B\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3002\u9023\u7D9A\u3057\u3066\u3044\u306A\u304F\u3066\u3082\u53EF\u3002",
      otherAchievementsGoal: "\u307B\u304B\u306E\u5B9F\u7E3E\u3092 {count} \u500B\u7372\u5F97\u3059\u308B\u3002",
      earned: "\u7372\u5F97\u6E08\u307F",
      locked: "\u672A\u7372\u5F97",
      allAchievements: "\u3059\u3079\u3066",
      filterAchievements: "\u5B9F\u7E3E\u3092\u7D5E\u308A\u8FBC\u3080",
      revealRequirements: "\u672A\u7372\u5F97\u306E\u5B9F\u7E3E\u306E\u6761\u4EF6\u3092\u8868\u793A",
      allAchievementsEarned: "\u3059\u3079\u3066\u306E\u5B9F\u7E3E\u3092\u7372\u5F97\u3057\u307E\u3057\u305F\u3002",
      noAchievementsEarned: "\u307E\u3060\u7372\u5F97\u3057\u305F\u5B9F\u7E3E\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
      achievementUnlocked: "\u5B9F\u7E3E\u3092\u7372\u5F97\u3057\u307E\u3057\u305F",
      achievementsUnlocked: "\u8907\u6570\u306E\u5B9F\u7E3E\u3092\u7372\u5F97\u3057\u307E\u3057\u305F",
      language: "\u8A00\u8A9E",
      account: "\u30A2\u30AB\u30A6\u30F3\u30C8",
      localGame: "\u30ED\u30FC\u30AB\u30EB\u30B2\u30FC\u30E0",
      languageHint: "\u30B2\u30FC\u30E0\u306E\u8A00\u8A9E \xB7 \u3053\u306E\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58",
      languageVisit: "\u30B2\u30FC\u30E0\u306E\u8A00\u8A9E \xB7 \u4ECA\u56DE\u306E\u307F\u9069\u7528\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093",
      skip: "\u672C\u6587\u3078\u79FB\u52D5",
      game: "Go Click \u3092\u30D7\u30EC\u30A4",
      savedClicks: "\u4FDD\u5B58\u6E08\u307F\u30AF\u30EA\u30C3\u30AF",
      localClicks: "\u30ED\u30FC\u30AB\u30EB\u30AF\u30EA\u30C3\u30AF",
      click: "\u30AF\u30EA\u30C3\u30AF",
      clickAction: "\u30AF\u30EA\u30C3\u30AF\u30921\u56DE\u8FFD\u52A0",
      outletTest: "\u30B3\u30F3\u30BB\u30F3\u30C8\u306E\u30C6\u30B9\u30C8",
      cordSlack: "\u30B3\u30FC\u30C9\u3092\u305F\u308B\u307E\u305B\u308B",
      reconnectPlug: "\u30D7\u30E9\u30B0\u3092\u5DEE\u3057\u76F4\u3059",
      feedbackWaiting: "\u5F85\u6A5F\u4E2D",
      feedbackUnconfirmed: "\u672A\u78BA\u8A8D",
      feedbackUnsaved: "\u672A\u4FDD\u5B58",
      feedbackCooldown: "\u5F85\u6A5F\u4E2D",
      feedbackAwaitingHint: "\u4FDD\u5B58\u5F85\u3061 \xB7 \u6700\u8FD1\u306E\u5E73\u5747 {average}",
      feedbackSavedHint: "\u4FDD\u5B58\u6E08\u307F \xB7 {time} \xB7 \u6700\u8FD1\u306E\u5E73\u5747 {average}",
      feedbackSimulatedHint: "\u6A21\u64EC\u5FDC\u7B54 \xB7 {time} \xB7 \u6700\u8FD1\u306E\u5E73\u5747 {average}",
      copyChanged: "\u30D7\u30EC\u30D3\u30E5\u30FC\u304C\u5909\u308F\u308A\u307E\u3057\u305F\u3002\u66F4\u65B0\u3055\u308C\u305F\u30C6\u30AD\u30B9\u30C8\u3092\u5171\u6709\u3059\u308B\u306B\u306F\u3001\u3082\u3046\u4E00\u5EA6\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      lastClick: "\u6700\u5F8C\u306E\u30AF\u30EA\u30C3\u30AF\uFF1A{time}",
      timezone: "\u304A\u4F4F\u307E\u3044\u306E\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3\u3067\u8868\u793A",
      refresh: "\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u66F4\u65B0",
      share: "\u5171\u6709",
      shareHint: "\u5171\u6709\u3059\u308B\u8A18\u9332\u3092\u30D7\u30EC\u30D3\u30E5\u30FC",
      ping: "\u5FDC\u7B54\u6642\u9593",
      simPing: "\u6A21\u64EC\u5FDC\u7B54\u6642\u9593",
      pingHint: "\u6700\u5F8C\u306B\u6210\u529F\u3057\u305F\u30AF\u30EA\u30C3\u30AF\u8981\u6C42\u306E\u5F80\u5FA9\u6642\u9593\u3002\u72B6\u614B\u3092\u793A\u3059\u70B9\u306F\u51E6\u7406\u4E2D\u306E\u8981\u6C42\u3084\u4FDD\u5B58\u30A8\u30E9\u30FC\u3092\u793A\u3057\u307E\u3059\u3002",
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
      networkNotice: "\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u3059\u3002\u30AF\u30EA\u30C3\u30AF\u306F\u4E00\u6642\u505C\u6B62\u4E2D\u3067\u3059\u3002\u518D\u63A5\u7D9A\u3059\u308B\u3068\u4FDD\u5B58\u6E08\u307F\u306E\u9032\u884C\u72B6\u6CC1\u3092\u66F4\u65B0\u3057\u307E\u3059\u3002",
      playingOffline: "\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u7D9A\u3051\u307E\u3059\u3002",
      offline: "\u30AA\u30D5\u30E9\u30A4\u30F3",
      backOnline: "\u30AA\u30F3\u30E9\u30A4\u30F3\u306B\u623B\u308B",
      signOut: "\u30ED\u30B0\u30A2\u30A6\u30C8",
      homeGreeting: "\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u3068\u30AA\u30D5\u30E9\u30A4\u30F3\u3067\u904A\u3079\u307E\u3059\u3002\u30A2\u30AB\u30A6\u30F3\u30C8\u306B\u30AF\u30EA\u30C3\u30AF\u3092\u4FDD\u5B58\u3059\u308B\u306B\u306F\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      signIn: "\u30ED\u30B0\u30A4\u30F3",
      createAccount: "\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u4F5C\u6210",
      loadingCounter: "\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026",
      tryAgain: "\u518D\u8A66\u884C",
      admin: "\u7BA1\u7406",
      options: "\u8A2D\u5B9A",
      sound: "\u52B9\u679C\u97F3",
      soundOn: "\u52B9\u679C\u97F3\u30AA\u30F3 \xB7 \u52B9\u679C\u97F3\u3092\u30AA\u30D5\u306B\u3059\u308B",
      soundOff: "\u52B9\u679C\u97F3\u30AA\u30D5 \xB7 \u52B9\u679C\u97F3\u3092\u30AA\u30F3\u306B\u3059\u308B",
      motion: "\u52D5\u304D\u306E\u52B9\u679C\u3092\u6709\u52B9\u306B\u3059\u308B",
      motionHint: "\u52D5\u304D\u3092\u6291\u3048\u308B\u8A2D\u5B9A\u3067\u3059\u3002\u52D5\u304D\u306E\u52B9\u679C\u3092\u6709\u52B9\u306B\u3057\u307E\u3059\u3002",
      controls: "\u30DE\u30A6\u30B9\u3084\u30BF\u30C3\u30C1\u3067\u62BC\u3057\u3001\u30DC\u30BF\u30F3\u306E\u4E0A\u304B\u8FD1\u304F\u3067\u96E2\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u6307\u3054\u3068\u306B\u6570\u3048\u307E\u3059\u3002\u30DC\u30BF\u30F3\u306B\u30D5\u30A9\u30FC\u30AB\u30B9\u304C\u3042\u308B\u3068\u304D\u306F\u3001\u30B9\u30DA\u30FC\u30B9\u30AD\u30FC\u307E\u305F\u306F Enter \u30AD\u30FC\u3092\u96E2\u3059\u30681\u30AF\u30EA\u30C3\u30AF\u52A0\u7B97\u3055\u308C\u307E\u3059\u3002\u9577\u62BC\u3057\u3057\u3066\u3082\u5897\u3048\u307E\u305B\u3093\u3002",
      loadError: "\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      unconfirmedClick: "\u30AF\u30EA\u30C3\u30AF\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30AB\u30A6\u30F3\u30BF\u30FC\u3092\u66F4\u65B0\u3057\u3066\u3001\u30AF\u30EA\u30C3\u30AF\u304C\u4FDD\u5B58\u3055\u308C\u305F\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      unsavedClick: "\u30AF\u30EA\u30C3\u30AF\u306F\u4FDD\u5B58\u3055\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      localLoadError: "\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30AA\u30D7\u30B7\u30E7\u30F3\u304B\u3089\u30BB\u30FC\u30D6\u306E\u30B3\u30D4\u30FC\u3092\u30A4\u30F3\u30DD\u30FC\u30C8\u3059\u308B\u304B\u3001\u30BB\u30FC\u30D6\u3092\u30EA\u30BB\u30C3\u30C8\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      localClickError: "\u30AF\u30EA\u30C3\u30AF\u3092\u30ED\u30FC\u30AB\u30EB\u30BB\u30FC\u30D6\u306B\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30D6\u30E9\u30A6\u30B6\u30FC\u306E\u30B9\u30C8\u30EC\u30FC\u30B8\u306B\u7A7A\u304D\u304C\u306A\u3044\u304B\u3001\u5229\u7528\u3067\u304D\u306A\u3044\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002",
      signOutError: "\u30ED\u30B0\u30A2\u30A6\u30C8\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      shareTitle: "\u8A18\u9332\u3092\u5171\u6709",
      done: "\u5B8C\u4E86",
      shareInstructions: "\u542B\u3081\u308B\u9805\u76EE\u3092\u9078\u3073\u3001\u30D7\u30EC\u30D3\u30E5\u30FC\u3092\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      include: "\u542B\u3081\u308B\u5185\u5BB9",
      siteLink: "\u30B5\u30A4\u30C8\u306E\u30EA\u30F3\u30AF",
      clickTotal: "\u5408\u8A08\u30AF\u30EA\u30C3\u30AF\u6570",
      shareDataNote: "\u73FE\u5728\u306E\u30BB\u30FC\u30D6\u30C7\u30FC\u30BF\u306B\u542B\u307E\u308C\u308B\u3059\u3079\u3066\u306E\u30AF\u30EA\u30C3\u30AF\u3092\u5408\u8A08\u3057\u3066\u3044\u307E\u3059\u3002",
      preview: "\u30D7\u30EC\u30D3\u30E5\u30FC",
      statsToShare: "\u5171\u6709\u3059\u308B\u8A18\u9332",
      copyText: "\u30C6\u30AD\u30B9\u30C8\u3092\u30B3\u30D4\u30FC",
      copied: "\u8A18\u9332\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002",
      clipboardUnavailable: "\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u30D7\u30EC\u30D3\u30E5\u30FC\u306E\u30C6\u30AD\u30B9\u30C8\u3092\u9078\u629E\u3057\u3066\u30B3\u30D4\u30FC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      statsClicks: "{label}\uFF1A{count}",
      statsStreaks: "UTC \u9023\u7D9A\u8A18\u9332\uFF1A{day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "\u30D7\u30EC\u30A4\uFF1A{url}"
    },
    ru: {
      ...optionsTranslations["ru"],
      fortnightActivity: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C \u0437\u0430 \u0434\u0432\u0435 \u043D\u0435\u0434\u0435\u043B\u0438",
      outOf: "{count} / {total}",
      daysActive: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0434\u043D\u0435\u0439: {count}",
      activityNote: "\u0423\u0447\u0438\u0442\u044B\u0432\u0430\u044E\u0442\u0441\u044F 14 \u0434\u043D\u0435\u0439 \u043F\u043E \u0434\u0435\u043D\u044C \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0433\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u043E\u0433\u043E \u043A\u043B\u0438\u043A\u0430 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u043E. \u041A\u043B\u0438\u043A\u0438 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0434\u043D\u0435\u0439 \u043F\u043E\u0434\u0440\u044F\u0434 \u043F\u0440\u0438\u043D\u043E\u0441\u044F\u0442 \u0431\u043E\u043D\u0443\u0441\u043D\u044B\u0435 \u043E\u0447\u043A\u0438.",
      nextDay: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0434\u0435\u043D\u044C \u043F\u043E UTC",
      timeUntilReset: "\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C {time}",
      localReset: "\u0421\u043C\u0435\u043D\u0430 \u0434\u043D\u044F \u043F\u043E \u043C\u0435\u0441\u0442\u043D\u043E\u043C\u0443 \u0432\u0440\u0435\u043C\u0435\u043D\u0438: {time}",
      achievements: "\u0414\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u044F",
      offlineAchievements: "\u041E\u0444\u043B\u0430\u0439\u043D-\u0434\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u044F",
      weekRule: "\u041E\u0434\u0438\u043D \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0439 \u043A\u043B\u0438\u043A \u0437\u0430\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u0442 \u043D\u0435\u0434\u0435\u043B\u044E \u0441 \u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u0438\u043A\u0430 \u043F\u043E \u0432\u043E\u0441\u043A\u0440\u0435\u0441\u0435\u043D\u044C\u0435 (UTC).",
      firstClick: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0441\u0432\u043E\u0439 \u043F\u0435\u0440\u0432\u044B\u0439 \u043A\u043B\u0438\u043A.",
      clickMilestone: "\u0412\u0441\u0435\u0433\u043E {count} \u043A\u043B\u0438\u043A\u043E\u0432.",
      consecutiveDays: "{duration} \u043F\u043E\u0434\u0440\u044F\u0434 \u043F\u043E UTC. \u0421\u0434\u0435\u043B\u0430\u0439\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u0438\u043D \u043A\u043B\u0438\u043A \u043A\u0430\u0436\u0434\u044B\u0439 \u0434\u0435\u043D\u044C.",
      consecutiveWeeks: "{duration} \u043F\u043E\u0434\u0440\u044F\u0434 \u043F\u043E UTC. \u0421\u0434\u0435\u043B\u0430\u0439\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u0438\u043D \u043A\u043B\u0438\u043A \u043A\u0430\u0436\u0434\u0443\u044E \u043D\u0435\u0434\u0435\u043B\u044E.",
      dayClickGoal: "{count} \u043A\u043B\u0438\u043A\u043E\u0432 \u0437\u0430 \u043E\u0434\u043D\u0438 \u0441\u0443\u0442\u043A\u0438 \u043F\u043E UTC.",
      weekClickGoal: "{count} \u043A\u043B\u0438\u043A\u043E\u0432 \u0437\u0430 \u043E\u0434\u043D\u0443 \u043D\u0435\u0434\u0435\u043B\u044E \u043F\u043E UTC (\u0441 \u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u0438\u043A\u0430 \u043F\u043E \u0432\u043E\u0441\u043A\u0440\u0435\u0441\u0435\u043D\u044C\u0435).",
      monthClickGoal: "{count} \u043A\u043B\u0438\u043A\u043E\u0432 \u0437\u0430 \u043E\u0434\u0438\u043D \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u043D\u044B\u0439 \u043C\u0435\u0441\u044F\u0446 \u043F\u043E UTC.",
      distinctHoursGoal: "\u041A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u0432 {count} \u0440\u0430\u0437\u043D\u044B\u0445 \u0447\u0430\u0441\u043E\u0432\u044B\u0445 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u0430\u0445 \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 \u043E\u0434\u043D\u0438\u0445 \u0441\u0443\u0442\u043E\u043A \u043F\u043E UTC.",
      distinctDaysGoal: "\u041E\u0442\u043C\u0435\u0442\u044C\u0442\u0435 \u043A\u043B\u0438\u043A\u043E\u043C {count} \u0440\u0430\u0437\u043D\u044B\u0445 \u0434\u043D\u0435\u0439 \u043F\u043E UTC. \u0414\u043D\u0438 \u043C\u043E\u0433\u0443\u0442 \u0438\u0434\u0442\u0438 \u043D\u0435 \u043F\u043E\u0434\u0440\u044F\u0434.",
      distinctMonthsGoal: "\u041A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u0440\u0430\u0437 \u0432 \u043A\u0430\u0436\u0434\u043E\u043C \u0438\u0437 {count} \u0440\u0430\u0437\u043D\u044B\u0445 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u043D\u044B\u0445 \u043C\u0435\u0441\u044F\u0446\u0435\u0432 \u043F\u043E UTC. \u041C\u0435\u0441\u044F\u0446\u044B \u043C\u043E\u0433\u0443\u0442 \u0438\u0434\u0442\u0438 \u043D\u0435 \u043F\u043E\u0434\u0440\u044F\u0434.",
      otherAchievementsGoal: "\u041F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 {count} \u0434\u0440\u0443\u0433\u0438\u0445 \u0434\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u0439.",
      earned: "\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E",
      locked: "\u0417\u0430\u043A\u0440\u044B\u0442\u043E",
      allAchievements: "\u0412\u0441\u0435",
      filterAchievements: "\u0424\u0438\u043B\u044C\u0442\u0440 \u0434\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u0439",
      revealRequirements: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0445 \u0434\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u0439",
      allAchievementsEarned: "\u0412\u044B \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u0438 \u0432\u0441\u0435 \u0434\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u044F.",
      noAchievementsEarned: "\u0423 \u0432\u0430\u0441 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0434\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u0439.",
      achievementUnlocked: "\u0414\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u043E",
      achievementsUnlocked: "\u0414\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u044B",
      language: "\u042F\u0437\u044B\u043A",
      account: "\u0410\u043A\u043A\u0430\u0443\u043D\u0442",
      localGame: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u0430\u044F \u0438\u0433\u0440\u0430",
      languageHint: "\u042F\u0437\u044B\u043A \u0438\u0433\u0440\u044B \xB7 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435",
      languageVisit: "\u042F\u0437\u044B\u043A \u0438\u0433\u0440\u044B \xB7 \u043F\u0440\u0438\u043C\u0435\u043D\u0451\u043D \u043D\u0430 \u044D\u0442\u043E\u0442 \u0440\u0430\u0437; \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E",
      skip: "\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u043C\u0443",
      game: "\u0418\u0433\u0440\u0430\u0442\u044C \u0432 Go Click",
      savedClicks: "\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u043A\u043B\u0438\u043A\u0438",
      localClicks: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u043A\u043B\u0438\u043A\u0438",
      click: "\u041D\u0430\u0436\u0430\u0442\u044C",
      clickAction: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043E\u0434\u0438\u043D \u043A\u043B\u0438\u043A",
      outletTest: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0440\u043E\u0437\u0435\u0442\u043A\u0438",
      cordSlack: "\u041E\u0441\u043B\u0430\u0431\u0438\u0442\u044C \u0448\u043D\u0443\u0440",
      reconnectPlug: "\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432\u0438\u043B\u043A\u0443 \u043E\u0431\u0440\u0430\u0442\u043D\u043E",
      feedbackWaiting: "\u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0435",
      feedbackUnconfirmed: "\u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E",
      feedbackUnsaved: "\u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E",
      feedbackCooldown: "\u043F\u0430\u0443\u0437\u0430",
      feedbackAwaitingHint: "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F \xB7 \u0441\u0440\u0435\u0434\u043D\u0435\u0435 \u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F {average}",
      feedbackSavedHint: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E \xB7 {time} \xB7 \u0441\u0440\u0435\u0434\u043D\u0435\u0435 \u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F {average}",
      feedbackSimulatedHint: "\u0421\u0438\u043C\u0443\u043B\u044F\u0446\u0438\u044F \u043E\u0442\u0432\u0435\u0442\u0430 \xB7 {time} \xB7 \u0441\u0440\u0435\u0434\u043D\u0435\u0435 \u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F {average}",
      copyChanged: "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0441\u044F. \u0421\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u0437\u0430\u043D\u043E\u0432\u043E \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439.",
      lastClick: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043A\u043B\u0438\u043A: {time}",
      timezone: "\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u0432 \u0432\u0430\u0448\u0435\u043C \u0447\u0430\u0441\u043E\u0432\u043E\u043C \u043F\u043E\u044F\u0441\u0435",
      refresh: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0447\u0451\u0442\u0447\u0438\u043A",
      share: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F",
      shareHint: "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0438 \u0434\u043B\u044F \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438",
      ping: "\u041F\u0438\u043D\u0433",
      simPing: "\u0418\u043C\u0438\u0442\u0430\u0446\u0438\u044F \u043F\u0438\u043D\u0433\u0430",
      pingHint: "\u0412\u0440\u0435\u043C\u044F \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0433\u043E \u0443\u0441\u043F\u0435\u0448\u043D\u043E\u0433\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u043A\u043B\u0438\u043A\u0430. \u0418\u043D\u0434\u0438\u043A\u0430\u0442\u043E\u0440 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u044B \u0438\u043B\u0438 \u043E\u0448\u0438\u0431\u043A\u0443 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F.",
      pingStatus: "{ping}. {status}.",
      noPing: "\u041F\u0438\u043D\u0433 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0438\u0437\u043C\u0435\u0440\u044F\u043B\u0441\u044F",
      coolingStatus: "\u0421\u0435\u0440\u0432\u0435\u0440\u043D\u0430\u044F \u043F\u0430\u0443\u0437\u0430. \u041A\u043B\u0438\u043A\u0438 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B",
      offlineStatus: "\u041D\u0435\u0442 \u0441\u0435\u0442\u0438. \u041A\u043B\u0438\u043A\u0438 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B",
      loadingStatus: "\u0417\u0430\u043F\u0440\u043E\u0441 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",
      failedStatus: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D",
      idleStatus: "\u041D\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0445 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432",
      pending: "+{count} \u0432 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0438",
      cooldown: "\u041F\u0430\u0443\u0437\u0430",
      seconds: "{count} \u0441",
      streaks: "\u0421\u0435\u0440\u0438\u0438",
      streakLabel: "\u0421\u0435\u0440\u0438\u0438 \u043A\u043B\u0438\u043A\u043E\u0432",
      networkNotice: "\u041D\u0435\u0442 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F. \u041A\u043B\u0438\u043A\u0438 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B. \u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F.",
      playingOffline: "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0435\u043C \u0438\u0433\u0440\u0443 \u043E\u0444\u043B\u0430\u0439\u043D.",
      offline: "\u041E\u0444\u043B\u0430\u0439\u043D",
      backOnline: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u043E\u043D\u043B\u0430\u0439\u043D",
      signOut: "\u0412\u044B\u0439\u0442\u0438",
      homeGreeting: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u0438\u0433\u0440\u0430\u0442\u044C \u043E\u0444\u043B\u0430\u0439\u043D, \u0438\u043B\u0438 \u0432\u043E\u0439\u0434\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C \u043A\u043B\u0438\u043A\u0438 \u0432 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0435.",
      signIn: "\u0412\u043E\u0439\u0442\u0438",
      createAccount: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0430\u043A\u043A\u0430\u0443\u043D\u0442",
      loadingCounter: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0441\u0447\u0451\u0442\u0447\u0438\u043A\u0430\u2026",
      tryAgain: "\u041F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0435\u0449\u0451 \u0440\u0430\u0437",
      admin: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435",
      options: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
      sound: "\u0417\u0432\u0443\u043A\u043E\u0432\u044B\u0435 \u044D\u0444\u0444\u0435\u043A\u0442\u044B",
      soundOn: "\u0417\u0432\u0443\u043A \u0432\u043A\u043B\u044E\u0447\u0451\u043D \xB7 \u0412\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0437\u0432\u0443\u043A\u043E\u0432\u044B\u0435 \u044D\u0444\u0444\u0435\u043A\u0442\u044B",
      soundOff: "\u0417\u0432\u0443\u043A \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D \xB7 \u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0437\u0432\u0443\u043A\u043E\u0432\u044B\u0435 \u044D\u0444\u0444\u0435\u043A\u0442\u044B",
      motion: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u044D\u0444\u0444\u0435\u043A\u0442\u044B \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F",
      motionHint: "\u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0435 \u0443\u043C\u0435\u043D\u044C\u0448\u0435\u043D\u043E. \u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u044D\u0444\u0444\u0435\u043A\u0442\u044B \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F.",
      controls: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043C\u044B\u0448\u044C\u044E \u0438\u043B\u0438 \u043F\u0430\u043B\u044C\u0446\u0435\u043C \u0438 \u043E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0435 \u0438\u043B\u0438 \u0440\u044F\u0434\u043E\u043C \u0441 \u043D\u0435\u0439. \u041A\u0430\u0436\u0434\u044B\u0439 \u043F\u0430\u043B\u0435\u0446 \u0443\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E. \u041A\u043E\u0433\u0434\u0430 \u043A\u043D\u043E\u043F\u043A\u0430 \u0432 \u0444\u043E\u043A\u0443\u0441\u0435, \u043E\u0442\u043F\u0443\u0441\u0442\u0438\u0442\u0435 \u043F\u0440\u043E\u0431\u0435\u043B \u0438\u043B\u0438 Enter, \u0447\u0442\u043E\u0431\u044B \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043E\u0434\u0438\u043D \u043A\u043B\u0438\u043A. \u0423\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435 \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u043A\u043B\u0438\u043A\u043E\u0432.",
      loadError: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0447\u0451\u0442\u0447\u0438\u043A. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0433\u043E \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C.",
      unconfirmedClick: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u043A\u043B\u0438\u043A. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0447\u0451\u0442\u0447\u0438\u043A, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C, \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u043B\u0441\u044F \u043B\u0438 \u043A\u043B\u0438\u043A.",
      unsavedClick: "\u041A\u043B\u0438\u043A \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0443.",
      localLoadError: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438, \u0447\u0442\u043E\u0431\u044B \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u043F\u0438\u044E \u0438\u043B\u0438 \u043D\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E.",
      localClickError: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u043B\u0438\u043A \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D. \u0425\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043E \u0438\u043B\u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.",
      signOutError: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u0439\u0442\u0438. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.",
      shareTitle: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u043E\u0439",
      done: "\u0413\u043E\u0442\u043E\u0432\u043E",
      shareInstructions: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435, \u0447\u0442\u043E \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C, \u0437\u0430\u0442\u0435\u043C \u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430.",
      include: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C",
      siteLink: "\u0421\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u0441\u0430\u0439\u0442",
      clickTotal: "\u0412\u0441\u0435\u0433\u043E \u043A\u043B\u0438\u043A\u043E\u0432",
      shareDataNote: "\u0412 \u0438\u0442\u043E\u0433 \u0432\u0445\u043E\u0434\u044F\u0442 \u0432\u0441\u0435 \u043A\u043B\u0438\u043A\u0438 \u0438\u0437 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F.",
      preview: "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440",
      statsToShare: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0434\u043B\u044F \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438",
      copyText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u0435\u043A\u0441\u0442",
      copied: "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430.",
      clipboardUnavailable: "\u0411\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u0412\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u0438 \u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430.",
      statsClicks: "{label}: {count}",
      statsStreaks: "\u0421\u0435\u0440\u0438\u0438 UTC: {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "\u0418\u0433\u0440\u0430\u0442\u044C: {url}"
    },
    de: {
      ...optionsTranslations["de"],
      fortnightActivity: "Aktivit\xE4t in zwei Wochen",
      outOf: "{count} / {total}",
      daysActive: "Aktive Tage: {count}",
      activityNote: "Z\xE4hlt die 14 Tage bis einschlie\xDFlich zum letzten gespeicherten Klick. Klicks an aufeinanderfolgenden Tagen bringen Bonuspunkte.",
      nextDay: "N\xE4chster UTC-Tag",
      timeUntilReset: "Noch {time}",
      localReset: "Tageswechsel in Ortszeit: {time}",
      achievements: "Erfolge",
      offlineAchievements: "Offline-Erfolge",
      weekRule: "Ein gespeicherter Klick z\xE4hlt f\xFCr die Woche von Montag bis Sonntag (UTC).",
      firstClick: "Speichere deinen ersten Klick.",
      clickMilestone: "Insgesamt {count} Klicks.",
      consecutiveDays: "{duration} in Folge (UTC). Klicke mindestens einmal pro Tag.",
      consecutiveWeeks: "{duration} in Folge (UTC). Klicke mindestens einmal pro Woche.",
      dayClickGoal: "{count} Klicks an einem einzigen UTC-Tag.",
      weekClickGoal: "{count} Klicks in einer einzigen UTC-Woche (Montag bis Sonntag).",
      monthClickGoal: "{count} Klicks in einem einzigen UTC-Kalendermonat.",
      distinctHoursGoal: "Klicke in {count} verschiedenen Stunden desselben UTC-Tags.",
      distinctDaysGoal: "Klicke an {count} verschiedenen UTC-Tagen. Pausen sind erlaubt.",
      distinctMonthsGoal: "Klicke in {count} verschiedenen UTC-Kalendermonaten. Pausen sind erlaubt.",
      otherAchievementsGoal: "Schalte {count} andere Erfolge frei.",
      earned: "Erreicht",
      locked: "Gesperrt",
      allAchievements: "Alle",
      filterAchievements: "Erfolge filtern",
      revealRequirements: "Voraussetzungen gesperrter Erfolge anzeigen",
      allAchievementsEarned: "Du hast alle Erfolge erzielt.",
      noAchievementsEarned: "Du hast noch keine Erfolge erzielt.",
      achievementUnlocked: "Erfolg freigeschaltet",
      achievementsUnlocked: "Erfolge freigeschaltet",
      language: "Sprache",
      account: "Konto",
      localGame: "Lokales Spiel",
      languageHint: "Spielsprache \xB7 wird in diesem Browser gespeichert",
      languageVisit: "Spielsprache \xB7 f\xFCr diesen Besuch \xFCbernommen; Browserspeicher nicht verf\xFCgbar",
      skip: "Zum Inhalt springen",
      game: "Go Click spielen",
      savedClicks: "Gespeicherte Klicks",
      localClicks: "Lokale Klicks",
      click: "Klick",
      clickAction: "Einen Klick hinzuf\xFCgen",
      outletTest: "Steckdosentest",
      cordSlack: "Kabel lockern",
      reconnectPlug: "Stecker wieder einstecken",
      feedbackWaiting: "wartet",
      feedbackUnconfirmed: "unbest\xE4tigt",
      feedbackUnsaved: "nicht gespeichert",
      feedbackCooldown: "Pause",
      feedbackAwaitingHint: "Speichern ausstehend \xB7 Durchschnitt der letzten Messungen: {average}",
      feedbackSavedHint: "Gespeichert \xB7 {time} \xB7 Durchschnitt der letzten Messungen: {average}",
      feedbackSimulatedHint: "Simulierte Antwort \xB7 {time} \xB7 Durchschnitt der letzten Messungen: {average}",
      copyChanged: "Die Vorschau wurde ge\xE4ndert. Kopiere den aktualisierten Text erneut zum Teilen.",
      lastClick: "Letzter Klick: {time}",
      timezone: "Anzeige in deiner lokalen Zeitzone",
      refresh: "Z\xE4hler aktualisieren",
      share: "Teilen",
      shareHint: "Statistik zum Teilen ansehen",
      ping: "Ping",
      simPing: "Simulierter Ping",
      pingHint: "Zeit zwischen der letzten erfolgreichen Klickanfrage und der Antwort des Servers. Der Statuspunkt zeigt ausstehende Anfragen oder einen Speicherfehler an.",
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
      networkNotice: "Du bist offline. Klicken ist pausiert. Dein gespeicherter Fortschritt wird beim Verbinden aktualisiert.",
      playingOffline: "Das Spiel wird offline fortgesetzt.",
      offline: "Offline",
      backOnline: "Zur\xFCck zum Onlinespiel",
      signOut: "Abmelden",
      homeGreeting: "Klicke, um offline zu spielen, oder melde dich an, um deine Klicks im Konto zu speichern.",
      signIn: "Anmelden",
      createAccount: "Konto erstellen",
      loadingCounter: "Z\xE4hler wird geladen\u2026",
      tryAgain: "Erneut versuchen",
      admin: "Verwaltung",
      options: "Optionen",
      sound: "Soundeffekte",
      soundOn: "Ton an \xB7 Soundeffekte ausschalten",
      soundOff: "Ton aus \xB7 Soundeffekte einschalten",
      motion: "Bewegungseffekte aktivieren",
      motionHint: "Reduzierte Bewegung ist aktiv. Bewegungseffekte aktivieren.",
      controls: "Dr\xFCcke mit Maus oder Finger und lass auf der Schaltfl\xE4che oder in ihrer N\xE4he los. Jeder Finger z\xE4hlt einzeln. Wenn die Schaltfl\xE4che den Fokus hat, lass Leertaste oder Enter los, um einen Klick hinzuzuf\xFCgen. Halten erzeugt keine weiteren Klicks.",
      loadError: "Der Z\xE4hler konnte nicht geladen werden. Versuche, ihn zu aktualisieren.",
      unconfirmedClick: "Dein Klick konnte nicht best\xE4tigt werden. Aktualisiere den Z\xE4hler, um zu pr\xFCfen, ob der Klick gespeichert wurde.",
      unsavedClick: "Dein Klick wurde nicht gespeichert. Pr\xFCfe deine Verbindung und versuche es erneut.",
      localLoadError: "Der lokale Spielstand konnte nicht geladen werden. \xD6ffne die Optionen, um eine Kopie zu importieren oder den Spielstand zur\xFCckzusetzen.",
      localClickError: "Dein lokaler Klick wurde nicht gespeichert. Der Browserspeicher ist m\xF6glicherweise voll oder nicht verf\xFCgbar.",
      signOutError: "Abmelden fehlgeschlagen. Versuche es erneut.",
      shareTitle: "Statistik teilen",
      done: "Fertig",
      shareInstructions: "W\xE4hle aus, was enthalten sein soll, und kopiere dann die Vorschau.",
      include: "Einbeziehen",
      siteLink: "Link zur Website",
      clickTotal: "Klickzahl",
      shareDataNote: "Die Summe enth\xE4lt alle Klicks des aktuellen Spielstands.",
      preview: "Vorschau",
      statsToShare: "Statistik zum Teilen",
      copyText: "Text kopieren",
      copied: "Statistik kopiert.",
      clipboardUnavailable: "Zwischenablage nicht verf\xFCgbar. Markiere und kopiere den Vorschautext.",
      statsClicks: "{label}: {count}",
      statsStreaks: "UTC-Serien: {day} \xB7 {week} \xB7 {month} \xB7 {year}",
      playLink: "Spielen: {url}"
    }
  };

  // frontend/i18n.ts
  var languages = [
    { code: "en", name: "English", dir: "ltr", flag: "gb" },
    { code: "zh-Hans", name: "\u7B80\u4F53\u4E2D\u6587", dir: "ltr", flag: "cn" },
    { code: "zh-Hant", name: "\u7E41\u9AD4\u4E2D\u6587", dir: "ltr", flag: "tw" },
    { code: "es", name: "Espa\xF1ol", dir: "ltr", flag: "es" },
    { code: "ar", name: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", dir: "rtl", flag: "ar" },
    { code: "hi", name: "\u0939\u093F\u0928\u094D\u0926\u0940", dir: "ltr", flag: "in" },
    { code: "bn", name: "\u09AC\u09BE\u0982\u09B2\u09BE", dir: "ltr", flag: "bd" },
    { code: "id", name: "Bahasa Indonesia", dir: "ltr", flag: "id" },
    { code: "pt-BR", name: "Portugu\xEAs", dir: "ltr", flag: "br" },
    { code: "fr", name: "Fran\xE7ais", dir: "ltr", flag: "fr" },
    { code: "ja", name: "\u65E5\u672C\u8A9E", dir: "ltr", flag: "jp" },
    { code: "ru", name: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", dir: "ltr", flag: "ru" },
    { code: "de", name: "Deutsch", dir: "ltr", flag: "de" }
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
      if (base === "zh") {
        try {
          return new Intl.Locale(preference).maximize().script === "Hant" ? "zh-Hant" : "zh-Hans";
        } catch {
          continue;
        }
      }
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
  var numberFormats = /* @__PURE__ */ new Map();
  function formatNumber(value, code = language) {
    let formatter = numberFormats.get(code);
    if (!formatter) {
      formatter = new Intl.NumberFormat(code);
      numberFormats.set(code, formatter);
    }
    return formatter.format(value);
  }
  var unitFormats = /* @__PURE__ */ new Map();
  function formatUnit(value, unit, code = language) {
    const key = `${code}:${unit}`;
    let formatter = unitFormats.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(code, {
        style: "unit",
        unit,
        unitDisplay: ["hour", "minute", "millisecond"].includes(unit) ? "short" : "long"
      });
      unitFormats.set(key, formatter);
    }
    return formatter.format(value);
  }
  var percentFormats = /* @__PURE__ */ new Map();
  function formatPercent(value, code = language) {
    let formatter = percentFormats.get(code);
    if (!formatter) {
      formatter = new Intl.NumberFormat(code, { style: "percent" });
      percentFormats.set(code, formatter);
    }
    return formatter.format(value);
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
        if (current !== selected) {
          current = selected;
          return current;
        }
        if (random() < 0.02 + 0.06 * heat) {
          const choices = languages.filter((item) => item.code !== current && item.code !== selected);
          current = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))].code;
        }
        return current;
      }
    };
  }

  // frontend/button.ts
  var PRESS_ATTACK_MS = 24;
  var PRESS_START_DEPTH = 0.7;
  var PRESS_START_COMPRESSION = -0.033;
  var PRESS_FLASH_PEAK_MS = 30;
  var QUICK_TAP_MS = 90;
  var TAP_RELEASE_MS = 70;
  var HOLD_RELEASE_MS = 110;
  var LABEL_REVEAL_MS = 180;
  var PLUG_DWELL_MS = 3e3;
  var PLUG_SEAT_MS = 200;
  var PLUG_BOOT_DELAY_MS = 145;
  var RESET_BOOT_DELAY_MS = 46;
  var CORD_MODE_MS = 260;
  var tactileButtons = /* @__PURE__ */ new Map();
  for (const button of document.querySelectorAll("[data-tactile-button]")) {
    let readyTarget2 = function() {
      return Number(
        !button.disabled && !document.hidden && ((buttonStaysPut2() ? isOverParkedButton2() : mouseOver) || document.activeElement === button && document.documentElement.dataset.focusInput === "keyboard" && document.hasFocus())
      );
    }, plugProgress2 = function(time) {
      if (plugState === "seated" || plugStartedAt === null) return 1;
      return clamp((time - plugStartedAt) / plugTransitionDuration[plugState], 0, 1);
    }, buttonStaysPut2 = function() {
      return plugState === "unplugged" || cordSlack;
    }, isOverParkedButton2 = function(rect = stage.getBoundingClientRect()) {
      if (!hoverPoint || !rect.width || !rect.height) return false;
      const x = hoverPoint.x - (rect.left + rect.width / 2 + current.x);
      const y = hoverPoint.y - (rect.top + rect.height / 2 + current.y);
      return Math.abs(x) <= button.offsetWidth / 2 && Math.abs(y) <= button.offsetHeight / 2;
    }, cordSlackAmount2 = function(time) {
      const destination = cordSlack ? 1 : 0;
      if (!slackChange) return destination;
      const { from, startedAt } = slackChange;
      const progress = clamp((time - startedAt) / CORD_MODE_MS, 0, 1);
      if (progress === 1) slackChange = null;
      return destination + (from - destination) * (1 - progress) ** 2;
    }, alignPlug2 = function(cable) {
      if (!power) return;
      let next = null;
      if (cable) {
        const y = cable.startY;
        const nearest = y < (outletSockets.top + outletSockets.bottom) / 2 ? "top" : "bottom";
        if (Math.abs(cable.startX) <= 18 && Math.abs(y - outletSockets[nearest]) <= 14)
          next = { socket: nearest, x: cable.startX, y: cable.startY, angle: cable.plugAngle };
      }
      const previous = docking?.socket;
      docking = next;
      if (next?.socket === previous) return;
      window.clearTimeout(dockTimer);
      plugTap = null;
      if (plugControl) {
        const key = next ? "reconnectPlug" : "cordSlack";
        const label2 = message2(key);
        plugControl.setAttribute("data-i18n-aria-label", key);
        plugControl.setAttribute("data-i18n-title", key);
        plugControl.setAttribute("aria-label", label2);
        plugControl.setAttribute("title", label2);
        if (next) plugControl.removeAttribute("aria-pressed");
        else plugControl.setAttribute("aria-pressed", String(cordSlack));
      }
      if (next) {
        power.dataset.dock = next.socket;
        if (outletControl) outletControl.dataset.dock = next.socket;
        dockTimer = window.setTimeout(reconnectPlug2, PLUG_DWELL_MS);
      } else {
        delete power.dataset.dock;
        if (outletControl) delete outletControl.dataset.dock;
      }
    }, bootIfVisible2 = function() {
      if (!gameButton || !power || booted || document.hidden || !stage.clientWidth || !stage.clientHeight)
        return;
      booted = true;
      if (current.powered === false) return;
      clickSound.hardware("boot");
      if (!reducedMotion.matches) {
        bootStartedAt = performance.now();
        animate2();
      }
    }, updatePower2 = function(time, bootDelay = 0) {
      const powered2 = !outletTripped && plugState !== "unplugged";
      if (current.powered !== false === powered2) return false;
      current.powered = powered2;
      clickSound.setPowered(powered2);
      if (powered2) {
        drainStartedAt = null;
        bootStartedAt = reducedMotion.matches ? null : time + bootDelay;
        if (phase !== "idle") {
          current.copper = 1;
          current.labelCharge = reducedMotion.matches ? 0 : 1;
          scheduleHoldBeat2();
        }
      } else {
        bootStartedAt = null;
        drainStartedAt = reducedMotion.matches ? null : time;
        releaseCopper = 0;
        current.copper = current.flash = current.holdLight = current.labelCharge = 0;
        clearResponse2();
        effects.replaceChildren();
        window.clearTimeout(beatTimer);
      }
      return powered2;
    }, reconnectPlug2 = function(gesture = false) {
      if (!power || !docking || !pointers.size && !dockWhileParked || button.disabled || document.hidden || !stage.clientWidth || !stage.clientHeight)
        return;
      const { socket: nextSocket, x, y, angle } = docking;
      const restoreFocus = plugControl && document.activeElement === plugControl;
      alignPlug2(null);
      dockWhileParked = false;
      socket = nextSocket;
      const time = performance.now();
      seating = reducedMotion.matches ? null : { x, y, angle, startedAt: time };
      plugState = power.dataset.plug = "seated";
      plugStartedAt = null;
      plugPulls.reseat();
      if (outletControl) outletControl.disabled = false;
      const poweredOn = updatePower2(time, PLUG_BOOT_DELAY_MS);
      clickSound.hardware("plug-in", {
        gesture,
        bootDelay: poweredOn ? PLUG_BOOT_DELAY_MS : void 0
      });
      if (pointers.size) {
        dragFromX = target.x;
        dragFromY = target.y;
        aimPointers2();
      } else {
        if (!buttonStaysPut2()) target.x = target.y = 0;
        animate2();
      }
      if (!reducedMotion.matches) paint2();
      if (restoreFocus) button.focus({ preventScroll: true });
    }, activatePlug2 = function() {
      if (plugState !== "unplugged" || !plugControl || plugControl.hidden || button.disabled || document.hidden)
        return;
      if (docking) {
        reconnectPlug2(true);
        return;
      }
      const startedAt = performance.now();
      const from = cordSlackAmount2(startedAt);
      cordSlack = !cordSlack;
      clickSound.hardware(cordSlack ? "cord-slack" : "cord-tension", { gesture: true });
      slackChange = reducedMotion.matches ? null : { from, startedAt };
      plugControl.setAttribute("aria-pressed", String(cordSlack));
      animate2();
    }, paint2 = function(time = performance.now(), dt = 0) {
      if (seating && time - seating.startedAt >= PLUG_SEAT_MS) seating = null;
      if (bootStartedAt !== null && time - bootStartedAt >= powerBootDuration) bootStartedAt = null;
      const progress = plugProgress2(time);
      current.drainLight = drainStartedAt === null ? 0 : powerDrainLighting(time - drainStartedAt);
      current.bootLight = bootStartedAt === null ? 0 : powerBootLighting(time - bootStartedAt);
      if (reducedMotion.matches) readiness = readyTarget2();
      current.readyLight = readiness * (1 - Math.max(current.press, current.copper));
      rig.style.setProperty("--ready-light", current.readyLight.toFixed(3));
      const labelProgress = labelChangedAt === null ? 1 : clamp((time - labelChangedAt) / LABEL_REVEAL_MS, 0, 1);
      if (labelProgress === 1) labelChangedAt = null;
      current.labelOpacity = 1 - 0.68 * (1 - labelProgress) ** 2;
      rig.style.setProperty("--label-opacity", current.labelOpacity.toFixed(3));
      const cable = power && stage.clientWidth && stage.clientHeight ? projectButtonPower(current, button.offsetWidth, plugState, {
        progress,
        looseBeforeDetach,
        hangAngle: plugSwing.angle,
        socketY: outletControl ? outletSockets[socket] : 0,
        slack: cordSlackAmount2(time),
        seating: seating ? {
          ...seating,
          remaining: (1 - clamp((time - seating.startedAt) / PLUG_SEAT_MS, 0, 1)) ** 2
        } : void 0
      }) : null;
      if (power && cable) {
        stage.style.setProperty("--cord-scale", cable.thickness.toFixed(3));
        power.setAttribute(
          "viewBox",
          `${-stage.clientWidth / 2} ${-stage.clientHeight / 2} ${stage.clientWidth} ${stage.clientHeight}`
        );
        for (const cord of cords ?? []) cord.setAttribute("d", cable.cord);
        plug?.setAttribute("transform", cable.plugTransform);
        plugEdge?.setAttribute("transform", cable.plugEdgeTransform);
      }
      if (plugControl) {
        const available = !!cable && plugState === "unplugged" && progress === 1 && !button.disabled;
        if (plugControl.hidden === available) plugControl.hidden = !available;
        if (available) {
          plugControl.style.setProperty("--plug-x", `${cable.startX}px`);
          plugControl.style.setProperty("--plug-y", `${cable.startY}px`);
        }
      }
      if (gameButton && plugState === "unplugged")
        alignPlug2(
          progress === 1 && (pointers.size || dockWhileParked) && !button.disabled && !document.hidden ? cable : null
        );
      current.reducedMotion = reducedMotion.matches;
      const lettering = projectButtonLettering(current);
      rig.style.setProperty("--label-scale-x", lettering.scaleX.toFixed(3));
      rig.style.setProperty("--label-scale-y", lettering.scaleY.toFixed(3));
      rig.style.setProperty(
        "--label-shift",
        `${(lettering.shiftY * button.offsetHeight).toFixed(3)}px`
      );
      rig.style.setProperty("--label-ink", lettering.ink.toFixed(3));
      rig.style.setProperty("--label-charge", lettering.charge.toFixed(3));
      rig.style.setProperty("--label-light", lettering.light.toFixed(3));
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
        current.copper * 0.38 + current.flash * 0.65 + current.response * 0.8 + (current.holdLight ?? 0) + current.drainLight + current.bootLight
      );
      rig.style.setProperty("--glow-intensity", glow.toFixed(3));
      const glowColor = current.response > 0 ? current.responseColor : [0.22, 0.72, 0.46];
      rig.style.setProperty(
        "--glow-color",
        `rgb(${glowColor.map((value) => Math.round(value * 255)).join(" ")})`
      );
      renderer?.draw(current);
      const readoutMoving = readout && (dt > 0 || reducedMotion.matches) && moveReadout2(readout, dt);
      return readoutMoving;
    }, moveReadout2 = function(readout2, dt) {
      let offset = 0;
      if (Math.abs(current.y) > 8) {
        const face = button.getBoundingClientRect();
        const text = readout2.getBoundingClientRect();
        const top = text.top - readoutOffset;
        const bottom = text.bottom - readoutOffset;
        const clearance = 22;
        if (face.bottom + clearance > top && face.top - clearance < bottom) {
          const below = Math.ceil(face.bottom + clearance - top);
          const above = Math.floor(face.top - clearance - bottom);
          offset = bottom + below <= window.innerHeight - 8 ? below : Math.max(8 - top, above);
        }
      }
      const distance = offset - readoutOffset;
      const reduce = reducedMotion.matches;
      const nextOffset = reduce || Math.abs(distance) < 0.5 ? offset : readoutOffset + distance * (1 - Math.exp(-0.2 * dt));
      const shade = reduce ? 1 : 1 - 0.65 * clamp(Math.abs(distance) / 90, 0, 1);
      const nextOpacity = reduce || Math.abs(shade - readoutOpacity) < 5e-3 ? shade : readoutOpacity + (shade - readoutOpacity) * (1 - Math.exp(-0.42 * dt));
      if (readoutOffset !== nextOffset) {
        readoutOffset = nextOffset;
        readout2.style.setProperty("--readout-offset", `${nextOffset}px`);
      }
      if (readoutOpacity !== nextOpacity) {
        readoutOpacity = nextOpacity;
        readout2.style.setProperty("--readout-opacity", nextOpacity.toFixed(3));
      }
      return nextOffset !== offset || nextOpacity !== 1;
    }, tick2 = function(time) {
      const dt = lastFrame ? clamp((time - lastFrame) / (1e3 / 60), 0.25, 2) : 1;
      lastFrame = time;
      let moving = false;
      const ready = readyTarget2();
      readiness += (ready - readiness) * (1 - Math.exp(-0.28 * dt));
      if (Math.abs(ready - readiness) > 5e-3) moving = true;
      else readiness = ready;
      current.flash *= Math.pow(0.68, dt);
      if (phase !== "idle" && !reducedMotion.matches) {
        const elapsed = Math.max(0, time - pressedAt);
        const progress = clamp(elapsed / PRESS_ATTACK_MS, 0, 1);
        current.press = 1 - (1 - pressFrom) * (1 - progress) ** 2;
        if (progress < 1) moving = true;
        if (current.powered !== false) {
          current.labelPhase = elapsed / 1e3;
          if (gameButton) current.holdLight = holdLighting(elapsed);
          const rise = clamp(elapsed / PRESS_FLASH_PEAK_MS, 0, 1);
          const fall = clamp((elapsed - PRESS_FLASH_PEAK_MS) / 100, 0, 1);
          current.flash = Math.max(current.flash, (0.45 + 0.5 * rise) * (1 - fall) ** 2);
          moving = true;
        }
      }
      if (releasedAt !== null) {
        const progress = clamp((time - releasedAt) / releaseDuration, 0, 1);
        const returnAmount = (1 - progress) ** 2;
        current.press = releaseDepth * returnAmount;
        current.copper = releaseCopper * returnAmount;
        current.labelCharge = releaseCopper ? returnAmount : 0;
        if (progress < 1) moving = true;
        else releasedAt = null;
      }
      aimTilt2();
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
      if (current.flash > 5e-3) moving = true;
      else current.flash = 0;
      if (responseStarted !== null) {
        current.responseProgress = clamp((time - responseStarted) / responseDuration, 0, 1);
        current.response = Math.pow(1 - current.responseProgress, 0.65);
        if (current.responseProgress < 1) moving = true;
        else responseStarted = null;
      }
      const animatingPower = plugProgress2(time) < 1 || drainStartedAt !== null && time - drainStartedAt < powerDrainDuration;
      const swinging = plugState === "unplugged" && !reducedMotion.matches && plugSwing.step(current.x, button.offsetWidth, dt);
      const readoutMoving = paint2(time, dt);
      frame = (moving || animatingPower || bootStartedAt !== null || labelChangedAt !== null || swinging || seating || slackChange || readoutMoving) && !document.hidden ? requestAnimationFrame(tick2) : 0;
      if (!frame) lastFrame = 0;
    }, animate2 = function() {
      if (reducedMotion.matches) {
        for (const key of keys) {
          current[key] = (pointers.size || buttonStaysPut2()) && (key === "x" || key === "y") ? target[key] : 0;
          velocity[key] = 0;
        }
        current.flash = 0;
        current.labelCharge = 0;
        plugSwing.reset(current.x);
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
    }, scheduleHoldBeat2 = function() {
      if (!gameButton || current.powered === false) return;
      const elapsed = performance.now() - pressedAt;
      let nextBeat = (Math.floor(elapsed / holdBeat) + 1) * holdBeat;
      const onBeat = () => {
        if (phase === "idle" || button.disabled || document.hidden || current.powered === false)
          return;
        const elapsed2 = performance.now() - pressedAt;
        if (elapsed2 >= nextBeat) {
          clickSound.play("hold");
          nextBeat = (Math.floor(elapsed2 / holdBeat) + 1) * holdBeat;
        }
        beatTimer = window.setTimeout(onBeat, Math.max(1, nextBeat - elapsed2));
      };
      beatTimer = window.setTimeout(onBeat, nextBeat - elapsed);
    }, begin2 = function() {
      if (gameButton) clickSound.play("press");
      window.clearTimeout(holdTimer);
      clearResponse2();
      coastUntil = 0;
      pressedAt = performance.now();
      releasedAt = null;
      pressFrom = Math.max(PRESS_START_DEPTH, current.press);
      current.press = reducedMotion.matches ? 1 : pressFrom;
      current.copper = current.powered === false ? 0 : 1;
      current.labelCharge = reducedMotion.matches ? 0 : current.copper;
      current.holdLight = 0;
      current.labelPhase = 0;
      target.pop = reducedMotion.matches ? 0 : -0.045;
      if (!reducedMotion.matches) current.pop = Math.min(PRESS_START_COMPRESSION, current.pop);
      velocity.pop = Math.min(0, velocity.pop);
      current.flash = 0;
      setPhase2("pressed");
      if (reducedMotion.matches) {
        paint2();
        animate2();
      } else burst2(true);
      holdTimer = window.setTimeout(() => setPhase2("held"), 180);
      scheduleHoldBeat2();
    }, aimHover2 = function() {
      if (hoverPoint && !button.disabled && !buttonStaysPut2() && !reducedMotion.matches) {
        const rect = stage.getBoundingClientRect();
        if (rect.width && rect.height) {
          const nx = (hoverPoint.x - rect.left) / rect.width * 2 - 1;
          const ny = (hoverPoint.y - rect.top) / rect.height * 2 - 1;
          const near = mouseOver || Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
          target.x = near ? clamp(nx, -1, 1) * 4 : 0;
          target.y = near ? clamp(ny, -1, 1) * 4 : 0;
        }
      }
      animate2();
    }, refreshHover2 = function() {
      mouseOver = hoverPoint !== null && document.elementFromPoint(hoverPoint.x, hoverPoint.y) === button;
      aimHover2();
    }, aimTilt2 = function() {
      target.rx = target.ry = 0;
      if (button.disabled || reducedMotion.matches) return;
      const point = pointers.size ? mouseGrip === null ? null : pointers.get(mouseGrip) : hoverPoint;
      if (!point) return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const parked = buttonStaysPut2();
      if (!pointers.size) {
        const overStage = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
        if (parked ? !isOverParkedButton2(rect) : !mouseOver && !overStage) return;
      }
      const center = pointers.size ? target : current;
      const x = point.x - (rect.left + rect.width / 2 + center.x);
      const y = point.y - (rect.top + rect.height / 2 + center.y);
      const halfWidth = (parked ? button.offsetWidth : rect.width) / 2;
      const halfHeight = (parked ? button.offsetHeight : rect.height) / 2;
      const tilt = 1 - 0.28 * current.press;
      target.rx = -clamp(y / halfHeight, -1, 1) * 16 * tilt;
      target.ry = clamp(x / halfWidth, -1, 1) * 22 * tilt;
    }, release2 = function(cancelled = false) {
      plugPulls.endPull();
      if (cancelled && gameButton) clickSound.cancelPending();
      activeKey = null;
      window.clearTimeout(holdTimer);
      window.clearTimeout(beatTimer);
      current.holdLight = 0;
      const wasPressed = phase !== "idle";
      const quick = performance.now() - pressedAt < QUICK_TAP_MS;
      releaseDepth = wasPressed && !cancelled && !reducedMotion.matches ? current.press : 0;
      current.press = releaseDepth;
      if (cancelled) current.labelCharge = 0;
      target.pop = 0;
      if (!releaseDepth) current.pop = velocity.pop = 0;
      releaseDuration = quick ? TAP_RELEASE_MS : HOLD_RELEASE_MS;
      releaseCopper = wasPressed && !cancelled && !reducedMotion.matches && current.powered !== false ? quick ? 0.72 : 1 : 0;
      current.copper = releaseCopper;
      releasedAt = releaseDepth ? performance.now() : null;
      current.flash = 0;
      setPhase2("idle");
      paint2();
      animate2();
    }, keepParkedButtonInView2 = function() {
      const stageRect = stage.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height) return false;
      const margin = 16;
      const x = stageRect.left + stageRect.width / 2;
      const y = stageRect.top + stageRect.height / 2;
      const nextX = clamp(target.x, margin - x, window.innerWidth - margin - x);
      const nextY = clamp(target.y, margin - y, window.innerHeight - margin - y);
      if (nextX === target.x && nextY === target.y) return false;
      target.x = nextX;
      target.y = nextY;
      return true;
    }, reset2 = function(cancelled = true) {
      dockWhileParked = false;
      outletTouch = null;
      plugTap = null;
      clearResponse2();
      const captured = [...pointers.keys()];
      pointers.clear();
      mouseGrip = null;
      for (const id of captured) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
      release2(cancelled);
      releasedAt = null;
      coastUntil = 0;
      current.copper = 0;
      current.labelCharge = 0;
      current.labelPhase = 0;
      if (!buttonStaysPut2()) target.x = target.y = 0;
      target.rx = target.ry = 0;
      animate2();
    }, clearResponse2 = function() {
      responseStarted = null;
      current.response = 0;
      current.responseProgress = 0;
      current.responseColor = [1, 0.78, 0.32];
      delete stage.dataset.response;
    }, respond2 = function(state, milliseconds = 0) {
      if (current.powered === false) return;
      current.responseColor = state === "error" ? [1, 0.49, 0.47] : state === "slow" ? [0.64, 0.54, 1] : state === "limited" ? [1, 0.58, 0.26] : state === "pending" ? [1, 0.78, 0.32] : state === "fast" ? [0.38, 0.8, 0.65] : [0.35, 0.67, 0.94];
      stage.dataset.response = state;
      responseDuration = clamp(300 + milliseconds * 0.4, 320, 800);
      current.responseProgress = reducedMotion.matches ? 0.5 : 0;
      current.response = state === "pending" ? 0.18 : reducedMotion.matches ? 0.22 : 1;
      responseStarted = state === "pending" || reducedMotion.matches ? null : performance.now();
      paint2();
      animate2();
    }, aimPointers2 = function(trackPull = false) {
      const points = [...pointers.values()];
      const clientX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const clientY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      if (!trackPull) {
        dragOriginX = clientX - (target.x - dragFromX);
        dragOriginY = clientY - (target.y - dragFromY);
      }
      const pulledX = clientX - dragOriginX;
      const pulledY = clientY - dragOriginY;
      target.x = dragFromX + pulledX;
      target.y = dragFromY + pulledY;
      if (trackPull && gameButton && power && !seating) {
        const nextPlug = plugPulls.pull(pulledX, pulledY, button.offsetWidth);
        if (nextPlug) {
          const now = performance.now();
          if (nextPlug === "unplugged") {
            looseBeforeDetach = plugProgress2(now);
            plugSwing.reset(current.x);
          }
          plugState = nextPlug;
          plugStartedAt = reducedMotion.matches ? null : now;
          power.dataset.plug = nextPlug;
          if (nextPlug === "loose") {
            clickSound.hardware("plug-loose");
          } else {
            outletTouch = null;
            if (outletControl) outletControl.disabled = true;
            updatePower2(now);
            clickSound.hardware("unplug");
          }
        }
      }
      animate2();
    }, burst2 = function(press = false) {
      if (reducedMotion.matches) return;
      const quick = press || releaseDuration === TAP_RELEASE_MS;
      if (!press && phase === "idle") {
        velocity.pop = quick ? 0.05 : 0.022;
      }
      if (current.powered === false) {
        if (press) paint2();
        animate2();
        return;
      }
      current.flash = press ? 0.45 : quick ? 0.85 : 0.55;
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
    }, pressOutlet2 = function() {
      if (!outletControl || plugState === "unplugged" || document.hidden) return;
      outletTripped = !outletTripped;
      const cue = outletTripped ? "test" : "reset";
      outletControl.setAttribute("aria-pressed", String(outletTripped));
      outletControl.dataset.press = cue;
      const poweredOn = updatePower2(performance.now(), RESET_BOOT_DELAY_MS);
      clickSound.hardware(cue, {
        gesture: true,
        bootDelay: poweredOn ? RESET_BOOT_DELAY_MS : void 0
      });
      if (!reducedMotion.matches) paint2();
      animate2();
    }, endPointer2 = function(event, cancelled = false) {
      if (!pointers.has(event.pointerId)) return;
      const rect = button.getBoundingClientRect();
      const slop = event.pointerType === "touch" ? 24 : 12;
      const near = (dx, dy) => event.clientX >= rect.left + dx - slop && event.clientX <= rect.right + dx + slop && event.clientY >= rect.top + dy - slop && event.clientY <= rect.bottom + dy + slop;
      const inViewport = event.clientX >= 0 && event.clientX < window.innerWidth && event.clientY >= 0 && event.clientY < window.innerHeight;
      const inside = inViewport && (near(0, 0) || near(target.x - current.x, target.y - current.y));
      if (event.pointerId === mouseGrip) {
        mouseGrip = null;
        hoverPoint = !cancelled && inViewport ? { x: event.clientX, y: event.clientY } : null;
        if (!hoverPoint) mouseOver = false;
      }
      const point = pointers.get(event.pointerId);
      if ((cancelled || !inside) && pointers.size > 1 && gameButton) clickSound.cancelPending();
      pointers.delete(event.pointerId);
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      if (!pointers.size) {
        if (buttonStaysPut2()) {
          dockWhileParked = plugState === "unplugged" && !cancelled && inside;
          keepParkedButtonInView2();
          velocity.x = velocity.y = 0;
        }
        release2(cancelled || !inside);
      } else aimPointers2();
      if (!cancelled && inside && !button.disabled) activateRelease2(event);
      if (pointers.size) return;
      if (buttonStaysPut2()) {
        refreshHover2();
        return;
      }
      if (!cancelled && inside && !reducedMotion.matches && performance.now() - point.movedAt < 70 && Math.hypot(event.clientX - point.startX, event.clientY - point.startY) >= 14 && Math.hypot(point.vx, point.vy) >= 0.12) {
        coastUntil = performance.now() + 80;
        coastFromX = current.x;
        coastFromY = current.y;
        velocity.x = clamp(point.vx * 10, -14, 14);
        velocity.y = clamp(point.vy * 10, -14, 14);
      }
      target.x = target.y = 0;
      refreshHover2();
    }, scheduleRenderer2 = function() {
      if (setupFrame || document.hidden || !stage.clientWidth || !stage.clientHeight) return;
      setupFrame = requestAnimationFrame(() => {
        setupFrame = 0;
        if (document.hidden || !stage.clientWidth || !stage.clientHeight) return;
        renderer ??= createButtonRenderer(stage, button);
        renderer.resume();
        bootIfVisible2();
        paint2();
      });
    };
    readyTarget = readyTarget2, plugProgress = plugProgress2, buttonStaysPut = buttonStaysPut2, isOverParkedButton = isOverParkedButton2, cordSlackAmount = cordSlackAmount2, alignPlug = alignPlug2, bootIfVisible = bootIfVisible2, updatePower = updatePower2, reconnectPlug = reconnectPlug2, activatePlug = activatePlug2, paint = paint2, moveReadout = moveReadout2, tick = tick2, animate = animate2, setPhase = setPhase2, scheduleHoldBeat = scheduleHoldBeat2, begin = begin2, aimHover = aimHover2, refreshHover = refreshHover2, aimTilt = aimTilt2, release = release2, keepParkedButtonInView = keepParkedButtonInView2, reset = reset2, clearResponse = clearResponse2, respond = respond2, aimPointers = aimPointers2, burst = burst2, activateRelease = activateRelease2, pressOutlet = pressOutlet2, endPointer = endPointer2, scheduleRenderer = scheduleRenderer2;
    const maybeStage = button.closest(".button-stage");
    if (!maybeStage) throw new Error("Tactile button needs a stage");
    const stage = maybeStage;
    const rig = required(".button-rig", stage);
    const label = required(".button-label", button);
    let labelText = label.textContent;
    let labelDirection = label.dir;
    let labelChangedAt = null;
    const power = stage.querySelector(".button-power");
    const cords = power?.querySelectorAll(".power-cord");
    const plug = power?.querySelector(".power-plug");
    const plugControl = stage.querySelector(".plug-control");
    const outletControl = stage.querySelector(".outlet-control");
    const plugEdge = stage.querySelector(".plug-edge");
    const gameButton = button.id === "click-button";
    const plugPulls = createPlugPullTracker();
    const plugSwing = createPlugSwing();
    let plugState = "seated";
    let cordSlack = false;
    let slackChange = null;
    let plugStartedAt = null;
    let looseBeforeDetach = 1;
    let outletTripped = false;
    let drainStartedAt = null;
    let bootStartedAt = null;
    let booted = false;
    let outletTouch = null;
    let socket = "bottom";
    let docking = null;
    let dockWhileParked = false;
    let dockTimer = 0;
    let plugTap = null;
    let seating = null;
    const readout = gameButton ? document.querySelector(".game-readout") : null;
    let readoutOffset = 0;
    let readoutOpacity = 1;
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
      labelCharge: 0,
      labelPhase: 0,
      copper: 0,
      pop: 0,
      flash: 0,
      response: 0,
      responseProgress: 0,
      responseColor: [0.35, 0.67, 0.94]
    };
    const target = { ...current }, velocity = { ...current };
    let renderer = null;
    let stageWasVisible = false;
    let setupFrame = 0, frame = 0, lastFrame = 0;
    const pointers = /* @__PURE__ */ new Map();
    let dragFromX = 0, dragFromY = 0;
    let dragOriginX = 0, dragOriginY = 0;
    let coastUntil = 0;
    let coastFromX = 0, coastFromY = 0;
    let activeKey = null;
    let mouseGrip = null;
    let mouseOver = false;
    let hoverPoint = null;
    let readiness = 0;
    let activatingRelease = false;
    let pressedAt = 0, pressFrom = 0, releasedAt = null, releaseDepth = 0, releaseCopper = 0, releaseDuration = TAP_RELEASE_MS, holdTimer = 0, beatTimer = 0, phase = "idle";
    let responseStarted = null;
    let responseDuration = 500;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    if (outletControl) {
      outletControl.addEventListener("click", (event) => {
        if (event.pointerType !== "touch" || event.isPrimary || event.detail === 0) pressOutlet2();
      });
      outletControl.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || event.isPrimary || event.button !== 0 || outletTouch)
          return;
        event.preventDefault();
        outletControl.setPointerCapture(event.pointerId);
        outletTouch = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      outletControl.addEventListener("pointermove", (event) => {
        if (event.pointerId === outletTouch?.id && Math.hypot(event.clientX - outletTouch.x, event.clientY - outletTouch.y) > 12)
          outletTouch = null;
      });
      outletControl.addEventListener("pointerup", (event) => {
        if (event.pointerId !== outletTouch?.id) return;
        const tapped = Math.hypot(event.clientX - outletTouch.x, event.clientY - outletTouch.y) <= 12;
        outletTouch = null;
        if (tapped) pressOutlet2();
      });
      const cancelOutletTouch = (event) => {
        if (event.pointerId === outletTouch?.id) outletTouch = null;
      };
      outletControl.addEventListener("pointercancel", cancelOutletTouch);
      outletControl.addEventListener("lostpointercapture", cancelOutletTouch);
    }
    if (plugControl) {
      let movedOffPlug2 = function(event) {
        return !!plugTap && Math.hypot(event.clientX - plugTap.x, event.clientY - plugTap.y) > 12;
      };
      movedOffPlug = movedOffPlug2;
      plugControl.addEventListener("click", (event) => {
        if (event.detail === 0) activatePlug2();
      });
      plugControl.addEventListener("pointerdown", (event) => {
        if (plugControl.hidden || plugTap || event.button !== 0 || pointers.has(event.pointerId))
          return;
        event.preventDefault();
        plugControl.setPointerCapture(event.pointerId);
        plugTap = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      plugControl.addEventListener("pointermove", (event) => {
        if (plugTap?.id === event.pointerId && movedOffPlug2(event)) plugTap = null;
      });
      plugControl.addEventListener("pointerup", (event) => {
        if (plugTap?.id !== event.pointerId) return;
        const tapped = !movedOffPlug2(event);
        plugTap = null;
        if (tapped) activatePlug2();
      });
      const cancelTap = (event) => {
        if (plugTap?.id === event.pointerId) plugTap = null;
      };
      plugControl.addEventListener("pointercancel", cancelTap);
      plugControl.addEventListener("lostpointercapture", cancelTap);
      window.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "mouse" || !buttonStaysPut2() || pointers.size) return;
        const rect = stage.getBoundingClientRect();
        const wasOver = isOverParkedButton2(rect);
        hoverPoint = { x: event.clientX, y: event.clientY };
        if (!button.disabled && (wasOver || isOverParkedButton2(rect))) animate2();
      });
      document.documentElement.addEventListener("pointerleave", (event) => {
        if (event.pointerType !== "mouse" || !buttonStaysPut2() || mouseGrip !== null) return;
        hoverPoint = null;
        mouseOver = false;
        animate2();
      });
    }
    stage.addEventListener("pointermove", (event) => {
      const point = pointers.get(event.pointerId);
      const stageHover = event.pointerType === "mouse" && !buttonStaysPut2();
      if (stageHover || point && event.pointerType === "mouse")
        hoverPoint = { x: event.clientX, y: event.clientY };
      if (button.disabled) return;
      if (point) {
        const now = performance.now(), elapsed = now - point.movedAt;
        const dt = clamp(elapsed, 8, 50);
        point.vx = elapsed > 80 ? 0 : point.vx * 0.35 + (event.clientX - point.x) / dt * 0.65;
        point.vy = elapsed > 80 ? 0 : point.vy * 0.35 + (event.clientY - point.y) / dt * 0.65;
        point.movedAt = now;
        point.x = event.clientX;
        point.y = event.clientY;
        aimPointers2(true);
      } else if (!pointers.size && stageHover) aimHover2();
    });
    stage.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "mouse" || mouseGrip !== null || buttonStaysPut2()) return;
      hoverPoint = null;
      if (!pointers.size) {
        target.x = target.y = 0;
        if (activeKey === null && performance.now() >= coastUntil) {
          reset2(false);
          return;
        }
      }
      animate2();
    });
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      hoverPoint = { x: event.clientX, y: event.clientY };
      mouseOver = true;
      if (!pointers.size && !button.disabled) aimHover2();
      else animate2();
    });
    button.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "mouse") return;
      mouseOver = false;
      if (!buttonStaysPut2()) animate2();
    });
    button.addEventListener("pointerdown", (event) => {
      if (gameButton && event.pointerType === "mouse" && event.button === 1) event.preventDefault();
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
      if (event.pointerType === "mouse") {
        mouseGrip = event.pointerId;
        hoverPoint = { x: event.clientX, y: event.clientY };
      }
      if (pointers.size === 1) {
        dragFromX = target.x = current.x;
        dragFromY = target.y = current.y;
        velocity.x = velocity.y = 0;
        begin2();
      } else if (gameButton) clickSound.play("press");
      button.setPointerCapture(event.pointerId);
      aimPointers2();
    });
    button.addEventListener("pointerup", (event) => endPointer2(event));
    button.addEventListener("pointercancel", (event) => endPointer2(event, true));
    button.addEventListener("lostpointercapture", (event) => endPointer2(event, true));
    button.addEventListener("dragstart", (event) => event.preventDefault());
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("auxclick", (event) => {
      if (gameButton && !button.disabled && (event.button === 1 || event.button === 2))
        event.preventDefault();
    });
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
    button.addEventListener("focus", animate2);
    button.addEventListener("blur", () => {
      if (activeKey !== null) reset2();
      else animate2();
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
      if (gameButton) clickSound.play("release");
      burst2();
    });
    new MutationObserver(() => {
      if (button.disabled) reset2();
      else {
        if (plugState === "unplugged") paint2();
        refreshHover2();
      }
    }).observe(button, { attributes: true, attributeFilter: ["disabled"] });
    new MutationObserver(() => {
      if (document.activeElement === button) animate2();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-focus-input"] });
    new MutationObserver(() => {
      if (label.textContent !== labelText || label.dir !== labelDirection) {
        labelText = label.textContent;
        labelDirection = label.dir;
        labelChangedAt = !reducedMotion.matches && !document.hidden && stage.clientWidth && stage.clientHeight ? performance.now() : null;
      }
      paint2();
      if (labelChangedAt !== null) animate2();
    }).observe(label, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["lang", "dir"]
    });
    reducedMotion.addEventListener("change", () => {
      if (reducedMotion.matches) {
        labelChangedAt = null;
        plugStartedAt = null;
        drainStartedAt = null;
        bootStartedAt = null;
        seating = null;
        slackChange = null;
      }
      reset2();
      if (reducedMotion.matches) {
        for (const animation of effects.getAnimations({ subtree: true })) animation.cancel();
        effects.replaceChildren();
      } else refreshHover2();
    });
    window.addEventListener("focus", () => {
      if (document.activeElement === button) animate2();
    });
    window.addEventListener("blur", () => {
      hoverPoint = null;
      mouseOver = false;
      reset2();
    });
    window.addEventListener("resize", () => {
      if (buttonStaysPut2()) keepParkedButtonInView2();
      reset2();
      refreshHover2();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        labelChangedAt = null;
        hoverPoint = null;
        mouseOver = false;
        plugStartedAt = null;
        drainStartedAt = null;
        bootStartedAt = null;
        seating = null;
        plugSwing.reset(current.x);
        reset2();
      } else {
        scheduleRenderer2();
        bootIfVisible2();
        if (document.activeElement === button) animate2();
      }
    });
    new ResizeObserver(() => {
      if (buttonStaysPut2() && !pointers.size && keepParkedButtonInView2()) animate2();
      const visible2 = stage.clientWidth > 0 && stage.clientHeight > 0;
      if (visible2 && (!stageWasVisible || !renderer)) {
        scheduleRenderer2();
      } else {
        if (!visible2) renderer?.suspend();
        bootIfVisible2();
        paint2();
      }
      stageWasVisible = visible2;
    }).observe(stage);
    tactileButtons.set(button, { reset: reset2, respond: respond2 });
  }
  var movedOffPlug;
  var readyTarget;
  var plugProgress;
  var buttonStaysPut;
  var isOverParkedButton;
  var cordSlackAmount;
  var alignPlug;
  var bootIfVisible;
  var updatePower;
  var reconnectPlug;
  var activatePlug;
  var paint;
  var moveReadout;
  var tick;
  var animate;
  var setPhase;
  var scheduleHoldBeat;
  var begin;
  var aimHover;
  var refreshHover;
  var aimTilt;
  var release;
  var keepParkedButtonInView;
  var reset;
  var clearResponse;
  var respond;
  var aimPointers;
  var burst;
  var activateRelease;
  var pressOutlet;
  var endPointer;
  var scheduleRenderer;

  // frontend/click-feedback.ts
  var feedbackLabels = {
    waiting: "feedbackWaiting",
    limited: "feedbackCooldown",
    unconfirmed: "feedbackUnconfirmed",
    unsaved: "feedbackUnsaved"
  };
  var clickFeedback = (() => {
    const samples = [], live2 = /* @__PURE__ */ new Set();
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
      popup.style.left = `${100 * x / rect.width}%`;
      popup.style.top = `${100 * y / rect.height}%`;
      popup.append(score, timing);
      required(".score-effects", stage).append(popup);
      tactileButtons.get(button)?.respond("pending");
      const baseline = average();
      let phase = "pending";
      let measured = 0;
      function translate() {
        popup.lang = currentLanguage();
        popup.dir = languageDirection();
        score.textContent = phase === "limited" ? "\u2026" : phase === "unconfirmed" ? "?" : phase === "unsaved" ? "\xD7" : `+${formatNumber(1)}`;
        const average2 = formatUnit(Math.round(baseline), "millisecond");
        if (phase === "saved") {
          const time = formatUnit(Math.round(measured), "millisecond");
          timing.textContent = "";
          popup.title = message2(simulated ? "feedbackSimulatedHint" : "feedbackSavedHint", {
            time,
            average: average2
          });
        } else {
          timing.textContent = phase === "pending" ? "" : message2(feedbackLabels[phase]);
          popup.title = phase === "pending" || phase === "waiting" ? message2("feedbackAwaitingHint", { average: average2 }) : timing.textContent;
        }
      }
      translate();
      let animation = null;
      let removal = 0, settled = false;
      const slow = window.setTimeout(
        () => {
          if (!settled) {
            popup.dataset.state = "slow";
            phase = "waiting";
            translate();
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
        live2.delete(handle);
      }
      const handle = {
        remove,
        translate,
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
          clickSound.play(popup.dataset.state === "slow" ? "slow" : "saved");
          phase = "saved";
          measured = ms;
          translate();
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
          clickSound.play(limited ? "limited" : "error");
          phase = limited ? "limited" : uncertain ? "unconfirmed" : "unsaved";
          translate();
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
      live2.add(handle);
      while (live2.size > 32) live2.values().next().value?.remove();
      return handle;
    }
    onLanguageChange(() => {
      for (const handle of live2) handle.translate();
    });
    motionPreference.addEventListener("change", () => {
      if (motionPreference.matches) for (const handle of live2) handle.reduce();
    });
    return {
      start,
      reset() {
        for (const handle of live2) handle.remove();
        samples.length = 0;
      }
    };
  })();

  // frontend/option-preferences.ts
  function bindOptionPreferences(saveOption2) {
    const motionSetting = required("#motion-setting");
    const simulatedPingSetting = required("#simulated-ping");
    const soundToggle = required("#sound-toggle");
    const soundEnabled = required("#sound-enabled");
    const soundVolumeSetting = required("#sound-volume");
    const soundVolumeValue = required("#sound-volume-value");
    const soundReverbSetting = required("#sound-reverb");
    const soundProfileSetting = required("#sound-profile");
    const soundProfileDescription = required("#sound-profile-description");
    const soundPreview = required("#preview-sound");
    const profileOptions = soundProfiles.map((profile2) => {
      const option = document.createElement("option");
      option.value = profile2.id;
      soundProfileSetting.append(option);
      return { option, name: profile2.name };
    });
    function paintSoundVolume(percent) {
      const text = formatPercent(percent / 100);
      soundVolumeValue.textContent = text;
      soundVolumeSetting.setAttribute("aria-valuetext", text);
    }
    function paintSoundLabels() {
      paintSoundVolume(soundVolumeSetting.valueAsNumber);
      soundProfileDescription.textContent = message2(
        soundProfiles.find((profile2) => profile2.id === soundProfileSetting.value).description
      );
      soundToggle.setAttribute("aria-label", message2("sound"));
      soundToggle.title = message2(soundEnabled.checked ? "soundOn" : "soundOff");
      soundToggle.lang = currentLanguage();
    }
    function updateSoundOptions() {
      const { sound: enabled2, soundProfile, soundVolume, soundReverb } = gameSettings.value;
      clickSound.setProfile(soundProfile);
      clickSound.setVolume(soundVolume / 100);
      clickSound.setReverb(soundReverb);
      clickSound.setEnabled(enabled2);
      soundEnabled.checked = enabled2;
      soundVolumeSetting.value = String(soundVolume);
      soundReverbSetting.checked = soundReverb;
      soundProfileSetting.value = soundProfile;
      soundPreview.disabled = !enabled2;
      soundToggle.setAttribute("aria-pressed", String(enabled2));
      paintSoundLabels();
    }
    gameSettings.onChange(updateSoundOptions);
    updateSoundOptions();
    soundToggle.addEventListener("click", () => {
      try {
        gameSettings.update({ sound: !gameSettings.value.sound });
      } catch {
      }
      if (gameSettings.value.sound) clickSound.prepare();
    });
    function paintOptionLabels() {
      for (const { option, name } of profileOptions) option.textContent = message2(name);
      for (const option of simulatedPingSetting.querySelectorAll("[data-ping]"))
        option.textContent = message2("approximatePing", {
          time: formatUnit(Number(option.value), "millisecond")
        });
    }
    function updatePlayOptions() {
      const { motion: motion2, simulatedPing } = gameSettings.value;
      motionSetting.value = motion2;
      simulatedPingSetting.value = String(simulatedPing);
    }
    gameSettings.onChange(updatePlayOptions);
    updatePlayOptions();
    soundEnabled.addEventListener("change", () => {
      saveOption2({ sound: soundEnabled.checked });
      if (gameSettings.value.sound) clickSound.prepare();
    });
    soundVolumeSetting.addEventListener("input", () => {
      paintSoundVolume(soundVolumeSetting.valueAsNumber);
      clickSound.setVolume(soundVolumeSetting.valueAsNumber / 100);
    });
    soundVolumeSetting.addEventListener("change", () => {
      saveOption2({ soundVolume: soundVolumeSetting.valueAsNumber });
    });
    soundReverbSetting.addEventListener("change", () => {
      saveOption2({ soundReverb: soundReverbSetting.checked });
    });
    soundProfileSetting.addEventListener("change", () => {
      const profile2 = soundProfileSetting.value;
      if (isSoundProfile(profile2)) saveOption2({ soundProfile: profile2 });
    });
    soundPreview.addEventListener("click", () => clickSound.preview());
    motionSetting.addEventListener("change", () => {
      const motion2 = motionSetting.value;
      if (motion2 === "auto" || motion2 === "on" || motion2 === "off") saveOption2({ motion: motion2 });
    });
    simulatedPingSetting.addEventListener("change", () => {
      const simulatedPing = Number(simulatedPingSetting.value);
      if (isSimulatedPing(simulatedPing)) saveOption2({ simulatedPing });
    });
    return () => {
      paintOptionLabels();
      paintSoundLabels();
    };
  }

  // frontend/offline-worker.ts
  async function offlineWorkerReady() {
    try {
      const workers = navigator.serviceWorker;
      if (!workers) return false;
      const url = new URL("./service-worker.js", window.location.href).href;
      const registering = workers.register(url);
      if (workers.controller?.scriptURL === url) {
        void registering.catch(() => {
        });
        return true;
      }
      const { active, waiting, installing } = await registering;
      const worker = active ?? waiting ?? installing;
      if (!worker) return false;
      return new Promise((resolve) => {
        const check = () => {
          if (worker.state !== "activated" && worker.state !== "redundant") return;
          worker.removeEventListener("statechange", check);
          resolve(worker.state === "activated");
        };
        worker.addEventListener("statechange", check);
        check();
      });
    } catch {
      return false;
    }
  }

  // frontend/share.ts
  function currentSiteUrl() {
    if (typeof window === "undefined") return "";
    const url = new URL("./", window.location.href);
    return url.pathname === "/" ? url.origin : url.href;
  }
  function formatShareText(counters, local, options, siteUrl = currentSiteUrl()) {
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
          week: formatUnit(counters.progress?.week_streak ?? 0, "week"),
          month: formatUnit(counters.streak_counter_month?.count ?? 0, "month"),
          year: formatUnit(counters.streak_counter_year?.count ?? 0, "year")
        })
      );
    }
    if (options.siteLink && siteUrl) lines.push(message2("playLink", { url: siteUrl }));
    return lines.join("\n");
  }
  var statsShare = (() => {
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
      if (!currentStats) return;
      const preview = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
      const changed = text.value !== preview;
      text.value = preview;
      if (changed && announcement === "copied") announce("copyChanged");
    }
    async function copyCurrent() {
      if (busy || !currentStats) return;
      busy = true;
      const current = generation;
      const summary = formatShareText(currentStats.counters, currentStats.local, selectedOptions());
      text.value = summary;
      text.lang = currentLanguage();
      copyButton.setAttribute("aria-busy", "true");
      announce(null);
      let clipboardWrite;
      try {
        clipboardWrite = navigator.clipboard.writeText(summary);
      } catch {
        clipboardWrite = Promise.reject(new Error("Clipboard unavailable"));
      }
      try {
        await clipboardWrite;
        if (current === generation) announce(summary === text.value ? "copied" : "copyChanged");
      } catch {
        if (current !== generation) return;
        announce("clipboardUnavailable");
        if (dialog.open && summary === text.value) {
          text.focus();
          text.select();
        }
      } finally {
        if (current === generation) {
          busy = false;
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
    copyButton.addEventListener("click", copyCurrent);
    for (const option of Object.values(options)) option.addEventListener("change", updatePreview);
    return {
      reset() {
        generation++;
        busy = false;
        currentStats = null;
        window.clearTimeout(feedbackTimer);
        window.clearTimeout(clearTimer);
        copyButton.setAttribute("aria-busy", "false");
        announce(null);
        text.value = "";
        if (dialog.open) dialog.close();
      },
      open(counters, local) {
        currentStats = { counters, local };
        generation++;
        busy = false;
        copyButton.setAttribute("aria-busy", "false");
        announce(null);
        updatePreview();
        if (!dialog.open) dialog.showModal();
      }
    };
  })();

  // frontend/language-picker.ts
  var svgNS = "http://www.w3.org/2000/svg";
  var flagHref = (flag) => `./language-flags.svg#${flag}`;
  function languagePicker() {
    const picker = required(".language-selector");
    const trigger = required("#language-setting");
    const menu = required("#language-menu");
    const selectedFlag = required("#language-flag");
    const selectedName = required("#language-name");
    const options = languages.map(({ code, name, dir, flag }) => {
      const button = document.createElement("button");
      const icon = document.createElementNS(svgNS, "svg");
      const use = document.createElementNS(svgNS, "use");
      const label = document.createElement("bdi");
      button.type = "button";
      button.value = code;
      button.tabIndex = -1;
      button.setAttribute("role", "menuitemradio");
      icon.setAttribute("class", "language-flag");
      icon.setAttribute("viewBox", "0 0 512 512");
      icon.setAttribute("aria-hidden", "true");
      use.setAttribute("href", flagHref(flag));
      icon.append(use);
      label.lang = code;
      label.dir = dir;
      label.textContent = name;
      button.append(icon, label);
      button.addEventListener("click", () => {
        trigger.title = message2(rememberLanguage(code) ? "languageHint" : "languageVisit");
        close(true);
      });
      menu.append(button);
      return button;
    });
    function open(index) {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      options[index].focus();
    }
    function close(restoreFocus = false) {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger.focus();
    }
    trigger.addEventListener("click", () => {
      if (menu.hidden) open(languages.findIndex(({ code }) => code === currentLanguage()));
      else close(true);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      open(event.key === "ArrowDown" ? 0 : options.length - 1);
    });
    menu.addEventListener("keydown", (event) => {
      const index = options.findIndex((option) => option === document.activeElement);
      let next;
      switch (event.key) {
        case "ArrowDown":
          next = (index + 1) % options.length;
          break;
        case "ArrowUp":
          next = (index + options.length - 1) % options.length;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = options.length - 1;
          break;
        case "Escape":
          event.preventDefault();
          close(true);
          return;
        case "Tab":
          close(true);
          return;
        default: {
          if (event.key.length !== 1 || event.key === " " || event.ctrlKey || event.metaKey || event.altKey)
            return;
          const prefix = event.key.toLowerCase();
          const match = languages.slice(index + 1).concat(languages.slice(0, index + 1)).find(({ name }) => name.toLowerCase().startsWith(prefix));
          if (!match) return;
          next = languages.indexOf(match);
        }
      }
      event.preventDefault();
      options[next].focus();
    });
    function dismissOutside(event) {
      if (!menu.hidden && !picker.contains(event.target)) close();
    }
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("pointerdown", dismissOutside);
    return () => {
      const selected = languages.find(({ code }) => code === currentLanguage());
      selectedFlag.setAttribute("href", flagHref(selected.flag));
      selectedName.textContent = selected.name;
      selectedName.lang = selected.code;
      selectedName.dir = selected.dir;
      for (const option of options) {
        option.setAttribute("aria-checked", String(option.value === selected.code));
      }
    };
  }

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

  // frontend/achievements.ts
  var translatedRequirements = /* @__PURE__ */ new Map();
  function requirement(goal, target, language2) {
    const key = `${language2}:${goal}:${target}`;
    const cached = translatedRequirements.get(key);
    if (cached !== void 0) return cached;
    let description;
    if (goal === "firstClick") description = message2(goal, {}, language2);
    else if (goal === "dayStreak" || goal === "weekStreak") {
      const duration = formatUnit(target, goal === "dayStreak" ? "day" : "week", language2);
      description = message2(
        goal === "dayStreak" ? "consecutiveDays" : "consecutiveWeeks",
        { duration },
        language2
      );
    } else {
      description = message2(goal, { count: formatNumber(target, language2) }, language2);
    }
    translatedRequirements.set(key, description);
    return description;
  }
  function badgesFor(data, progress, local) {
    const accountBadges = new Set(data.earned_badges);
    const language2 = currentLanguage();
    const clicks = data.click_count?.count ?? 0;
    const calendar = data.achievements ?? emptyClickAchievements;
    const last = Date.parse(data.click_count?.modified_time ?? "");
    const now = Date.now();
    const sameDay = utcDay(last) === utcDay(now);
    const sameWeek = utcWeek(utcDay(last)) === utcWeek(utcDay(now));
    const sameMonth = sameUtcMonth(new Date(last), new Date(now));
    const hours = sameDay ? countSetBits(calendar.hours) : 0;
    function badge(id, icon, name, hint, goal, current, target, earnedOffline = current >= target) {
      const earned2 = local ? earnedOffline : accountBadges.has(id);
      return {
        id,
        icon,
        name,
        hint,
        description: requirement(goal, target, language2),
        earned: earned2,
        meter: { count: earned2 ? target : Math.min(target, current), total: target }
      };
    }
    const badges2 = [
      badge("gone-click", "medal", "Gone Click", "An early milestone.", "firstClick", clicks, 1),
      badge("sentence", "clicks", "Sentence", "A few clicks in.", "clickMilestone", clicks, 25),
      badge("paragraph", "clicks", "Paragraph", "The clicks add up.", "clickMilestone", clicks, 100),
      badge("essay", "clicks", "Essay", "No time limit.", "clickMilestone", clicks, 500),
      badge(
        "clicks-for-days",
        "calendar",
        "Clicks for Days",
        "A short run of consecutive days.",
        "dayStreak",
        progress.best_day_streak,
        3
      ),
      badge(
        "one-week-streak",
        "calendar",
        "One-Week Streak",
        "A longer daily streak.",
        "dayStreak",
        progress.best_day_streak,
        7
      ),
      badge(
        "good-to-see-you-again",
        "calendar",
        "Good to See You Again",
        "Check in again next week.",
        "weekStreak",
        progress.best_week_streak,
        2
      ),
      badge(
        "double-fortnight",
        "calendar",
        "Double Fortnight",
        "A longer weekly streak.",
        "weekStreak",
        progress.best_week_streak,
        4
      ),
      badge(
        "busy-day",
        "pace",
        "Busy Day",
        "Clicks within one UTC day.",
        "dayClickGoal",
        sameDay ? calendar.day_clicks : 0,
        calendarBadgeTargets.day_clicks,
        Boolean(calendar.earned & century)
      ),
      badge(
        "brisk-pace",
        "pace",
        "Brisk Pace",
        "Clicks within one UTC week.",
        "weekClickGoal",
        sameWeek ? calendar.week_clicks : 0,
        calendarBadgeTargets.week_clicks,
        Boolean(calendar.earned & fourDigits)
      ),
      badge(
        "high-score",
        "pace",
        "High Score",
        "Clicks within one UTC month.",
        "monthClickGoal",
        sameMonth ? calendar.month_clicks : 0,
        calendarBadgeTargets.month_clicks,
        Boolean(calendar.earned & fiveGrand)
      ),
      badge(
        "three-visits",
        "pace",
        "Three Visits",
        "Different times on the same day.",
        "distinctHoursGoal",
        hours,
        distinctHoursTarget,
        Boolean(calendar.earned & threeVisits)
      ),
      badge(
        "returning-clicker",
        "calendar",
        "Returning Clicker",
        "The days can be spread out.",
        "distinctDaysGoal",
        calendar.active_days,
        calendarBadgeTargets.active_days
      ),
      badge(
        "welcome-back",
        "calendar",
        "Welcome Back",
        "An occasional visit is enough.",
        "distinctMonthsGoal",
        calendar.active_months,
        calendarBadgeTargets.active_months
      )
    ];
    const earned = badges2.filter((entry) => entry.earned).length;
    badges2.push(
      badge(
        "recursion",
        "medal",
        "Recursion",
        "Achievements count toward this one.",
        "otherAchievementsGoal",
        earned,
        10
      )
    );
    return badges2;
  }

  // frontend/achievement-panel.ts
  var screen = required("#achievement-view");
  var list = required("#achievement-list");
  var empty = required("#achievement-empty");
  var spoiler = required("#achievement-spoilers");
  var filters = {
    all: required("#achievement-all"),
    earned: required("#achievement-earned"),
    locked: required("#achievement-locked")
  };
  var notice = required("#achievement-notice");
  var noticeTitle = required("#achievement-notice-title");
  var noticeNames = required("#achievement-notice-names");
  var live = required("#achievement-announcement");
  var game = required("#game-view");
  var nextMilestone = required("#next-click-milestone");
  var nextMilestoneName = required("#next-click-milestone-name");
  var nextMilestoneCount = required("#next-click-milestone-count");
  var spoilerKey = "goclick.achievements.reveal.v1";
  var filter = "all";
  var badges = [];
  var badgeKey = "";
  var noticeTimer = 0;
  var noticeScheduled = false;
  var pending = /* @__PURE__ */ new Set();
  var visible = /* @__PURE__ */ new Set();
  try {
    spoiler.checked = localStorage.getItem(spoilerKey) === "1";
  } catch {
  }
  function card(badge) {
    const item = document.createElement("li");
    item.className = badge.earned ? "achievement-card earned" : "achievement-card";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "achievement-icon");
    icon.setAttribute("viewBox", "0 0 48 48");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `./achievement-icons.svg#${badge.icon}`);
    icon.append(use);
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.lang = "en";
    name.dir = "ltr";
    name.textContent = badge.name;
    const description = document.createElement("p");
    description.className = "achievement-description";
    const showDetail = badge.earned || spoiler.checked;
    description.lang = showDetail ? currentLanguage() : "en";
    description.dir = languageDirection(showDetail ? currentLanguage() : "en");
    description.textContent = showDetail ? badge.description : badge.hint;
    const state = document.createElement("span");
    state.className = "achievement-state";
    state.textContent = message2(badge.earned ? "earned" : "locked");
    text.append(name, description);
    if (showDetail) {
      const { count, total } = badge.meter;
      const row = document.createElement("div");
      row.className = "achievement-card-progress";
      const meter = document.createElement("progress");
      meter.max = total;
      meter.value = count;
      meter.lang = "en";
      meter.setAttribute("aria-label", badge.name);
      const amount = document.createElement("span");
      amount.textContent = message2("outOf", { count: formatNumber(count), total: formatNumber(total) });
      row.append(meter, amount);
      text.append(row);
    }
    item.append(icon, state, text);
    return item;
  }
  function paintAchievementList() {
    const cards = badges.filter(
      (badge) => filter === "all" || badge.earned === (filter === "earned")
    );
    list.textContent = "";
    list.append(...cards.map(card));
    empty.hidden = cards.length > 0;
    if (!cards.length)
      empty.textContent = message2(filter === "locked" ? "allAchievementsEarned" : "noAchievementsEarned");
  }
  for (const key of Object.keys(filters)) {
    filters[key].addEventListener("click", () => {
      if (filter === key) return;
      filters[filter].setAttribute("aria-pressed", "false");
      filter = key;
      filters[key].setAttribute("aria-pressed", "true");
      paintAchievementList();
      if (list.getBoundingClientRect().top < 0) window.scrollTo(0, 0);
    });
  }
  spoiler.addEventListener("change", () => {
    try {
      localStorage.setItem(spoilerKey, spoiler.checked ? "1" : "0");
    } catch {
    }
    paintAchievementList();
  });
  function hideAchievementNotice() {
    window.clearTimeout(noticeTimer);
    visible.clear();
    notice.hidden = true;
    live.textContent = "";
  }
  function clearAchievementNotice() {
    pending.clear();
    hideAchievementNotice();
  }
  function queueNotice(names) {
    if (!names.length || game.hidden && screen.hidden) return;
    for (const name of names) pending.add(name);
    showAchievementNotices();
  }
  function unlockTitle(count) {
    return message2(count === 1 ? "achievementUnlocked" : "achievementsUnlocked");
  }
  onLanguageChange(() => {
    if (visible.size) noticeTitle.textContent = unlockTitle(visible.size);
  });
  function showAchievementNotices() {
    if (noticeScheduled || !pending.size || game.hidden || document.hidden) return;
    noticeScheduled = true;
    void Promise.resolve().then(() => {
      noticeScheduled = false;
      if (!pending.size || game.hidden || document.hidden) return;
      const earned = [...pending];
      pending.clear();
      for (const name of earned) visible.add(name);
      noticeTitle.textContent = unlockTitle(visible.size);
      noticeNames.textContent = [...visible].join(" \xB7 ");
      notice.hidden = false;
      const names = earned.join(". ");
      live.textContent = `${unlockTitle(earned.length)}. ${languageDirection() === "rtl" ? `\u2066${names}\u2069` : names}.`;
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(hideAchievementNotice, 6500);
    });
  }
  function renderAchievements(data, progress, local, announce) {
    const next = badgesFor(data, progress, local);
    const key = `${currentLanguage()}:${next.map(({ earned, meter: meter2 }) => `${Number(earned)}-${meter2.count}`).join(",")}`;
    if (key === badgeKey) return;
    if (announce && badges.length) {
      queueNotice(
        next.filter((badge, index) => badge.earned && !badges[index]?.earned).map(({ name }) => name)
      );
    }
    badges = next;
    badgeKey = key;
    const milestone = badges.find(
      ({ id, icon, earned }) => !earned && (id === "gone-click" || icon === "clicks")
    );
    nextMilestone.hidden = !milestone;
    if (milestone) {
      nextMilestoneName.textContent = milestone.name;
      nextMilestoneCount.textContent = message2("outOf", {
        count: formatNumber(milestone.meter.count),
        total: formatNumber(milestone.meter.total)
      });
    }
    const count = badges.filter(({ earned }) => earned).length;
    required("#achievement-count").textContent = message2("outOf", {
      count: formatNumber(count),
      total: formatNumber(badges.length)
    });
    const meter = required("#achievement-meter");
    meter.max = badges.length;
    meter.value = count;
    if (!screen.hidden) paintAchievementList();
  }

  // frontend/progress-panel.ts
  var activityRail = required("#activity-days");
  var dayMarks = Array.from({ length: fortnight }, () => {
    const mark = document.createElement("span");
    activityRail.append(mark);
    return mark;
  });
  var resetMeter = required("#day-reset-meter");
  var resetTime = required("#day-reset-local");
  var timeLeft = required("#day-reset-left");
  var streaks = required(".streak-panel");
  var resetButton = required("#streak-reset-button");
  var resetDetails = required("#streak-reset-details");
  var compactTime = required("#streak-reset-local");
  var compactTimeLeft = required("#streak-reset-left");
  var ring = document.querySelector("#streak-reset-ring");
  var resetPinned = false;
  function setResetDetails(open) {
    resetDetails.hidden = !open;
    resetButton.setAttribute("aria-expanded", String(open));
  }
  function closeResetDetails() {
    resetPinned = false;
    setResetDetails(false);
  }
  resetButton.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") setResetDetails(true);
  });
  streaks.addEventListener("pointerleave", () => {
    if (!resetPinned) setResetDetails(false);
  });
  resetButton.addEventListener("click", () => {
    resetPinned = !resetPinned;
    setResetDetails(resetPinned);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!resetDetails.hidden && !streaks.contains(event.target)) closeResetDetails();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !resetDetails.hidden) closeResetDetails();
  });
  var lastActivity = "";
  var resetMinute = NaN;
  var nextReset = NaN;
  var resetTimer = 0;
  var shownCounters = {};
  var shownLocalMode = false;
  function renderProgress(data, local, announce = false) {
    shownCounters = data;
    shownLocalMode = local;
    const progress = data.progress ?? seedProgress(data.click_count?.modified_time, data.streak_counter_day?.count ?? 0);
    const activityKey = `${currentLanguage()}:${progress.recent_days}`;
    if (activityKey !== lastActivity) {
      lastActivity = activityKey;
      const { days, score } = fortnightActivity(progress.recent_days);
      required("#fortnight-score").textContent = message2("outOf", {
        count: formatNumber(score),
        total: formatNumber(100)
      });
      required("#activity-count").textContent = message2("daysActive", { count: formatNumber(days) });
      for (const [index, mark] of dayMarks.entries())
        mark.classList.toggle(
          "active",
          Boolean(progress.recent_days & 1 << fortnight - 1 - index)
        );
    }
    renderAchievements(data, progress, local, announce);
    return progress;
  }
  function paintReset(force = false) {
    const now = Date.now();
    const minute = Math.floor(now / 6e4);
    if (!force && minute === resetMinute) return;
    resetMinute = minute;
    const { next, elapsed, minutesLeft } = utcReset(now);
    if (next !== nextReset) {
      nextReset = next;
      if (!required("#achievement-view").hidden) renderProgress(shownCounters, shownLocalMode);
    }
    const remaining = [
      ...minutesLeft >= 60 ? [formatUnit(Math.floor(minutesLeft / 60), "hour")] : [],
      formatUnit(minutesLeft % 60, "minute")
    ].join(" ");
    const countdown = message2("timeUntilReset", { time: remaining });
    timeLeft.textContent = compactTimeLeft.textContent = countdown;
    const fraction = elapsed / dayMilliseconds;
    resetMeter.value = fraction;
    ring.setAttribute("stroke-dasharray", `${fraction} 1`);
    resetMeter.setAttribute("aria-valuetext", countdown);
    resetTime.textContent = compactTime.textContent = message2("localReset", {
      time: new Date(next).toLocaleString(currentLanguage(), {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        timeZoneName: "short"
      })
    });
  }
  function showReset(show2) {
    window.clearInterval(resetTimer);
    closeResetDetails();
    if (!show2) return;
    paintReset(true);
    resetTimer = window.setInterval(paintReset, 1e3);
  }

  // frontend/app.ts
  var views = {
    loading: required("#loading-view"),
    home: required("#home-view"),
    auth: required("#auth-view"),
    game: required("#game-view"),
    achievements: required("#achievement-view")
  };
  var loginForm = required("#login-form");
  var signupForm = required("#signup-form");
  var clickButton = required("#click-button");
  var guestClickButton = required("#guest-click-button");
  var achievementsLink = required("#open-achievements");
  var playLink = required("#back-to-game");
  var achievementTitle = required("#achievement-title");
  var buttonLanguage = createButtonLanguage(currentLanguage());
  var buttonLabel = required(".button-label", clickButton);
  var counterCard = required("#counter-card");
  var playerStatus = required("#player-status");
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
    for (const id of ["click-count", "day-streak", "week-streak", "month-streak", "year-streak"])
      numberAnimations.get(required(`#${id}`))?.cancel();
  });
  var user = null;
  var offlineOnly = document.documentElement.dataset.offlineOnly !== void 0;
  var localMode = offlineOnly || gameSettings.mode() === "local";
  var lastOnlineCounters = null;
  var displayedCounters = {};
  var lastClicks = /* @__PURE__ */ new Map();
  var lastClickKey = () => localMode ? "local" : `account:${user?.id ?? ""}`;
  var lastClick = required("#last-click");
  var offlineStartNotice = required("#offline-start-notice");
  var offlineStartTimer = 0;
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
  function isPlayerView(view = currentView) {
    return view === "game" || view === "achievements";
  }
  function isGuestAchievements() {
    return currentView === "achievements" && !localMode && !user;
  }
  function pageFromLocation() {
    return new URLSearchParams(window.location.search).get("view") === "achievements" ? "achievements" : "game";
  }
  function navigatePlayerPage() {
    if (!isPlayerView() && currentView !== "home") return;
    const page = pageFromLocation();
    const view = page === "game" && !user && !localMode ? "home" : page;
    if (view === currentView) return;
    show(view);
    if (view === "game") (clickButton.disabled ? required("#main-content") : clickButton).focus();
    if (view === "home") guestClickButton.focus();
  }
  for (const link of [achievementsLink, playLink]) {
    link.addEventListener("click", (event) => {
      if (!isPlayerView() && currentView !== "home" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      if (link === achievementsLink === (currentView === "achievements")) return;
      window.history.pushState(null, "", link.href);
      navigatePlayerPage();
    });
  }
  window.addEventListener("popstate", navigatePlayerPage);
  function showHome() {
    if (pageFromLocation() === "achievements") window.history.replaceState(null, "", playLink.href);
    show("home");
  }
  function paintAchievementTitle() {
    achievementTitle.textContent = message2(localMode || !user ? "offlineAchievements" : "achievements");
  }
  function renderGuestAchievements() {
    try {
      renderProgress(localGame.read(), true);
      showError("#game-error", "");
    } catch {
      renderProgress({}, true);
      showGameError("localLoadError");
    }
  }
  function show(view) {
    const changed = view !== currentView;
    if (changed) {
      for (const controller of tactileButtons.values()) controller.reset();
      viewAnimation?.cancel();
    }
    currentView = view;
    const player = isPlayerView(view);
    if (changed) window.scrollTo(0, 0);
    views.loading.hidden = view !== "loading";
    views.home.hidden = view !== "home";
    views.auth.hidden = view !== "login" && view !== "signup";
    views.game.hidden = view !== "game";
    views.achievements.hidden = view !== "achievements";
    playerStatus.hidden = !player;
    achievementsLink.hidden = !player && view !== "home";
    achievementsLink.setAttribute("aria-current", view === "achievements" ? "page" : "false");
    if (changed) {
      showReset(player);
      if (view === "achievements") {
        hideAchievementNotice();
        if (isGuestAchievements()) renderGuestAchievements();
        else renderProgress(displayedCounters, localMode);
        paintAchievementTitle();
        paintAchievementList();
        achievementTitle.focus();
      } else if (view === "game") {
        showAchievementNotices();
      } else {
        clearAchievementNotice();
      }
    }
    loginForm.hidden = view !== "login";
    signupForm.hidden = view !== "signup";
    required("#guest-nav").hidden = player && !isGuestAchievements() || view === "loading";
    required("#user-nav").hidden = !player || localMode || !user;
    required("#local-nav").hidden = offlineOnly || !player || !localMode;
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
    const text = message2("click", {}, code), direction = languageDirection(code);
    if (buttonLabel.textContent !== text) buttonLabel.textContent = text;
    if (buttonLabel.lang !== code) buttonLabel.lang = code;
    if (buttonLabel.dir !== direction) buttonLabel.dir = direction;
  }
  function setConnection(milliseconds = null, state = "") {
    connectionState = state;
    window.clearTimeout(pingStateTimer);
    if (Number.isFinite(milliseconds) && milliseconds !== null) lastPing = Math.round(milliseconds);
    const timing = lastPing === null ? "\u2014" : formatUnit(lastPing, "millisecond");
    required("#ping").textContent = timing;
    connection.title = message2(localMode ? "simulatedPingHint" : "pingHint");
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
          ping: `${message2(localMode ? "simPing" : "ping")} ${timing}`,
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
    if (offlineOnly)
      return Promise.reject(new Error("Account requests are unavailable in this build."));
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
    const username = required("#nav-username");
    username.textContent = username.title = user?.username ?? "";
    required("#admin-link").hidden = !user?.admin;
    if (identityChanged) {
      required("#replace-local").checked = false;
      clearAchievementNotice();
      resetClickState();
      renderCounters({}, true);
      if (optionsDialog.open) updateOptions();
    }
  }
  function resetClickState() {
    clickGeneration++;
    window.clearTimeout(offlineStartTimer);
    offlineStartNotice.textContent = "";
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
    required("#ping").textContent = "\u2014";
    connection.classList.remove("is-loading", "is-error", "is-limited");
    connection.setAttribute("aria-label", message2("noPing"));
    tactileButtons.get(clickButton)?.reset();
    clickFeedback.reset();
    statsShare.reset();
    updateGameControls();
  }
  function updateGameControls() {
    clickButton.disabled = !gameReady || offline && !localMode || signingOut || authenticating && !localMode || localMode && localSaveReplacing || pendingClicks >= maxPendingClicks;
    clickButton.setAttribute("aria-disabled", String(clickButton.disabled || coolingDown()));
    refreshCounterButton.disabled = offline && !localMode || signingOut || pendingClicks > 0 || localMode && localSaveReplacing;
    refreshCounterButton.setAttribute(
      "aria-disabled",
      String(refreshCounterButton.disabled || !!counterLoad)
    );
    refreshCounterButton.setAttribute("aria-busy", String(!!counterLoad));
    retryGameButton.disabled = refreshCounterButton.disabled || !!counterLoad;
    required("#share-stats").disabled = !gameReady || signingOut || pendingClicks > 0 || !!counterLoad || localSaveReplacing;
    required("#network-notice").hidden = !offline || localMode;
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
  function renderCounters(data, allowDecrease = false, announce = false) {
    const clicks = data.click_count;
    const displayedClicks = displayedCounters.click_count?.count ?? 0;
    if (!allowDecrease && clicks && Number.isFinite(displayedClicks) && clicks.count < displayedClicks)
      return;
    displayedCounters = data;
    const progress = renderProgress(data, localMode, announce);
    for (const [id, count, unit] of [
      ["click-count", clicks?.count ?? 0],
      ["day-streak", data.streak_counter_day?.count ?? 0, "day"],
      ["week-streak", progress.week_streak, "week"],
      ["month-streak", data.streak_counter_month?.count ?? 0, "month"],
      ["year-streak", data.streak_counter_year?.count ?? 0, "year"]
    ]) {
      const element = required(`#${id}`);
      let formatted = formatNumber(count);
      if (unit) {
        const quantity = formatUnit(count, unit);
        const label = required(`#${id}-unit`);
        const separateUnit = quantity.startsWith(formatted);
        const suffix = separateUnit ? quantity.slice(formatted.length).trim() : "";
        if (label.textContent !== suffix) label.textContent = suffix;
        label.hidden = !suffix;
        if (!separateUnit) formatted = quantity;
      }
      if (element.textContent === formatted) continue;
      element.textContent = formatted;
      if (!allowDecrease) animateNumber(element);
    }
    paintLastClick();
  }
  function applyLoadedCounters(data) {
    const key = lastClickKey();
    if (!lastClicks.has(key))
      lastClicks.set(key, { time: data.click_count?.modified_time ?? null, saved: 0 });
    renderCounters(data, true);
    gameReady = true;
  }
  function paintLastClick(saved = false) {
    const entry = lastClicks.get(lastClickKey());
    lastClick.hidden = !entry?.time;
    if (!entry?.time) return;
    if (saved) entry.saved = Math.min(6, entry.saved + 1);
    lastClick.textContent = message2("lastClick", {
      time: parseStoredTimestamp(entry.time).toLocaleString(currentLanguage())
    });
    lastClick.style.setProperty("--last-click-opacity", String(1 - entry.saved / 6));
    lastClick.setAttribute("aria-hidden", String(entry.saved >= 6));
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
    show(pageFromLocation());
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
        applyLoadedCounters(state.counters);
        if (optionsDialog.open) updateOptions();
        updateGameControls();
        if (focusButton && currentView === "game" && !clickButton.disabled) clickButton.focus();
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
    if (isGuestAchievements()) return renderGuestAchievements();
    if (localMode) {
      if (!isPlayerView()) return;
      if (pendingClicks > 0 || localSaveReplacing) localRefreshQueued = true;
      else openLocalGame();
      return;
    }
    if (!isPlayerView() || !user || signingOut || offline || document.hidden) return;
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
    showAchievementNotices();
    refreshGame();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) identityEpoch++;
    else resumeGame();
  });
  window.addEventListener("blur", () => identityEpoch++);
  window.addEventListener("focus", () => {
    if (isPlayerView()) paintReset(true);
    resumeGame();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refreshGame();
  });
  function handleExpiredSession() {
    gameReady = false;
    setUser(null);
    show("login");
    showError("#login-error", "Your session expired. Sign in again.", true);
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      if (offlineOnly || authenticating) return;
      const view = button.dataset.view;
      if (view === "home") {
        if (user) openGame();
        else showHome();
      } else if (view === "login" || view === "signup") show(view);
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
    updateGameControls();
    logoutButton.disabled = true;
    try {
      await api("/api/auth/logout", { method: "DELETE" });
      gameReady = false;
      setUser(null);
      showHome();
    } catch {
      showGameError("signOutError", true);
    } finally {
      signingOut = false;
      logoutButton.disabled = false;
      updateGameControls();
    }
  });
  clickButton.addEventListener("click", async (event) => {
    if (currentView !== "game" || clickButton.disabled) return;
    paintButtonLanguage(buttonLanguage.click(performance.now(), currentLanguage()));
    if (localMode) {
      await clickLocal(event);
      return;
    }
    if (!user || !gameReady || offline && !localMode || signingOut || authenticating || pendingClicks >= maxPendingClicks)
      return;
    if (coolingDown()) {
      tactileButtons.get(clickButton)?.respond("limited");
      clickSound.play("limited");
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
      const count = data.click_count?.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        const error = new RequestError("The server response did not include a saved click count.");
        error.uncertain = true;
        throw error;
      }
      paintLastClick(true);
      renderCounters(data, false, true);
      if (count >= (lastOnlineCounters?.click_count?.count ?? 0)) lastOnlineCounters = data;
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
  async function boot(returningOnline = false) {
    if (localMode) {
      openLocalGame();
      return;
    }
    const generation = clickGeneration;
    show("loading");
    views.loading.setAttribute("aria-busy", "true");
    required(".loading-spinner").hidden = false;
    required("#loading-message").textContent = message2("loadingCounter");
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
        if (!returningOnline && pageFromLocation() === "achievements") show("achievements");
        else showHome();
        return;
      }
      required(".loading-spinner").hidden = true;
      required("#loading-message").textContent = message2("loadError");
      retryBootButton.hidden = false;
      views.loading.setAttribute("aria-busy", "false");
      retryBootButton.focus();
    }
  }
  retryGameButton.addEventListener("click", refreshGame);
  refreshCounterButton.addEventListener("click", refreshGame);
  required("#share-stats").addEventListener("click", () => {
    if (!gameReady || signingOut || pendingClicks > 0 || counterLoad || localSaveReplacing) return;
    return statsShare.open(displayedCounters, localMode);
  });
  retryBootButton.addEventListener("click", () => boot());
  var optionsDialog = required("#options-dialog");
  var offlineCacheMessage = "offlineCachePreparing";
  function paintOfflineCacheStatus() {
    if (offlineOnly) required("#offline-cache-status").textContent = message2(offlineCacheMessage);
  }
  var replaceLocalConsent = required("#replace-local");
  var importLocal = required("#import-local");
  optionsDialog.addEventListener("close", () => clickSound.cancelPreview());
  var currentOptionsNotice = null;
  function paintOptionsMessage(target, key, detail) {
    target.textContent = message2(key);
    if (detail) {
      const diagnostic = document.createElement("bdi");
      diagnostic.lang = "en";
      diagnostic.textContent = detail;
      target.append(" ", diagnostic);
    }
  }
  function paintOptionsNotice() {
    const notice2 = required("#options-status");
    if (currentOptionsNotice) {
      const { key, detail } = currentOptionsNotice;
      paintOptionsMessage(notice2, key, detail);
    } else notice2.textContent = "";
    notice2.classList.toggle("notice-error", currentOptionsNotice?.error ?? false);
  }
  function optionsNotice(key, error = false, detail) {
    currentOptionsNotice = key ? { key, error, detail } : null;
    paintOptionsNotice();
  }
  function updateOptions() {
    required("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0 || localSaveReplacing;
    const name = user?.username;
    required("#copy-online-note").textContent = lastOnlineCounters && name ? message2("copyAccountNote", { name: languageDirection() === "rtl" ? `\u2068${name}\u2069` : name }) : message2("copyAccountHint");
    const summary = required("#local-save-summary");
    try {
      const data = localGame.read();
      summary.textContent = message2("localSaveCount", {
        count: formatNumber(data.click_count?.count ?? 0)
      });
    } catch (caught) {
      paintOptionsMessage(summary, "localSaveUnavailable", requestError(caught).message);
    }
  }
  required("#options-button").addEventListener("click", () => {
    optionsNotice();
    replaceLocalConsent.checked = false;
    updateOptions();
    optionsDialog.showModal();
    optionsDialog.scrollTop = 0;
  });
  required("#close-options").addEventListener("click", () => optionsDialog.close());
  function saveOption(patch) {
    try {
      gameSettings.update(patch);
      optionsNotice();
    } catch {
      optionsNotice("settingsVisit", true);
    }
  }
  var paintOptionPreferencesLanguage = bindOptionPreferences(saveOption);
  motionShortcut.addEventListener("click", () => {
    try {
      gameSettings.update({ motion: "off" });
    } catch {
    }
  });
  function openLocalGame(data) {
    show(pageFromLocation());
    showError("#game-error", "");
    retryGameButton.hidden = true;
    try {
      applyLoadedCounters(data ?? localGame.read());
      counterCard.setAttribute("aria-busy", "false");
      updateGameControls();
      setConnection();
    } catch {
      showLocalLoadError();
    }
  }
  function showLocalLoadError() {
    gameReady = false;
    resetLocalSaveFeedback();
    renderCounters({}, true);
    updateGameControls();
    showGameError("localLoadError", true);
  }
  function resetLocalSaveFeedback() {
    lastClicks.delete("local");
    clearAchievementNotice();
    resetClickState();
  }
  function startLocalGame(scoreFirstClick = false) {
    if (pendingClicks > 0 || signingOut || localSaveReplacing) return;
    try {
      const data = localGame.read();
      gameSettings.setMode("local");
      localMode = true;
      clearAchievementNotice();
      gameReady = false;
      resetClickState();
      optionsDialog.close();
      openLocalGame(data);
      if (currentView === "game") clickButton.focus();
      if (scoreFirstClick) {
        offlineStartNotice.textContent = message2("playingOffline");
        offlineStartTimer = window.setTimeout(() => offlineStartNotice.textContent = "", 4e3);
        return clickLocal();
      }
    } catch (caught) {
      optionsNotice("openLocalFailed", true, requestError(caught).message);
      if (!optionsDialog.open) {
        updateOptions();
        optionsDialog.showModal();
      }
    }
  }
  guestClickButton.addEventListener("click", () => {
    if (currentView === "home") return startLocalGame(true);
  });
  document.querySelectorAll("[data-play-local]").forEach((button) => button.addEventListener("click", () => startLocalGame()));
  required("#leave-local").addEventListener("click", async () => {
    if (offlineOnly || pendingClicks > 0 || localSaveReplacing || authenticating) return;
    let remembered = true;
    try {
      gameSettings.setMode("online");
    } catch {
      remembered = false;
    }
    localMode = false;
    clearAchievementNotice();
    gameReady = false;
    resetClickState();
    renderCounters({}, true);
    await boot(true);
    if (!remembered) {
      updateOptions();
      optionsNotice("backOnlineVisit", true);
      optionsDialog.showModal();
    }
  });
  async function clickLocal(event = { detail: 0, clientX: 0, clientY: 0 }) {
    if (!gameReady || localSaveReplacing || pendingClicks >= maxPendingClicks) return;
    const feedback = clickFeedback.start(clickButton, event, true), generation = clickGeneration, acknowledgement = ++localAcknowledgement;
    const base = gameSettings.value.simulatedPing;
    const simulated = Math.round(base * (0.7 + Math.random() * 0.6));
    pendingClicks++;
    updatePendingIndicator();
    updateGameControls();
    setConnection(null, "loading");
    try {
      const data = await localGame.change(() => localGame.increment());
      if (generation !== clickGeneration) return;
      paintLastClick(true);
      renderCounters(data, false, true);
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
        updatePendingIndicator();
        updateGameControls();
        if (pendingClicks === 0 && localRefreshQueued) synchronizeLocalSave();
      }
    }
  }
  function canReplaceLocalSave() {
    if (localSaveReplacing) return false;
    if (!replaceLocalConsent.checked) {
      optionsNotice("replaceConsent", true);
      replaceLocalConsent.focus();
      return false;
    }
    if (pendingClicks > 0) {
      optionsNotice("waitPending", true);
      return false;
    }
    return true;
  }
  async function replaceLocalSave(operation, completion, failure = "localReplacedFailed") {
    if (!canReplaceLocalSave()) return;
    localSaveReplacing = true;
    replaceLocalConsent.checked = false;
    updateGameControls();
    optionsNotice("replacingLocal");
    try {
      const data = await operation();
      await localGame.change(() => localGame.replace(data));
      if (localMode) {
        resetLocalSaveFeedback();
        openLocalGame();
      } else if (isGuestAchievements()) renderGuestAchievements();
      updateOptions();
      optionsNotice(completion);
    } catch (caught) {
      optionsNotice(failure, true, requestError(caught).message);
    } finally {
      localSaveReplacing = false;
      updateGameControls();
      if (localRefreshQueued) synchronizeLocalSave();
    }
  }
  required("#restart-local").addEventListener(
    "click",
    () => replaceLocalSave(() => ({}), "localRestarted")
  );
  required("#copy-online-local").addEventListener("click", () => {
    if (!lastOnlineCounters) return;
    const snapshot = lastOnlineCounters;
    replaceLocalSave(() => snapshot, "accountCopied");
  });
  importLocal.addEventListener("click", (event) => {
    if (!canReplaceLocalSave()) event.preventDefault();
  });
  importLocal.addEventListener("change", async () => {
    const file = importLocal.files?.[0];
    importLocal.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) {
      optionsNotice("saveTooLarge", true);
      return;
    }
    await replaceLocalSave(
      async () => localGame.decode(await file.text()),
      "localImported",
      "importFailed"
    );
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
      optionsNotice("localDownloaded");
    } catch (caught) {
      optionsNotice("downloadFailed", true, requestError(caught).message);
    }
  });
  function synchronizeLocalSave() {
    if (isGuestAchievements()) renderGuestAchievements();
    else if (localMode) {
      if (pendingClicks > 0 || localSaveReplacing) {
        localRefreshQueued = true;
        return;
      }
      localRefreshQueued = false;
      try {
        const data = localGame.read();
        const previous = displayedCounters.click_count;
        const current = data.click_count;
        if (!gameReady || (current?.count ?? 0) < (previous?.count ?? 0)) {
          resetLocalSaveFeedback();
          replaceLocalConsent.checked = false;
          openLocalGame(data);
        } else {
          applyLoadedCounters(data);
        }
      } catch {
        showLocalLoadError();
      }
    }
    if (optionsDialog.open) updateOptions();
  }
  window.addEventListener("storage", (event) => {
    if (event.key === localGame.key || event.key === null) synchronizeLocalSave();
  });
  var paintLanguagePicker = languagePicker();
  function applyLanguage() {
    translatePage();
    paintOptionPreferencesLanguage();
    paintOptionsNotice();
    paintOfflineCacheStatus();
    if (optionsDialog.open) updateOptions();
    paintLanguagePicker();
    document.documentElement.lang = currentLanguage();
    if (currentView === "loading")
      required("#loading-message").textContent = message2(retryBootButton.hidden ? "loadingCounter" : "loadError");
    buttonLanguage.reset(currentLanguage());
    paintButtonLanguage(currentLanguage());
    if (isGuestAchievements()) renderGuestAchievements();
    else renderCounters(displayedCounters, true);
    if (currentView === "achievements") paintAchievementTitle();
    if (offlineStartNotice.textContent) offlineStartNotice.textContent = message2("playingOffline");
    if (isPlayerView()) paintReset(true);
    updatePendingIndicator();
    updateGameControls();
    if (lastGameError) showGameError(lastGameError);
    if (cooldownUntil) paintCooldown();
    else setConnection(null, connectionState);
  }
  onLanguageChange(applyLanguage);
  setLanguage(readLanguage());
  applyLanguage();
  window.addEventListener("storage", (event) => {
    if (event.key === languageStorageKey || event.key === null) setLanguage(readLanguage());
  });
  boot();
  if (offlineOnly) {
    void offlineWorkerReady().then((ready) => {
      offlineCacheMessage = ready ? "offlineCacheReady" : "offlineCacheUnavailable";
      paintOfflineCacheStatus();
    });
  }
})();
