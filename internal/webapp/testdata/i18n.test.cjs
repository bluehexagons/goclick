"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { frontend } = require("./frontend.cjs");

function localization(globals = {}) {
  const runtime = frontend(globals);
  return { ...runtime.load("i18n"), catalogs: runtime.load("messages") };
}

test("all supported catalogs cover the game messages and preserve interpolation fields", () => {
  const { catalogs, languages } = localization();
  const fields = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const { code } of languages) {
    const catalog = code === "en" ? catalogs.english : catalogs.translations[code];
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs.english).sort(), code);
    for (const [key, text] of Object.entries(catalog)) {
      assert.ok(text.trim(), `${code}.${key} is empty`);
      assert.deepEqual(fields(text), fields(catalogs.english[key]), `${code}.${key}`);
    }
  }
  const html = readFileSync(`${__dirname}/../web/index.html`, "utf8");
  for (const [, key] of html.matchAll(/data-i18n(?:-title|-aria-label)?="([^"]+)"/g))
    assert.ok(Object.hasOwn(catalogs.english, key), `Unknown HTML message ${key}`);
  assert.doesNotMatch(html, /<input[^>]*\sdata-i18n=/);
});

test("language choice prefers a saved supported locale, then browser order, then English", () => {
  const i = localization();
  assert.equal(i.preferredLanguage("fr", ["ar-EG"]), "fr");
  assert.equal(i.preferredLanguage("invalid", ["xx", "pt-PT", "ja"]), "pt-BR");
  assert.equal(i.preferredLanguage(null, ["zh-TW"]), "zh-Hans");
  assert.equal(i.preferredLanguage(null, ["de-AT"]), "de");
  assert.equal(i.preferredLanguage(null, ["xx"]), "en");
  assert.equal(i.supportedLanguage("__proto__"), undefined);
});

test("storage failure still applies the language and invalid stored content uses the browser", () => {
  const i = localization({
    navigator: { languages: ["ar-EG"] },
    localStorage: {
      getItem: () => "not-a-language",
      setItem() {
        throw new Error("Storage unavailable");
      },
    },
  });
  assert.equal(i.readLanguage(), "ar");
  let changed = 0;
  i.onLanguageChange(() => changed++);
  assert.equal(i.rememberLanguage("ja"), false);
  assert.equal(i.currentLanguage(), "ja");
  assert.equal(changed, 1);
  i.setLanguage("ja");
  assert.equal(changed, 1);
});

test("localization formats numbers and grammatical units without reinterpreting inserted text", () => {
  const i = localization();
  assert.equal(
    i.message("lastClick", { time: "<tag>{time}{count}" }),
    "Last click <tag>{time}{count}",
  );
  i.setLanguage("ar");
  assert.equal(i.languageDirection(), "rtl");
  assert.equal(i.formatNumber(12345), new Intl.NumberFormat("ar").format(12345));
  i.setLanguage("ru");
  assert.equal(i.formatUnit(2, "day"), "2 дня");
  assert.equal(i.formatUnit(5, "day"), "5 дней");
});

test("translation changes only marked text leaves and attributes, preserving SVG controls", () => {
  const node = (attributes) => ({
    attributes,
    textContent: "original",
    children: [{ tag: "svg" }],
    getAttribute(name) {
      return this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  });
  const label = node({ "data-i18n": "streaks" });
  const button = node({ "data-i18n-title": "refresh", "data-i18n-aria-label": "refresh" });
  const scope = node({});
  const i = localization({
    document: {
      querySelectorAll(selector) {
        return (
          {
            "[data-i18n]": [label],
            "[data-i18n-title]": [button],
            "[data-i18n-aria-label]": [button],
            "[data-game-language]": [scope],
          }[selector] ?? []
        );
      },
    },
  });
  i.setLanguage("ar");
  i.translatePage();
  assert.equal(label.textContent, "سلاسل متتالية");
  assert.equal(button.textContent, "original");
  assert.equal(button.children[0].tag, "svg");
  assert.equal(button.attributes.title, "تحديث العداد");
  assert.equal(button.attributes["aria-label"], button.attributes.title);
  assert.equal(scope.lang, "ar");
  assert.equal(scope.dir, "rtl");
});

test("button surprises choose another supported foreign language without changing the UI preference", () => {
  const i = localization();
  i.setLanguage("fr");
  const button = i.createButtonLanguage("fr");
  for (let n = 0; n < 100; n++) {
    const next = button.click(n * 200, "fr", () => 0);
    assert.notEqual(next, "fr");
    assert.ok(i.supportedLanguage(next));
    assert.equal(i.currentLanguage(), "fr");
    // Even another winning random draw must restore the chosen locale first.
    assert.equal(
      button.click(n * 200 + 100, "fr", () => 0),
      "fr",
    );
  }
  button.reset("ja");
  assert.equal(
    button.click(10000, "ja", () => 0.5),
    "ja",
  );
});

test("a surprise resets on the next click even after a long pause", () => {
  const i = localization();
  const button = i.createButtonLanguage("ar");
  assert.notEqual(
    button.click(0, "ar", () => 0),
    "ar",
  );
  assert.equal(
    button.click(60000, "ar", () => 0.5),
    "ar",
  );
  assert.equal(
    button.click(61000, "ar", () => 0.5),
    "ar",
  );
  assert.notEqual(
    button.click(62000, "ar", () => 0),
    "ar",
  );
  button.reset("ja");
  assert.equal(
    button.click(63000, "ja", () => 0.5),
    "ja",
  );
});

test("rapid presses increase surprise chance slightly, with a cap and decay after a pause", () => {
  const { createButtonLanguage } = localization();
  const button = createButtonLanguage("en");
  assert.equal(
    button.click(0, "en", () => 0.025),
    "en",
  ); // baseline 2%
  assert.notEqual(
    button.click(50, "en", () => 0.025),
    "en",
  );
  button.reset("en");
  for (let n = 0; n < 100; n++)
    assert.equal(
      button.click(n * 50, "en", () => 0.081),
      "en",
    );
  assert.notEqual(
    button.click(5000, "en", () => 0.079),
    "en",
  ); // capped at 8%
  button.reset("en");
  for (let n = 0; n < 100; n++) button.click(n * 50, "en", () => 0.5);
  assert.equal(
    button.click(20000, "en", () => 0.025),
    "en",
  );
});
