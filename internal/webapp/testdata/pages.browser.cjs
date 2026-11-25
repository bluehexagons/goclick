"use strict";

const assert = require("node:assert/strict");

// Use a fresh context and serve the generated Pages artifact under a subpath.
async function checkPagesOffline(page, baseURL) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseURL);
  await page.waitForFunction(
    () =>
      navigator.serviceWorker.controller?.scriptURL ===
      new URL("service-worker.js", location.href).href,
  );
  assert.equal(await page.locator("#local-nav").isVisible(), false);
  await page.locator("#options-button").click();
  const onlineLink = page.getByRole("link", { name: "Play online" });
  assert.equal(await onlineLink.isVisible(), true);
  assert.equal(await onlineLink.getAttribute("href"), "https://clicker.bluehexagons.com/");
  const warning = "Leaves GitHub Pages and opens clicker.bluehexagons.com.";
  assert.equal(await onlineLink.getAttribute("title"), warning);
  assert.equal(
    await onlineLink.evaluate((link) =>
      document.getElementById(link.getAttribute("aria-describedby"))?.textContent.trim(),
    ),
    warning,
  );
  await page.locator("#close-options").click();
  await page.locator("#click-button").press("Space");
  await page.locator("#click-count").filter({ hasText: /^1$/ }).waitFor();
  await page.goto("about:blank");

  await page.context().setOffline(true);
  try {
    const response = await page.goto(new URL("?view=achievements", baseURL).href);
    assert.equal(response?.fromServiceWorker(), true);
    await page.locator("#achievement-title").waitFor();
    await page.locator("#back-to-game").click();
    assert.equal(page.url(), baseURL);
    await page.locator("#click-count").filter({ hasText: /^1$/ }).waitFor();
    await page.locator("#click-button").press("Enter");
    await page.locator("#click-count").filter({ hasText: /^2$/ }).waitFor();
    await page.reload();
    await page.locator("#click-count").filter({ hasText: /^2$/ }).waitFor();
  } finally {
    await page.context().setOffline(false);
  }
}

module.exports = { checkPagesOffline };
