"use strict";

// Run in a fresh isolated page. Clipboard checks write only this test's local
// stats and observe that write completing; they never read the clipboard.
module.exports = async function checkInteraction(page, baseURL) {
  const ensure = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const selection = () => page.evaluate(() => window.getSelection().toString());
  await page.goto(baseURL);
  const origin = await page.evaluate(() => location.origin);
  await page.locator("#home-view").waitFor({ state: "visible" });
  const title = await page.locator(".home h1").boundingBox();
  await page.mouse.move(title.x + 5, title.y + 15);
  await page.mouse.down();
  await page.mouse.move(title.x + title.width - 5, title.y + 15, { steps: 8 });
  await page.mouse.up();
  ensure((await selection()) === "", "Dragging over interface text must not select it");
  ensure(
    await page
      .locator(".brand")
      .evaluate((element) => !element.draggable && !element.querySelector("img").draggable),
    "Brand links and images must not be draggable",
  );
  ensure(
    await page
      .locator(".brand")
      .evaluate(
        (element) =>
          !element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true })),
      ),
    "Native page drag must be cancelled",
  );

  await page.locator("#home-view [data-play-local]").click();
  const button = await page.locator("#click-button").boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await page.mouse.move(button.x + button.width / 2 + 25, button.y + button.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("#click-count").textContent === "1");
  ensure((await selection()) === "", "Gameplay dragging must not select the page");

  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      await write(text);
      window.copiedStats = text;
    };
  });
  await page.locator("#share-stats").click();
  await page.locator("#share-status").getByText("Stats copied.", { exact: true }).waitFor();
  const copied = await page.evaluate(() => window.copiedStats);
  ensure(
    copied ===
      `Go Click · offline\n1 local click\nUTC streaks: 1 day · 1 month · 1 year\nPlay: ${origin}`,
    "Share must copy the displayed local stats",
  );
  await page.locator("#close-share").click();
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.locator("#share-stats").click();
  await page.locator("#share-dialog").waitFor({ state: "visible" });
  ensure(
    await page
      .locator("#share-text")
      .evaluate(
        (field) =>
          field.readOnly &&
          field.selectionStart === 0 &&
          field.selectionEnd === field.value.length &&
          getComputedStyle(field).userSelect === "text",
      ),
    "Blocked clipboard access must offer a copyable, selected snapshot",
  );
  await page.locator("#close-share").click();

  await page.locator("#options-button").click();
  await page.locator("#technical-notes summary").click();
  await page
    .locator(".technical-grid p")
    .first()
    .dblclick({ position: { x: 12, y: 10 } });
  ensure((await selection()).length > 0, "Technical help must remain copyable");
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.locator("#close-options").click();
  await page.locator("#leave-local").click();
  await page.locator('#guest-nav [data-view="login"]').click();
  await page.locator("#login-identifier").fill("example_player");
  await page.keyboard.press("ControlOrMeta+A");
  ensure(
    await page
      .locator("#login-identifier")
      .evaluate((field) => field.selectionStart === 0 && field.selectionEnd === field.value.length),
    "Normal field selection must remain available",
  );
  ensure(
    await page
      .locator("#login-identifier")
      .evaluate((field) =>
        field.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true })),
      ),
    "Editing text drags must remain available",
  );
  return {
    browser: await page.evaluate(() => navigator.userAgent),
    origin,
    noAccidentalSelection: true,
    nativeDragsBlocked: true,
    gameplayDrag: true,
    clipboardWrite: true,
    manualCopy: true,
    helpAndFieldSelection: true,
  };
};
