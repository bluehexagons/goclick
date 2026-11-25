import { required as $ } from "./dom.js";
import { currentLanguage, languages, message, rememberLanguage } from "./i18n.js";

const svgNS = "http://www.w3.org/2000/svg";
const flagHref = (flag: string) => `./language-flags.svg#${flag}`;

export function languagePicker() {
  const picker = $(".language-selector");
  const trigger = $<HTMLButtonElement>("#language-setting");
  const menu = $("#language-menu");
  const selectedFlag = $<SVGUseElement>("#language-flag");
  const selectedName = $("#language-name");
  const options = languages.map(({ code, name, dir, flag }) => {
    const button = document.createElement("button");
    const icon = document.createElementNS(svgNS, "svg");
    const use = document.createElementNS(svgNS, "use");
    const label = document.createElement("bdi");
    button.type = "button";
    button.value = code;
    button.tabIndex = -1;
    button.setAttribute("role", "menuitemradio");
    icon.setAttribute("class", "language-flag");
    icon.setAttribute("viewBox", "0 0 512 512");
    icon.setAttribute("aria-hidden", "true");
    use.setAttribute("href", flagHref(flag));
    icon.append(use);
    label.lang = code;
    label.dir = dir;
    label.textContent = name;
    button.append(icon, label);
    button.addEventListener("click", () => {
      trigger.title = message(rememberLanguage(code) ? "languageHint" : "languageVisit");
      close(true);
    });
    menu.append(button);
    return button;
  });

  function open(index: number) {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    options[index]!.focus();
  }

  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }

  trigger.addEventListener("click", () => {
    if (menu.hidden) open(languages.findIndex(({ code }) => code === currentLanguage()));
    else close(true);
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open(event.key === "ArrowDown" ? 0 : options.length - 1);
  });
  menu.addEventListener("keydown", (event) => {
    const index = options.findIndex((option) => option === document.activeElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = (index + 1) % options.length;
        break;
      case "ArrowUp":
        next = (index + options.length - 1) % options.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        close(true);
        return;
      default: {
        if (
          event.key.length !== 1 ||
          event.key === " " ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const prefix = event.key.toLowerCase();
        const match = languages
          .slice(index + 1)
          .concat(languages.slice(0, index + 1))
          .find(({ name }) => name.toLowerCase().startsWith(prefix));
        if (!match) return;
        next = languages.indexOf(match);
      }
    }
    event.preventDefault();
    options[next]!.focus();
  });
  function dismissOutside(event: Event) {
    if (!menu.hidden && !picker.contains(event.target as Node | null)) close();
  }
  document.addEventListener("focusin", dismissOutside);
  document.addEventListener("pointerdown", dismissOutside);

  return () => {
    const selected = languages.find(({ code }) => code === currentLanguage())!;
    selectedFlag.setAttribute("href", flagHref(selected.flag));
    selectedName.textContent = selected.name;
    selectedName.lang = selected.code;
    selectedName.dir = selected.dir;
    for (const option of options) {
      option.setAttribute("aria-checked", String(option.value === selected.code));
    }
  };
}
