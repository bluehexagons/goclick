"use strict";

// Run with a configured, isolated Playwright page in Chromium and Firefox.
// Uses offline play and never creates an account or submits an online click.
module.exports = async function checkFocus(page, baseURL) {
  const ensure = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const focus = () =>
    page.evaluate(() => {
      const element = document.activeElement,
        style = getComputedStyle(element);
      return {
        id: element.id,
        tag: element.tagName,
        mode: document.documentElement.dataset.focusInput,
        outline: style.outlineStyle,
        width: style.outlineWidth,
        skip: element.classList.contains("skip-link"),
        top: element.getBoundingClientRect().top,
      };
    });
  const ring = (value) => value.outline === "solid" && value.width === "2px";
  const waitInlays = (id, opacity) =>
    page.waitForFunction(
      ({ id, opacity }) =>
        Number(
          document.getElementById(id).parentElement.style.getPropertyValue("--ready-light"),
        ) === opacity,
      { id, opacity },
    );
  await page.goto(baseURL);
  await page.locator("#home-view").waitFor({ state: "visible" });
  await page.keyboard.press("Tab");
  const skip = await focus();
  ensure(
    skip.skip && skip.top >= 0 && ring(skip),
    "Tab must reveal the skip link and its focus cue",
  );
  await page.keyboard.press("Enter");
  const content = await focus();
  ensure(
    content.id === "main-content" && content.outline === "none",
    "Skip target must receive focus without a large outline",
  );
  await page.keyboard.press("Tab");
  const afterSkip = await focus();
  ensure(
    afterSkip.id === "guest-click-button" && afterSkip.outline === "none",
    "Tab after skipping must reach a visible content control",
  );
  await waitInlays("guest-click-button", 1);

  await page.locator("#home-view [data-play-local]").click();
  const pointer = await focus();
  ensure(
    pointer.id === "click-button" && pointer.outline === "none",
    "Pointer-started local play must focus the button quietly",
  );
  await waitInlays("click-button", 0);
  const button = page.locator("#click-button"),
    count = page.locator("#click-count");
  const before = Number(await count.textContent());
  await button.click();
  await page.waitForFunction(
    (expected) => Number(document.querySelector("#click-count").textContent) === expected,
    before + 1,
  );
  await page.mouse.move(0, 0);
  await waitInlays("click-button", 0);
  await page.keyboard.press("Space");
  await page.waitForFunction(
    (expected) => Number(document.querySelector("#click-count").textContent) === expected,
    before + 2,
  );
  const keyboard = await focus();
  ensure(
    keyboard.id === "click-button" && keyboard.outline === "none",
    "Starting keyboard play must keep focus on the button",
  );
  await waitInlays("click-button", 1);
  await page.emulateMedia({ forcedColors: "active" });
  ensure(ring(await focus()), "Forced colors must give the focused button a system outline");
  await page.emulateMedia({ forcedColors: null });
  await page.keyboard.down("Enter");
  try {
    ensure(
      await button.evaluate((element) => element.classList.contains("is-pressed")),
      "Keyboard press must have immediate feedback",
    );
    ensure(Number(await count.textContent()) === before + 2, "Holding a key must not add clicks");
  } finally {
    await page.keyboard.up("Enter");
  }
  await page.waitForFunction(
    (expected) => Number(document.querySelector("#click-count").textContent) === expected,
    before + 3,
  );
  await button.click();
  await waitInlays("click-button", 1);
  await page.mouse.move(0, 0);
  await waitInlays("click-button", 0);
  await page.keyboard.press("Tab");
  const outlet = page.locator(".outlet-control");
  ensure(
    ring(await focus()) && (await outlet.evaluate((element) => element === document.activeElement)),
    "Tab must move keyboard focus from the button to the outlet",
  );
  ensure(
    (await outlet.evaluate((element) => getComputedStyle(element).zIndex)) === "3",
    "A keyboard-focused outlet must come forward",
  );

  await page.locator("#options-button").click();
  ensure(
    (await focus()).outline === "none",
    "Pointer-opened dialogs must not inherit a keyboard ring",
  );
  for (let step = 0; step < 15 && (await focus()).id !== "import-local"; step++)
    await page.keyboard.press("Tab");
  const file = await focus();
  ensure(file.id === "import-local", "File import must remain keyboard reachable");
  const fileLabel = await page
    .locator(".import-local")
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  ensure(fileLabel === "solid", "The hidden file input needs a visible keyboard cue on its label");
  await page.keyboard.press("Escape");
  const restored = await focus();
  ensure(
    restored.id === "options-button" && ring(restored),
    "Closing a dialog by keyboard must restore visible focus to its opener",
  );
  await page.locator("#options-button").click();
  await page.locator("#import-local").focus();
  const pointerFileLabel = await page
    .locator(".import-local")
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  ensure(pointerFileLabel === "none", "A pointer-focused file picker must not outline its label");
  await page.keyboard.press("Escape");
  await page.locator("#leave-local").click();
  await page.locator('#guest-nav [data-view="login"]').click();
  const form = await focus();
  ensure(
    form.id === "login-identifier" && form.outline === "none",
    "Pointer navigation into a form must keep autofocus quiet",
  );
  ensure(
    await page.locator("#login-identifier").evaluate((element) => {
      const style = getComputedStyle(element);
      return style.borderColor === "rgb(98, 213, 204)";
    }),
    "The focused text field must indicate where typing will go",
  );
  await page.locator("#login-identifier").fill("test_player");
  ensure(
    (await focus()).mode === "pointer",
    "Typing must not opt the player into navigation outlines",
  );
  await page.keyboard.press("Tab");
  ensure(ring(await focus()), "Tab navigation inside forms must retain visible focus");
  return {
    browser: await page.evaluate(() => navigator.userAgent),
    origin: await page.evaluate(() => location.origin),
    skipLink: true,
    quietContentFocus: true,
    pointerFocus: true,
    keyboardFocus: true,
    keyboardClickAndHold: true,
    dialogFocus: true,
    filePickerFocus: true,
    formFocus: true,
  };
};
