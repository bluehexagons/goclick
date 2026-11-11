"use strict";

// Run inside page.evaluate after entering offline play and letting assets load.
// Exercises the actual application program and atlas, including post-click
// progress, tilted reflections, and emissive lettering. No account or online
// clicks are needed. Explicit uniforms make this independent of motion settings.
module.exports = function checkButtonRendering() {
  const canvas = document.querySelector("#game-view .button-scene");
  const gl = canvas.getContext("webgl");
  if (!gl || !canvas.parentElement.classList.contains("is-rendered"))
    throw new Error("The WebGL button must be rendered before checking pixels");
  const program = gl.getParameter(gl.CURRENT_PROGRAM);
  const scalars = ["copper", "flash", "response", "responseProgress", "letteringLight"];
  const names = [...scalars, "rotation", "letteringPose", "letteringAccent"];
  const locations = Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  );
  const saved = Object.fromEntries(
    names.map((name) => [name, gl.getUniform(program, locations[name])]),
  );
  const vertices = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) / 36 - 6;
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  const litPixels = new Uint8Array(pixels.length);
  const results = [];
  try {
    gl.uniform1f(locations.flash, 0);
    gl.uniform4f(locations.letteringPose, 1, 1, 0, 0);
    gl.uniform2f(locations.letteringAccent, 0, 1.35);
    for (const angle of [-0.3, 0, 0.3]) {
      const c = Math.cos(angle),
        s = Math.sin(angle);
      gl.uniformMatrix3fv(locations.rotation, false, [c, 0, -s, 0, 1, 0, s, 0, c]);
      for (const progress of [0, 0.5, 1]) {
        for (const copper of [0, 1]) {
          gl.uniform1f(locations.copper, copper);
          gl.uniform1f(locations.responseProgress, progress);
          gl.uniform1f(locations.response, progress === 1 ? 0 : 0.8);
          gl.uniform1f(locations.letteringLight, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES, 0, vertices);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let metal = 0,
            lettering = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 250) continue;
            if (pixels[i] > 100 && pixels[i + 1] > 50) metal++;
            if (pixels[i] > 5 && pixels[i] < 100 && pixels[i + 1] > 5) lettering++;
          }
          if (metal < 1000 || lettering < 20 || gl.getError() !== gl.NO_ERROR)
            throw new Error(
              `Missing metal or engraving: angle=${angle}, progress=${progress}, copper=${copper}, metal=${metal}, lettering=${lettering}`,
            );
          gl.uniform1f(locations.letteringLight, 1);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES, 0, vertices);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, litPixels);
          let illuminated = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            // Count only pixels that were dark lettering in the unlit frame.
            if (
              pixels[i + 3] >= 250 &&
              pixels[i] > 5 &&
              pixels[i] < 100 &&
              pixels[i + 1] > 5 &&
              litPixels[i] > pixels[i] + 60 &&
              litPixels[i + 1] > pixels[i + 1] + 60
            )
              illuminated++;
          }
          if (illuminated < 20 || gl.getError() !== gl.NO_ERROR)
            throw new Error(
              `Lettering did not illuminate: angle=${angle}, progress=${progress}, copper=${copper}, illuminated=${illuminated}`,
            );
          results.push({ angle, progress, copper, metal, lettering, illuminated });
        }
      }
    }
  } finally {
    gl.uniformMatrix3fv(locations.rotation, false, saved.rotation);
    gl.uniform4fv(locations.letteringPose, saved.letteringPose);
    gl.uniform2fv(locations.letteringAccent, saved.letteringAccent);
    for (const name of scalars) gl.uniform1f(locations[name], saved[name]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, vertices);
  }
  return results;
};
