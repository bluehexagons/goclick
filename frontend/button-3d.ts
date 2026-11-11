import { projectButtonLettering, projectButtonScene } from "./button-geometry.js";
import { required } from "./dom.js";
import type { ButtonState, Renderer } from "./types.js";

// Three stacked atlas layers: authored albedo, emission mask, then lettering.
// Keep canvas painting and shader texel offsets tied to the same dimensions.
const ATLAS_WIDTH = 780;
const LAYER_HEIGHT = 432;
const ATLAS_LAYERS = 3;
const ATLAS_HEIGHT = LAYER_HEIGHT * ATLAS_LAYERS;
const LABEL_FONT_SIZE = 114;
const LABEL_MAX_WIDTH = 560;

// A closed, beveled solid, rather than offset copies of the front face.
// World units match CSS pixels; projection matches the native button's
// perspective so its accessible hit surface follows the rendered face.
function createButtonRenderer(stage: HTMLElement, button: HTMLButtonElement): Renderer {
  const canvas = required<HTMLCanvasElement>(".button-scene", stage);
  const rig = required(".button-rig", stage);
  const maybeGL = (() => {
    try {
      return canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    } catch {
      return null;
    }
  })();
  if (!maybeGL) return { draw() {} };
  const gl: WebGLRenderingContext = maybeGL;

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
    uniform vec4 letteringPose;
    uniform vec2 letteringAccent;
    uniform float letteringLight;
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
      // Etched channels glow locally; the metal receives no blanket color wash.
      float pulseDistance = (texCoord.x - responseProgress) * 5.;
      float pulse = .8 + .2 * exp(-pulseDistance * pulseDistance);
      float energy = min(1.4, copper * .38 + flash * .65 + response * .8 * pulse);
      vec3 lightColor = response > 0. ? responseColor : vec3(.22, .72, .46);
      float lit = clamp(luminous * energy * 1.8, 0., 1.) * frontFace;
      gold = mix(gold, lightColor * 1.3, lit);
      gold += lightColor * luminous * energy * .2 * frontFace;
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
      gl_FragColor = vec4(gold, 1.);
    }`;

  function shader(type: number, source: string) {
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
    "responseColor",
    "letteringPose",
    "letteringAccent",
    "letteringLight",
  ] as const;
  let program: WebGLProgram | null = null;
  let uniforms: Record<(typeof uniformNames)[number], WebGLUniformLocation | null>;
  type Point = { p: [number, number, number]; n: [number, number] };

  const vertices: number[] = [];
  const rings = [
    { inset: 6, z: 18 },
    { inset: 0, z: 12 },
    { inset: 0, z: -12 },
    { inset: 4, z: -16 },
  ];
  function contour({ inset, z }: { inset: number; z: number }): Point[] {
    const radius = 28 - inset,
      halfWidth = 130 - inset,
      halfHeight = 72 - inset;
    const points: Point[] = [];
    for (const [cx, cy, angle] of [
      [halfWidth - radius, -halfHeight + radius, -90],
      [halfWidth - radius, halfHeight - radius, 0],
      [-halfWidth + radius, halfHeight - radius, 90],
      [-halfWidth + radius, -halfHeight + radius, 180],
    ] as const) {
      for (let step = 0; step <= 12; step++) {
        const a = ((angle + step * 7.5) * Math.PI) / 180;
        const nx = Math.cos(a),
          ny = Math.sin(a);
        points.push({ p: [cx + radius * nx, cy + radius * ny, z], n: [nx, ny] });
      }
    }
    return points;
  }
  function vertex(point: readonly number[], normal: readonly number[], front = 0) {
    vertices.push(...point, ...normal, (point[0]! + 130) / 260, (point[1]! + 72) / 144, front);
  }
  const contours = rings.map(contour),
    count = contours[0]!.length;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    vertex([0, 0, 18], [0, 0, 1], 1);
    vertex(contours[0]![i]!.p, [0, 0, 1], 1);
    vertex(contours[0]![next]!.p, [0, 0, 1], 1);
    vertex([0, 0, -16], [0, 0, -1]);
    vertex(contours[3]![next]!.p, [0, 0, -1]);
    vertex(contours[3]![i]!.p, [0, 0, -1]);
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const dz = rings[ring]!.z - rings[ring + 1]!.z;
      const bevel = rings[ring]!.inset - rings[ring + 1]!.inset;
      const length = Math.hypot(dz, bevel);
      const normal = (point: Point) => [
        (point.n[0] * dz) / length,
        (point.n[1] * dz) / length,
        bevel / length,
      ];
      const a = contours[ring]![i]!,
        b = contours[ring + 1]![i]!;
      const c = contours[ring + 1]![next]!,
        d = contours[ring]![next]!;
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
    [-1, 1, 0],
  ]) {
    vertex(point, [0, 0, 1]);
  }
  const label = document.createElement("canvas");
  label.width = ATLAS_WIDTH;
  // Albedo, emission mask, then lettering. Neutral metal and an unlit mask
  // keep input and rendering usable before either image finishes loading.
  label.height = ATLAS_HEIGHT;
  const context = label.getContext("2d");
  if (!context) return { draw() {} };
  const labelContext: CanvasRenderingContext2D = context;
  const layers: [HTMLImageElement | null, HTMLImageElement | null] = [null, null];
  const lettering = required(".button-label", button);
  let paintedText = "";
  let paintedDirection: CanvasDirection = "ltr";
  function paintAtlas() {
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
    // Keep long translations inside the flat face rather than the bevel.
    if (width > LABEL_MAX_WIDTH)
      labelContext.font = `700 ${(LABEL_FONT_SIZE * LABEL_MAX_WIDTH) / width}px system-ui, sans-serif`;
    labelContext.textAlign = "center";
    labelContext.textBaseline = "middle";
    labelContext.fillStyle = "#fff";
    labelContext.fillText(paintedText, ATLAS_WIDTH / 2, LAYER_HEIGHT * 2.5 + 6);
  }
  paintAtlas();
  let atlasTexture: WebGLTexture | null = null;
  function initialize() {
    let vertex: WebGLShader | null = null,
      fragment: WebGLShader | null = null,
      buffer: WebGLBuffer | null = null,
      texture: WebGLTexture | null = null;
    try {
      program = gl.createProgram();
      if (!program) throw new Error("Button program allocation failed");
      vertex = shader(gl.VERTEX_SHADER, vertexSource);
      fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex);
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
        ["face", 1, 8],
      ] as const) {
        const location = gl.getAttribLocation(program, name);
        if (location < 0) throw new Error("Button attribute unavailable");
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 36, offset * 4);
      }
      uniforms = Object.fromEntries(
        uniformNames.map((name) => [name, gl.getUniformLocation(program!, name)]),
      ) as typeof uniforms;
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
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }
  if (!initialize()) return { draw() {} };

  let state: ButtonState = {
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
    responseColor: [0.38, 0.84, 0.8],
  };
  let lost = false;
  function draw(next: ButtonState = state) {
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
      height: document.documentElement.clientHeight,
    });
    canvas.style.left = `${scene.frame.left - bounds.left}px`;
    canvas.style.top = `${scene.frame.top - bounds.top}px`;
    canvas.style.width = `${scene.frame.width}px`;
    canvas.style.height = `${scene.frame.height}px`;
    const width = scene.frame.width,
      height = scene.frame.height;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * pixelRatio),
      pixelHeight = Math.round(height * pixelRatio);
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
    gl.uniform3f(uniforms.responseColor, ...(state.responseColor || [0.38, 0.84, 0.8]));
    const letterPose = projectButtonLettering(state);
    gl.uniform4f(
      uniforms.letteringPose,
      letterPose.scaleX,
      letterPose.scaleY,
      letterPose.shiftY,
      letterPose.ink,
    );
    gl.uniform2f(uniforms.letteringAccent, letterPose.charge, letterPose.sheen);
    gl.uniform1f(uniforms.letteringLight, letterPose.light);
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
    // A translucent shadow is a background pass, never an occluding surface.
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
  const sources = ["/button-material.svg", "/button-glow.svg"] as const;
  for (const [index, source] of sources.entries()) {
    const image = new Image();
    image.onload = () => {
      try {
        layers[index as 0 | 1] = image;
        paintAtlas();
        // Restoration uploads the current atlas even if an image arrived while
        // the GPU was unavailable. Either asset may also finish loading first.
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
  // A scrolled stage has a new screen-space origin even if its pose is idle.
  window.addEventListener("scroll", () => draw(), { passive: true });
  const renderer = { draw };
  draw();
  return renderer;
}

export { createButtonRenderer };
