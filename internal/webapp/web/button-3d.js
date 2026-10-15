"use strict";

// A closed, beveled solid, rather than offset copies of the front face.
// World units match CSS pixels; projection matches the native button's
// perspective so its accessible hit surface follows the rendered face.
function createButtonRenderer(stage, button) {
  const canvas = stage.querySelector(".button-scene");
  const rig = stage.querySelector(".button-rig");
  let gl;
  try { gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true }); }
  catch (_) { return { draw() {} }; }
  if (!gl) return { draw() {} };

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
      vec3 surface = mix(vec3(1., .77, .25), vec3(1., .58, .12), press * .48);
      vec3 gold = surface * (.52 + .70 * diffuse);
      gold += vec3(1., .94, .72) * specular * .38;
      gold += vec3(1., .88, .55) * flash * .55 * frontFace;
      vec4 text = texture2D(lettering, texCoord);
      gold = mix(gold, text.rgb * (.78 + .22 * diffuse), text.a * frontFace);
      gl_FragColor = vec4(gold, 1.);
    }`;

  function shader(type, source) {
    const item = gl.createShader(type);
    gl.shaderSource(item, source); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
      gl.deleteShader(item); throw new Error("Button shader could not compile");
    }
    return item;
  }
  let program, uniforms;

  const vertices = [];
  const rings = [{ inset: 6, z: 18 }, { inset: 0, z: 12 }, { inset: 0, z: -12 }, { inset: 4, z: -16 }];
  function contour({ inset, z }) {
    const radius = 28 - inset, halfWidth = 130 - inset, halfHeight = 72 - inset;
    const points = [];
    for (const [cx, cy, angle] of [
      [halfWidth - radius, -halfHeight + radius, -90],
      [halfWidth - radius, halfHeight - radius, 0],
      [-halfWidth + radius, halfHeight - radius, 90],
      [-halfWidth + radius, -halfHeight + radius, 180],
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
    vertex(contours[0][i].p, [0, 0, 1], 1); vertex(contours[0][next].p, [0, 0, 1], 1);
    vertex([0, 0, -16], [0, 0, -1]);
    vertex(contours[3][next].p, [0, 0, -1]); vertex(contours[3][i].p, [0, 0, -1]);
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const dz = rings[ring].z - rings[ring + 1].z;
      const bevel = rings[ring].inset - rings[ring + 1].inset;
      const length = Math.hypot(dz, bevel);
      const normal = (point) => [point.n[0] * dz / length, point.n[1] * dz / length, bevel / length];
      const a = contours[ring][i], b = contours[ring + 1][i];
      const c = contours[ring + 1][next], d = contours[ring][next];
      vertex(a.p, normal(a)); vertex(b.p, normal(b)); vertex(c.p, normal(c));
      vertex(a.p, normal(a)); vertex(c.p, normal(c)); vertex(d.p, normal(d));
    }
  }
  const solidCount = vertices.length / 9;
  for (const point of [[-230, -180, -42], [230, -180, -42], [230, 180, -42], [-230, -180, -42], [230, 180, -42], [-230, 180, -42]]) {
    vertex(point, [0, 0, 1]);
  }
  const label = document.createElement("canvas"); label.width = 780; label.height = 432;
  const context = label.getContext("2d");
  if (!context) return { draw() {} };
  context.font = "700 114px system-ui, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillStyle = "#432d0d"; context.fillText(button.querySelector(".button-label").textContent, 390, 222);
  function initialize() {
    try {
      program = gl.createProgram();
      const vertex = shader(gl.VERTEX_SHADER, vertexSource), fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Button renderer could not link");
    } catch (_) {
      if (program) gl.deleteProgram(program);
      return false;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.useProgram(program);
    for (const [name, size, offset] of [["position", 3, 0], ["normal", 3, 3], ["uv", 2, 6], ["face", 1, 8]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 36, offset * 4);
    }
    uniforms = Object.fromEntries(["rotation", "translation", "viewport", "scale", "recession", "shadow", "shadowCenter", "shadowSize", "shadowBlur", "lettering", "press", "flash"].map(name => [name, gl.getUniformLocation(program, name)]));
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, label);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(uniforms.lettering, 0);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.frontFace(gl.CW);
    gl.clearColor(0, 0, 0, 0);

    return true;
  }
  if (!initialize()) return { draw() {} };

  let state = { x: 0, y: 0, rx: 0, ry: 0, press: 0 }, lost = false;
  function draw(next = state) {
    state = { ...next };
    if (lost) return;
    if (!stage.clientWidth || !stage.clientHeight) return;
    const bounds = stage.getBoundingClientRect();
    const gutter = Math.max(0, Math.min(40, bounds.left, document.documentElement.clientWidth - bounds.right));
    stage.style.setProperty("--canvas-gutter", `${gutter.toFixed(3)}px`);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    gl.viewport(0, 0, pixelWidth, pixelHeight); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const scale = button.offsetWidth / 260 * (1 + Math.max(-.03, Math.min(.10, state.pop || 0))), press = Math.max(-.22, Math.min(1, state.press));
    const rx = state.rx * Math.PI / 180, ry = state.ry * Math.PI / 180;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const recession = press * 24;
    // Keep the entire solid above the background, including its rear corners
    // at maximum tilt and full press. Bound the rotated box, not just its center.
    const lowest = -Math.abs(cx * sy) * 130 * scale - Math.abs(sx) * 72 * scale
      + Math.min(cx * cy * (-16 - recession), cx * cy * (18 - recession));
    const lift = Math.max(0, -34 - lowest); // Eight pixels above the z=-42 plane.
    rig.style.setProperty("--lift", `${lift.toFixed(3)}px`);
    gl.uniform2f(uniforms.viewport, width, height);
    gl.uniform1f(uniforms.press, Math.max(0, press));
    gl.uniform1f(uniforms.flash, state.flash || 0);
    // One soft shadow on the background plane. It approaches the solid as
    // the button is pushed away from the viewer.
    const centerX = state.x - sy * recession, centerY = state.y + sx * cy * recession;
    const centerZ = lift - cx * cy * recession, clearance = 42 + centerZ;
    const projection = clearance / (500 - centerZ);
    gl.uniformMatrix3fv(uniforms.rotation, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    gl.uniform3f(uniforms.translation, 0, 0, 0); gl.uniform1f(uniforms.scale, 1); gl.uniform1f(uniforms.shadow, 1);
    gl.uniform1f(uniforms.recession, 0);
    gl.uniform2f(uniforms.shadowCenter, centerX + (centerX + 280) * projection, centerY + (centerY + 350) * projection);
    gl.uniform2f(uniforms.shadowSize, 126 * scale * (1 - Math.abs(sy) * .15), 70 * scale * (1 - Math.abs(sx) * .15));
    gl.uniform1f(uniforms.shadowBlur, 8 + clearance * .18);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // A translucent shadow is a background pass, never an occluding surface.
    gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, solidCount, 6); gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.uniformMatrix3fv(uniforms.rotation, false, [cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
    gl.uniform3f(uniforms.translation, state.x, state.y, lift);
    gl.uniform1f(uniforms.recession, recession);
    gl.uniform1f(uniforms.scale, scale); gl.uniform1f(uniforms.shadow, 0);
    gl.drawArrays(gl.TRIANGLES, 0, solidCount);
    stage.classList.add("is-rendered");
  }
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault(); lost = true; stage.classList.remove("is-rendered");
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
