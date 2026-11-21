"use strict";

// Run with a fresh isolated Playwright page. All scored actions use local play;
// this check creates no account and sends no online clicks.
async function checkLanguage(page, baseURL) {
  const ensure = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(baseURL);
  await page.locator("#home-view").waitFor({ state: "visible" });
  await page.locator("#home-view [data-play-local]").click();
  await page.locator("#game-view").waitFor({ state: "visible" });
  requests.length = 0;
  const selector = page.locator("#language-setting");
  const menu = page.locator("#language-menu");
  const selectedName = page.locator("#language-name");
  const codes = await menu.locator("button").evaluateAll((options) => options.map((o) => o.value));
  ensure(codes.length === 11, "Expected eleven languages");
  await selector.press("ArrowDown");
  ensure(
    (await menu.locator(":focus").getAttribute("value")) === "en",
    "ArrowDown did not open the menu",
  );
  await page.keyboard.press("End");
  ensure(
    (await menu.locator(":focus").getAttribute("value")) === "de",
    "End did not focus the last language",
  );
  await page.keyboard.press("f");
  ensure(
    (await menu.locator(":focus").getAttribute("value")) === "fr",
    "Typeahead did not find Français",
  );
  await page.keyboard.press("Enter");
  ensure((await selectedName.getAttribute("lang")) === "fr", "Enter did not select Français");
  ensure(
    await selector.evaluate((button) => button === document.activeElement),
    "Selection lost focus",
  );
  await selector.press("Space");
  await page.keyboard.press("Escape");
  ensure(await menu.isHidden(), "Escape did not close the menu");
  ensure(
    await selector.evaluate((button) => button === document.activeElement),
    "Escape lost focus",
  );
  await selector.press("Space");
  await page.keyboard.press("Tab");
  ensure(await menu.isHidden(), "Tab did not close the menu");
  ensure(
    await selector.evaluate((button) => button !== document.activeElement),
    "Tab did not move on",
  );
  await selector.click();
  await page.locator(".site-header").click({ position: { x: 1, y: 1 } });
  ensure(await menu.isHidden(), "Clicking outside did not close the menu");

  async function choose(code) {
    await selector.click();
    await menu.locator(`button[value="${code}"]`).click();
  }

  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const code of codes) {
      await choose(code);
      await selector.click();
      const layout = await menu.evaluate((menu) => {
        const trigger = document.querySelector("#language-setting");
        const triggerBounds = trigger.getBoundingClientRect();
        const menuBounds = menu.getBoundingClientRect();
        const selected = menu.querySelector('[aria-checked="true"]');
        const labelX = trigger.querySelector("bdi").getBoundingClientRect().left;
        const flagX = trigger.querySelector("svg").getBoundingClientRect().left;
        return {
          aligned:
            Math.abs(triggerBounds.left - menuBounds.left) < 1 &&
            Math.abs(triggerBounds.right - menuBounds.right) < 1 &&
            [...menu.querySelectorAll("button")].every(
              (row) =>
                Math.abs(row.querySelector("bdi").getBoundingClientRect().left - labelX) < 1 &&
                Math.abs(row.querySelector("svg").getBoundingClientRect().left - flagX) < 1,
            ),
          fits: menuBounds.left >= 0 && menuBounds.right <= innerWidth,
          selected: selected?.value,
          flag: trigger.querySelector("use").getAttribute("href"),
          selectedFlag: selected?.querySelector("use").getAttribute("href"),
          flagsRender: [...menu.querySelectorAll("use")].every((icon) => icon.getBBox().width > 0),
        };
      });
      ensure(layout.aligned && layout.fits, `${code} at ${width}: menu alignment or overflow`);
      ensure(
        layout.selected === code && layout.flag === layout.selectedFlag,
        `${code}: wrong selection`,
      );
      ensure(layout.flagsRender, "One or more flags failed to render");
      await page.keyboard.press("Escape");
      const state = await page.evaluate(() => {
        const game = document.querySelector("#game-view");
        const visibleControls = [
          "#language-setting",
          "#leave-local",
          "#options-button",
          "#share-stats",
          "#refresh-counter",
        ];
        return {
          lang: game.lang,
          dir: game.dir,
          action: document.querySelector("#click-button").getAttribute("aria-label"),
          buttonLang: document.querySelector(".game .button-label").lang,
          refreshTitle: document.querySelector("#refresh-counter").title,
          refreshIcon: !!document.querySelector("#refresh-counter svg use"),
          overflow: document.documentElement.scrollWidth > innerWidth,
          controlsFit: visibleControls.every((selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth;
          }),
        };
      });
      ensure(state.lang === code && state.buttonLang === code, `${code}: locale not applied`);
      ensure(state.dir === (code === "ar" ? "rtl" : "ltr"), `${code}: wrong direction`);
      ensure(
        state.action && state.refreshTitle && state.refreshIcon,
        `${code}: missing accessible control`,
      );
      ensure(!state.overflow && state.controlsFit, `${code} at ${width}: horizontal overflow`);
    }
  }
  await choose("ar");
  await page.evaluate(() => {
    window.originalRandom = Math.random;
    Math.random = () => 0.99;
  });
  await page.locator("#click-button").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      document.querySelector("#click-count").textContent === new Intl.NumberFormat("ar").format(1),
  );
  // Force the surprise branch while keeping the scoring/input path unchanged.
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await page.keyboard.press("Enter");
  ensure(
    (await page.locator(".game .button-label").getAttribute("lang")) !== "ar",
    "Button did not switch languages",
  );
  ensure(
    (await selectedName.getAttribute("lang")) === "ar",
    "Button surprise changed selected UI language",
  );
  ensure(
    (await page.locator("#click-button").getAttribute("lang")) === "ar",
    "Accessible action lost its UI language",
  );
  // Even another forced surprise must restore the chosen language on this click.
  await page.keyboard.press("Enter");
  ensure(
    (await page.locator(".game .button-label").getAttribute("lang")) === "ar",
    "The next click did not restore the selected language",
  );
  await page.evaluate(() => {
    Math.random = window.originalRandom;
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#click-count").textContent === new Intl.NumberFormat("ar").format(3),
  );
  await page.locator("#share-stats").click();
  await page.locator("#share-dialog").waitFor({ state: "visible" });
  const shared = await page.locator("#share-text").inputValue();
  ensure(
    shared.includes("النقرات المحلية") && shared.includes("UTC"),
    "Shared stats not translated",
  );
  ensure(
    (await page.locator("#share-dialog").getAttribute("dir")) === "rtl",
    "Share direction not applied",
  );
  await page.locator("#close-share").click();
  await page.reload();
  await page.locator("#game-view").waitFor({ state: "visible" });
  ensure((await selectedName.getAttribute("lang")) === "ar", "Language did not survive reload");
  ensure(
    (await page.locator("#click-count").textContent()) === new Intl.NumberFormat("ar").format(3),
    "Save changed on reload",
  );
  ensure(requests.length === 0, "Language changes or local play sent account requests");
  ensure(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  return {
    languages: codes.length,
    widths: [1280, 320],
    localClicks: 3,
    accountRequests: requests.length,
    errors,
  };
}
module.exports = { checkLanguage };
