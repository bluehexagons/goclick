import { english, translations } from "./messages.js";
import type { MessageKey, Messages } from "./messages.js";

export const languages = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "zh-Hans", name: "简体中文", dir: "ltr" },
  { code: "es", name: "Español", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "hi", name: "हिन्दी", dir: "ltr" },
  { code: "id", name: "Bahasa Indonesia", dir: "ltr" },
  { code: "pt-BR", name: "Português", dir: "ltr" },
  { code: "fr", name: "Français", dir: "ltr" },
  { code: "ja", name: "日本語", dir: "ltr" },
  { code: "ru", name: "Русский", dir: "ltr" },
  { code: "de", name: "Deutsch", dir: "ltr" },
] as const;
export type Language = (typeof languages)[number]["code"];
export const languageStorageKey = "goclick.language.v1";
let language: Language = "en";
const listeners = new Set<() => void>();

export function supportedLanguage(value: string | null): Language | undefined {
  return languages.find((item) => item.code === value)?.code;
}

export function preferredLanguage(saved: string | null, preferences: readonly string[]): Language {
  const explicit = supportedLanguage(saved);
  if (explicit) return explicit;
  for (const preference of preferences) {
    const base = preference.toLowerCase().split("-")[0];
    const match = languages.find((item) => item.code.toLowerCase().split("-")[0] === base);
    if (match) return match.code;
  }
  return "en";
}

export function currentLanguage(): Language {
  return language;
}
export function languageDirection(code = language): "ltr" | "rtl" {
  return languages.find((item) => item.code === code)?.dir ?? "ltr";
}
export function message(
  key: MessageKey,
  parameters: Record<string, string | number> = {},
  code = language,
): string {
  const messages: Messages = code === "en" ? english : translations[code];
  // Interpolate once: user data that looks like another placeholder stays literal.
  return messages[key].replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : token,
  );
}
export function formatNumber(value: number, code = language): string {
  return new Intl.NumberFormat(code).format(value);
}
export function formatUnit(value: number, unit: "day" | "month" | "year", code = language) {
  return new Intl.NumberFormat(code, { style: "unit", unit, unitDisplay: "long" }).format(value);
}
export function onLanguageChange(listener: () => void) {
  listeners.add(listener);
}
export function setLanguage(code: Language) {
  if (language === code) return;
  language = code;
  for (const listener of listeners) listener();
}
export function rememberLanguage(code: Language): boolean {
  setLanguage(code);
  try {
    localStorage.setItem(languageStorageKey, code);
    return true;
  } catch {
    return false;
  }
}
export function readLanguage(): Language {
  let saved = null;
  try {
    saved = localStorage.getItem(languageStorageKey);
  } catch {
    // Browser preference remains usable when storage is unavailable.
  }
  return preferredLanguage(saved, navigator.languages ?? []);
}

// Text and attributes are separate so translating a control never removes its
// SVG, nested counter, event handlers, or focused child. Never insert HTML.
export function translatePage() {
  for (const attribute of ["text", "title", "aria-label"] as const) {
    const selector = attribute === "text" ? "data-i18n" : `data-i18n-${attribute}`;
    for (const element of document.querySelectorAll<HTMLElement>(`[${selector}]`)) {
      const key = element.getAttribute(selector);
      if (!key || !Object.hasOwn(english, key)) continue;
      const text = message(key as MessageKey);
      if (attribute === "text") element.textContent = text;
      else element.setAttribute(attribute, text);
      element.lang = language;
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-game-language]")) {
    element.lang = language;
    element.dir = languageDirection();
  }
}

// The surprise belongs only to the button face. It never changes the UI locale,
// accessible action, persisted preference, click timing, or score.
export function createButtonLanguage(initial: Language) {
  let current = initial;
  let previous: number | null = null;
  let heat = 0;
  return {
    reset(code: Language) {
      current = code;
      previous = null;
      heat = 0;
    },
    click(now: number, selected: Language, random = Math.random): Language {
      if (previous !== null) {
        const gap = Math.max(0, now - previous);
        heat *= Math.exp(-gap / 900);
        if (gap < 350) heat = Math.min(1, heat + 0.12);
      }
      previous = now;
      if (random() < 0.02 + 0.06 * heat) {
        const choices = languages.filter((item) => item.code !== current && item.code !== selected);
        current =
          choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!.code;
      }
      return current;
    },
  };
}
