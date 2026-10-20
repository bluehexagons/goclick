"use strict";

// Run with a fresh isolated Playwright context. Both pages share only this
// test's local save; no account is created and no online click is submitted.
module.exports = async function checkLocalSave(page, baseURL, { withoutWebLocks = false } = {}) {
  const peer = await page.context().newPage();
  const pages = [page, peer];
  const waitForCount = (target, count) =>
    target.waitForFunction((expected) => {
      const raw = localStorage.getItem("goclick.local.v1");
      const saved = raw === null ? 0 : (JSON.parse(raw).counters.click_count?.count ?? 0);
      return (
        saved === expected &&
        Number(document.querySelector("#click-count").textContent) === expected
      );
    }, count);
  const clickTogether = async (count) => {
    await Promise.all(
      pages.map(async (target) => {
        for (let index = 0; index < count; index++) await target.locator("#click-button").click();
      }),
    );
  };
  try {
    for (const target of pages)
      await target.addInitScript((disableLocks) => {
        if (disableLocks)
          Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
        localStorage.setItem("goclick.mode", "local");
        localStorage.setItem(
          "goclick.settings.v1",
          JSON.stringify({ motion: "on", simulatedPing: 0 }),
        );
      }, withoutWebLocks);
    await Promise.all(pages.map((target) => target.goto(baseURL)));
    await Promise.all(
      pages.map((target) => target.locator("#game-view").waitFor({ state: "visible" })),
    );
    const coordination = await page.evaluate(() => ({
      webLocks: !!navigator.locks,
      indexedDB: typeof indexedDB !== "undefined",
    }));
    if (withoutWebLocks ? coordination.webLocks || !coordination.indexedDB : !coordination.webLocks)
      throw new Error(
        "The requested local-save coordination API must be available in this context",
      );
    await Promise.all(pages.map((target) => waitForCount(target, 0)));
    await clickTogether(8);
    await Promise.all(pages.map((target) => waitForCount(target, 16)));

    await page.locator("#options-button").click();
    await page.locator("#replace-local").check();
    await page.locator("#restart-local").click();
    await page
      .locator("#options-status")
      .getByText("Local save restarted.", { exact: true })
      .waitFor();
    await page.locator("#close-options").click();
    await Promise.all(pages.map((target) => waitForCount(target, 0)));
    await clickTogether(1);
    await Promise.all(pages.map((target) => waitForCount(target, 2)));
    await Promise.all(pages.map((target) => target.reload()));
    await Promise.all(pages.map((target) => waitForCount(target, 2)));
    for (const target of pages) {
      const error = await target.locator("#game-error").textContent();
      if (error) throw new Error(`Local save failed: ${error}`);
    }
    return {
      browser: await page.evaluate(() => navigator.userAgent),
      origin: await page.evaluate(() => location.origin),
      coordination: withoutWebLocks ? "IndexedDB" : "Web Locks",
      concurrentClicks: true,
      replacementAcrossTabs: true,
      saveSurvivesReload: true,
    };
  } finally {
    await peer.close();
  }
};
