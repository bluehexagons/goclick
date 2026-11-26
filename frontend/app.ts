import "./focus.js";
import "./interaction.js";
import { request, RequestError, requestError, retryAfterMilliseconds } from "./http.js";
import { required as $ } from "./dom.js";
import { gameSettings, motionPreference } from "./preferences.js";
import { localGame } from "./local-game.js";
import { tactileButtons } from "./button.js";
import { clickFeedback } from "./click-feedback.js";
import { clickSound } from "./sound.js";
import { bindOptionPreferences } from "./option-preferences.js";
import { offlineWorkerReady } from "./offline-worker.js";
import { statsShare } from "./share.js";
import { languagePicker } from "./language-picker.js";
import {
  languageStorageKey,
  currentLanguage,
  languageDirection,
  message as t,
  formatNumber,
  formatUnit,
  readLanguage,
  setLanguage,
  onLanguageChange,
  translatePage,
  createButtonLanguage,
} from "./i18n.js";
import type { Language } from "./i18n.js";
import type { MessageKey } from "./messages.js";
import { parseStoredTimestamp } from "./timestamp.js";
import { buttonAchievementBits, buttonAchievementMask } from "./types.js";
import type { Activation, ButtonInteraction, User, Counters, GameState } from "./types.js";
import {
  clearAchievementNotice,
  hideAchievementNotice,
  paintAchievementList,
  showAchievementNotices,
} from "./achievement-panel.js";
import { paintReset, renderProgress, showReset } from "./progress-panel.js";

const views = {
  loading: $("#loading-view"),
  home: $("#home-view"),
  auth: $("#auth-view"),
  game: $("#game-view"),
  achievements: $("#achievement-view"),
};
const loginForm = $<HTMLFormElement>("#login-form");
const signupForm = $<HTMLFormElement>("#signup-form");
const clickButton = $<HTMLButtonElement>("#click-button");
const guestClickButton = $<HTMLButtonElement>("#guest-click-button");
const achievementsLink = $<HTMLAnchorElement>("#open-achievements");
const playLink = $<HTMLAnchorElement>("#back-to-game");
const achievementTitle = $("#achievement-title");
const buttonLanguage = createButtonLanguage(currentLanguage());
const buttonLabel = $(".button-label", clickButton);
const counterCard = $("#counter-card");
const playerStatus = $("#player-status");
const retryGameButton = $<HTMLButtonElement>("#retry-game-button");
const retryBootButton = $<HTMLButtonElement>("#retry-boot-button");
const refreshCounterButton = $<HTMLButtonElement>("#refresh-counter");
const motionShortcut = $<HTMLButtonElement>("#motion-shortcut");
const connection = $("#connection");
const pendingIndicator = $("#pending-clicks");
type View = "loading" | "home" | "login" | "signup" | "game" | "achievements";
let currentView: View | "" = "";
let lastGameError: MessageKey | null = null;
let connectionState: "" | "loading" | "error" = "";
let lastPing: number | null = null;
let viewAnimation: Animation | null = null;
let pingStateTimer = 0,
  pendingIndicatorTimer = 0;
const numberAnimations = new WeakMap<HTMLElement, Animation>();
function updateMotionShortcut() {
  motionShortcut.hidden = !motionPreference.matches;
}
updateMotionShortcut();
motionPreference.addEventListener("change", () => {
  updateMotionShortcut();
  if (!motionPreference.matches) return;
  viewAnimation?.cancel();
  for (const id of ["click-count", "day-streak", "week-streak", "month-streak", "year-streak"])
    numberAnimations.get($(`#${id}`))?.cancel();
});
let user: User | null = null;
const offlineOnly = document.documentElement.dataset.offlineOnly !== undefined;
let localMode = offlineOnly || gameSettings.mode() === "local";
let lastOnlineCounters: Counters | null = null;
let displayedCounters: Counters = {};
const lastClicks = new Map<string, { time: string | null; saved: number }>();
const lastClickKey = () => (localMode ? "local" : `account:${user?.id ?? ""}`);
const lastClick = $("#last-click");
const offlineStartNotice = $("#offline-start-notice");
let offlineStartTimer = 0;
let gameReady = false;
let pendingClicks = 0;
let pendingButtonAchievements = 0;
const hasPendingProgress = () => pendingClicks > 0 || pendingButtonAchievements !== 0;
let localSaveReplacing = false;
let localRefreshQueued = false;
let localAcknowledgement = 0;
let clickBatchFailed = false;
let signingOut = false;
let authenticating = false;
let clickGeneration = 0;
let identityEpoch = 0;
let counterLoad: Promise<void> | null = null;
let counterLoadOwner: object | null = null;
let refreshQueued = false;
let offline = navigator.onLine === false;
const maxPendingClicks = 6;
let cooldownUntil = 0,
  cooldownTimer = 0;
const coolingDown = () => !localMode && performance.now() < cooldownUntil;

function paintCooldown() {
  window.clearTimeout(cooldownTimer);
  const remaining = cooldownUntil - performance.now();
  const active = !localMode && remaining > 0;
  $("#play-status").hidden = !active;
  $("#cooldown-time").textContent = active
    ? `· ${t("seconds", { count: formatNumber(Math.ceil(remaining / 1000)) })}`
    : "";
  if (active) cooldownTimer = window.setTimeout(paintCooldown, Math.min(1000, remaining));
  else cooldownUntil = 0;
  updateGameControls();
  setConnection(null, pendingClicks ? "loading" : "");
}

function startCooldown(retryAfter: string | null) {
  cooldownUntil = Math.max(cooldownUntil, performance.now() + retryAfterMilliseconds(retryAfter));
  paintCooldown();
}

function isPlayerView(view = currentView) {
  return view === "game" || view === "achievements";
}

function isGuestAchievements() {
  return currentView === "achievements" && !localMode && !user;
}

function pageFromLocation() {
  return new URLSearchParams(window.location.search).get("view") === "achievements"
    ? "achievements"
    : "game";
}

function navigatePlayerPage() {
  if (!isPlayerView() && currentView !== "home") return;
  const page = pageFromLocation();
  const view = page === "game" && !user && !localMode ? "home" : page;
  if (view === currentView) return;
  show(view);
  if (view === "game") (clickButton.disabled ? $("#main-content") : clickButton).focus();
  if (view === "home") guestClickButton.focus();
}

for (const link of [achievementsLink, playLink]) {
  link.addEventListener("click", (event) => {
    if (
      (!isPlayerView() && currentView !== "home") ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if ((link === achievementsLink) === (currentView === "achievements")) return;
    window.history.pushState(null, "", link.href);
    navigatePlayerPage();
  });
}
window.addEventListener("popstate", navigatePlayerPage);

function showHome() {
  if (pageFromLocation() === "achievements") window.history.replaceState(null, "", playLink.href);
  show("home");
}

function paintAchievementTitle() {
  achievementTitle.textContent = t(localMode || !user ? "offlineAchievements" : "achievements");
}

function renderGuestAchievements() {
  try {
    renderProgress(localGame.read(), true);
    showError("#game-error", "");
  } catch {
    renderProgress({}, true);
    showGameError("localLoadError");
  }
}

function show(view: View) {
  const changed = view !== currentView;
  if (changed) {
    for (const controller of tactileButtons.values()) controller.reset();
    viewAnimation?.cancel();
  }
  currentView = view;
  const player = isPlayerView(view);
  if (changed) window.scrollTo(0, 0);
  views.loading.hidden = view !== "loading";
  views.home.hidden = view !== "home";
  views.auth.hidden = view !== "login" && view !== "signup";
  views.game.hidden = view !== "game";
  views.achievements.hidden = view !== "achievements";
  playerStatus.hidden = !player;
  achievementsLink.hidden = !player && view !== "home";
  achievementsLink.setAttribute("aria-current", view === "achievements" ? "page" : "false");
  if (changed) {
    showReset(player);
    if (view === "achievements") {
      hideAchievementNotice();
      if (isGuestAchievements()) renderGuestAchievements();
      else renderProgress(displayedCounters, localMode);
      paintAchievementTitle();
      paintAchievementList();
      achievementTitle.focus();
    } else if (view === "game") {
      showAchievementNotices();
    } else {
      clearAchievementNotice();
    }
  }
  loginForm.hidden = view !== "login";
  signupForm.hidden = view !== "signup";
  $("#guest-nav").hidden = (player && !isGuestAchievements()) || view === "loading";
  $("#user-nav").hidden = !player || localMode || !user;
  $("#local-nav").hidden = offlineOnly || !player || !localMode;
  if (changed && view !== "loading" && !motionPreference.matches) {
    const incoming = view === "login" ? loginForm : view === "signup" ? signupForm : views[view];
    viewAnimation = incoming.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }
  if (view === "login") {
    showError("#login-error", "");
    resetPasswordVisibility(loginForm);
    $<HTMLInputElement>("#login-identifier").focus();
  }
  if (view === "signup") {
    showError("#signup-error", "");
    resetPasswordVisibility(signupForm);
    $<HTMLInputElement>("#signup-username").focus();
  }
}

function showError(id: string, message: string, focus = false) {
  if (id === "#game-error") lastGameError = null;
  const element = $(id);
  element.textContent = message;
  element.hidden = !message;
  if (message && focus) element.focus();
}

function showGameError(key: MessageKey, focus = false) {
  showError("#game-error", t(key), focus);
  lastGameError = key;
}

function paintButtonLanguage(code: Language) {
  const text = t("click", {}, code),
    direction = languageDirection(code);
  // Unchanged labels should not trigger the renderer's mutation observer.
  if (buttonLabel.textContent !== text) buttonLabel.textContent = text;
  if (buttonLabel.lang !== code) buttonLabel.lang = code;
  if (buttonLabel.dir !== direction) buttonLabel.dir = direction;
}

function setConnection(milliseconds: number | null = null, state: "" | "loading" | "error" = "") {
  connectionState = state;
  window.clearTimeout(pingStateTimer);
  if (Number.isFinite(milliseconds) && milliseconds !== null) lastPing = Math.round(milliseconds);
  const timing = lastPing === null ? "—" : formatUnit(lastPing, "millisecond");
  $("#ping").textContent = timing;
  connection.title = t(localMode ? "simulatedPingHint" : "pingHint");
  const paintState = () => {
    const cooling = coolingDown();
    connection.classList.toggle("is-limited", cooling);
    connection.classList.toggle(
      "is-loading",
      !cooling && state === "loading" && (!offline || localMode),
    );
    connection.classList.toggle(
      "is-error",
      !cooling && (state === "error" || (offline && !localMode)),
    );
    const status = cooling
      ? t("coolingStatus")
      : offline && !localMode
        ? t("offlineStatus")
        : state === "loading"
          ? t("loadingStatus")
          : state === "error"
            ? t("failedStatus")
            : t("idleStatus");
    connection.setAttribute(
      "aria-label",
      t("pingStatus", {
        ping: `${t(localMode ? "simPing" : "ping")} ${timing}`,
        status,
      }),
    );
  };
  // Keep the last measurement visible. Brief gaps between clicks should not
  // flash the indicator back to idle or shift the badge's width.
  if (!state && connection.classList.contains("is-loading"))
    pingStateTimer = window.setTimeout(paintState, 220);
  else paintState();
}

function setSubmitting(form: HTMLFormElement, submitting: boolean) {
  const button = $<HTMLButtonElement>("button[type=submit]", form);
  button.disabled = submitting;
  button.textContent = submitting
    ? (button.dataset.busyLabel ?? "Saving…")
    : (button.dataset.label ?? "Submit");
  form.setAttribute("aria-busy", String(submitting));
}

function resetPasswordVisibility(container: HTMLElement) {
  container.querySelectorAll<HTMLButtonElement>("[data-toggle-password]").forEach((button) => {
    const input = $<HTMLInputElement>(`#${button.dataset.togglePassword}`);
    input.type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-label", "Show password");
  });
}

function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  if (offlineOnly)
    return Promise.reject(new Error("Account requests are unavailable in this build."));
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return request<T>(url, { ...options, headers });
}

async function readGameState(): Promise<GameState> {
  const generation = clickGeneration;
  for (;;) {
    const epoch = identityEpoch;
    try {
      const state = await api<GameState>("/api/game");
      if (epoch === identityEpoch || generation !== clickGeneration) return state;
    } catch (error) {
      if (epoch === identityEpoch || generation !== clickGeneration) throw error;
    }
    // A later return to the tab supersedes an earlier read, including an old
    // authentication error. Retry only the read before enabling account play.
  }
}

function setUser(nextUser: User | null) {
  const identityChanged = user?.id !== nextUser?.id;
  user = nextUser;
  if (identityChanged) lastOnlineCounters = null;
  const username = $("#nav-username");
  username.textContent = username.title = user?.username ?? "";
  $<HTMLAnchorElement>("#admin-link").hidden = !user?.admin;
  if (identityChanged) {
    $<HTMLInputElement>("#replace-local").checked = false;
    clearAchievementNotice();
    resetClickState();
    renderCounters({}, true);
    if (optionsDialog.open) updateOptions();
  }
}

function resetClickState() {
  clickGeneration++;
  window.clearTimeout(offlineStartTimer);
  offlineStartNotice.textContent = "";
  cooldownUntil = 0;
  window.clearTimeout(cooldownTimer);
  $("#play-status").hidden = true;
  $("#cooldown-time").textContent = "";
  // Detach stale reads so returning from local play can load immediately.
  counterLoad = null;
  counterLoadOwner = null;
  counterCard.setAttribute("aria-busy", "false");
  pendingClicks = 0;
  pendingButtonAchievements = 0;
  localRefreshQueued = false;
  updatePendingIndicator();
  clickBatchFailed = false;
  refreshQueued = false;
  window.clearTimeout(pingStateTimer);
  lastPing = null;
  connectionState = "";
  $("#ping").textContent = "—";
  connection.classList.remove("is-loading", "is-error", "is-limited");
  connection.setAttribute("aria-label", t("noPing"));
  tactileButtons.get(clickButton)?.reset();
  clickFeedback.reset();
  statsShare.reset();
  updateGameControls();
}

function updateGameControls() {
  clickButton.disabled =
    !gameReady ||
    (offline && !localMode) ||
    signingOut ||
    (authenticating && !localMode) ||
    (localMode && localSaveReplacing) ||
    pendingClicks >= maxPendingClicks;
  // Keep the physical button responsive while a server cooldown is active;
  // the activation handler suppresses requests until its deadline expires.
  clickButton.setAttribute("aria-disabled", String(clickButton.disabled || coolingDown()));
  // Keep a focused refresh control in the tab order while its read is in flight.
  // Repeated activations share counterLoad instead of starting another request.
  refreshCounterButton.disabled =
    (offline && !localMode) || signingOut || pendingClicks > 0 || (localMode && localSaveReplacing);
  refreshCounterButton.setAttribute(
    "aria-disabled",
    String(refreshCounterButton.disabled || !!counterLoad),
  );
  refreshCounterButton.setAttribute("aria-busy", String(!!counterLoad));
  retryGameButton.disabled = refreshCounterButton.disabled || !!counterLoad;
  $<HTMLButtonElement>("#share-stats").disabled =
    !gameReady || signingOut || pendingClicks > 0 || !!counterLoad || localSaveReplacing;
  $("#network-notice").hidden = !offline || localMode;
  $("#counter-label").textContent = t(localMode ? "localClicks" : "savedClicks");
  $(".connection-label").textContent = t(localMode ? "simPing" : "ping");
  document.querySelectorAll<HTMLButtonElement>("[data-play-local]").forEach((button) => {
    button.hidden = localMode;
    button.disabled = hasPendingProgress() || signingOut || localSaveReplacing;
  });
  $<HTMLButtonElement>("#leave-local").disabled =
    hasPendingProgress() || localSaveReplacing || authenticating;
  $<HTMLButtonElement>("#copy-online-local").disabled =
    !lastOnlineCounters || hasPendingProgress() || localSaveReplacing;
  for (const id of ["#restart-local", "#import-local", "#download-local", "#replace-local"])
    $<HTMLButtonElement | HTMLInputElement>(id).disabled = localSaveReplacing;
}

function updatePendingIndicator() {
  if (pendingClicks === 0) {
    window.clearTimeout(pendingIndicatorTimer);
    pendingIndicatorTimer = 0;
    pendingIndicator.hidden = true;
    pendingIndicator.textContent = "";
    return;
  }
  pendingIndicator.textContent = t("pending", { count: formatNumber(pendingClicks) });
  if (pendingIndicator.hidden && !pendingIndicatorTimer)
    pendingIndicatorTimer = window.setTimeout(() => {
      pendingIndicatorTimer = 0;
      pendingIndicator.hidden = pendingClicks === 0;
    }, 180);
}

function animateNumber(element: HTMLElement) {
  if (motionPreference.matches) return;
  numberAnimations.get(element)?.cancel();
  numberAnimations.set(
    element,
    element.animate(
      [
        { transform: "scale(1)", color: "var(--ink)" },
        { transform: "scale(1.08)", color: "var(--gold)", offset: 0.25 },
        { transform: "scale(1)", color: "var(--ink)" },
      ],
      { duration: 240, easing: "cubic-bezier(.2,.75,.3,1)" },
    ),
  );
}

function mergeButtonAchievements(data: Counters, earned = 0): Counters {
  const previous = data.button_achievements ?? 0;
  const combined = previous | earned;
  return combined === previous ? data : { ...data, button_achievements: combined };
}

function renderCounters(data: Counters, allowDecrease = false, announce = false) {
  const clicks = data.click_count;
  const displayedClicks = displayedCounters.click_count?.count ?? 0;
  if (
    !allowDecrease &&
    clicks &&
    Number.isFinite(displayedClicks) &&
    clicks.count < displayedClicks
  )
    return;
  displayedCounters = allowDecrease
    ? data
    : mergeButtonAchievements(data, displayedCounters.button_achievements);
  const progress = renderProgress(displayedCounters, localMode, announce);
  for (const [id, count, unit] of [
    ["click-count", clicks?.count ?? 0],
    ["day-streak", data.streak_counter_day?.count ?? 0, "day"],
    ["week-streak", progress.week_streak, "week"],
    ["month-streak", data.streak_counter_month?.count ?? 0, "month"],
    ["year-streak", data.streak_counter_year?.count ?? 0, "year"],
  ] as const) {
    const element = $(`#${id}`);
    let formatted = formatNumber(count);
    if (unit) {
      const quantity = formatUnit(count, unit);
      const label = $(`#${id}-unit`);
      // Some locales express singular or dual quantities without digits.
      const separateUnit = quantity.startsWith(formatted);
      const suffix = separateUnit ? quantity.slice(formatted.length).trim() : "";
      if (label.textContent !== suffix) label.textContent = suffix;
      label.hidden = !suffix;
      if (!separateUnit) formatted = quantity;
    }
    if (element.textContent === formatted) continue;
    element.textContent = formatted;
    if (!allowDecrease) animateNumber(element);
  }
  paintLastClick();
}

function applyLoadedCounters(data: Counters) {
  const key = lastClickKey();
  if (!lastClicks.has(key))
    lastClicks.set(key, { time: data.click_count?.modified_time ?? null, saved: 0 });
  renderCounters(data, true);
  gameReady = true;
}

function paintLastClick(saved = false) {
  const entry = lastClicks.get(lastClickKey());
  lastClick.hidden = !entry?.time;
  if (!entry?.time) return;
  if (saved) entry.saved = Math.min(6, entry.saved + 1);
  lastClick.textContent = t("lastClick", {
    time: parseStoredTimestamp(entry.time).toLocaleString(currentLanguage()),
  });
  lastClick.style.setProperty("--last-click-opacity", String(1 - entry.saved / 6));
  lastClick.setAttribute("aria-hidden", String(entry.saved >= 6));
}

function openGame(initialGame?: GameState, backgroundRefresh = false): Promise<void> {
  if (localMode) {
    openLocalGame();
    return Promise.resolve();
  }
  if (counterLoad) return counterLoad;
  if (hasPendingProgress()) {
    refreshQueued = true;
    return Promise.resolve();
  }
  let generation = clickGeneration;
  const focusButton = currentView === "login" || currentView === "signup";
  show(pageFromLocation());
  showError("#game-error", "");
  retryGameButton.hidden = true;
  gameReady = false;
  clickButton.disabled = true;
  if (!backgroundRefresh) counterCard.setAttribute("aria-busy", "true");
  setConnection(null, "loading");
  const owner = {};
  counterLoadOwner = owner;
  const load = (async () => {
    try {
      // Both parts belong to one authenticated request, even when the shared
      // session changes while this request or a sign-in response is in flight.
      const state = await (initialGame ?? readGameState());
      if (generation !== clickGeneration) return;
      const activeLoad = counterLoad;
      setUser(state.user);
      counterLoad = activeLoad;
      generation = clickGeneration;
      counterLoadOwner = owner;
      // This read runs after pending writes settle and may reflect a restore.
      if (
        (lastOnlineCounters?.button_achievements ?? 0) & ~(state.counters.button_achievements ?? 0)
      )
        clearAchievementNotice();
      lastOnlineCounters = state.counters;
      applyLoadedCounters(lastOnlineCounters);
      if (optionsDialog.open) updateOptions();
      updateGameControls();
      if (focusButton && currentView === "game" && !clickButton.disabled) clickButton.focus();
      setConnection();
    } catch (caught) {
      const error = requestError(caught);
      if (generation !== clickGeneration) return;
      if (error.status === 401) {
        if (user && !signingOut) handleExpiredSession();
      } else {
        showGameError("loadError", !backgroundRefresh);
        retryGameButton.hidden = false;
        setConnection(null, "error");
      }
    } finally {
      if (generation === clickGeneration) counterCard.setAttribute("aria-busy", "false");
      if (counterLoadOwner === owner) {
        counterLoad = null;
        counterLoadOwner = null;
      }
      updateGameControls();
    }
  })();
  counterLoad = load;
  updateGameControls();
  return load;
}

function refreshGame() {
  if (isGuestAchievements()) return renderGuestAchievements();
  if (localMode) {
    if (!isPlayerView()) return;
    if (hasPendingProgress() || localSaveReplacing) localRefreshQueued = true;
    else openLocalGame();
    return;
  }
  if (!isPlayerView() || !user || signingOut || offline || document.hidden) return;
  refreshQueued = false;
  return openGame(undefined, true);
}

window.addEventListener("offline", () => {
  offline = true;
  updateGameControls();
  if (!localMode) setConnection(null, "error");
});
window.addEventListener("online", () => {
  offline = false;
  updateGameControls();
  refreshGame();
});
function resumeGame() {
  if (cooldownUntil) paintCooldown();
  showAchievementNotices();
  // Cookies are shared across tabs. Even a brief switch can change accounts;
  // openGame coalesces the paired visibility/focus events into one refresh.
  refreshGame();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) identityEpoch++;
  else resumeGame();
});
window.addEventListener("blur", () => identityEpoch++);
window.addEventListener("focus", () => {
  if (isPlayerView()) paintReset(true);
  resumeGame();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) refreshGame();
});

function handleExpiredSession() {
  gameReady = false;
  setUser(null);
  show("login");
  showError("#login-error", "Your session expired. Sign in again.", true);
}

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (offlineOnly || authenticating) return;
    const view = button.dataset.view;
    if (view === "home") {
      if (user) openGame();
      else showHome();
    } else if (view === "login" || view === "signup") show(view);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = $<HTMLInputElement>(`#${button.dataset.togglePassword}`);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show" : "Hide";
    button.setAttribute("aria-label", `${showing ? "Show" : "Hide"} password`);
    input.focus();
  });
});

function setAuthenticating(active: boolean, form: HTMLFormElement) {
  authenticating = active;
  setSubmitting(form, active);
  for (const other of [loginForm, signupForm])
    $<HTMLButtonElement>("button[type=submit]", other).disabled = active;
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.disabled = active;
  });
  updateGameControls();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (authenticating || signingOut) return;
  showError("#login-error", "");
  setAuthenticating(true, loginForm);
  const generation = clickGeneration;
  let signedIn = false;
  try {
    const form = new FormData(loginForm);
    const result = await api<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
        identifier_type: form.get("identifier_type") ?? "auto",
      }),
    });
    if (generation !== clickGeneration || currentView !== "login") {
      if (!localMode) await boot();
      return;
    }
    loginForm.reset();
    setUser(result.user);
    signedIn = true;
    await openGame();
  } catch (caught) {
    const error = requestError(caught);
    if (generation === clickGeneration && currentView === "login")
      showError("#login-error", error.message, true);
  } finally {
    setAuthenticating(false, loginForm);
    if (signedIn && !localMode && currentView === "game" && gameReady) clickButton.focus();
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (authenticating || signingOut) return;
  showError("#signup-error", "");
  const form = new FormData(signupForm);
  if (form.get("password") !== form.get("password_confirmation")) {
    showError("#signup-error", "Passwords do not match.", true);
    $<HTMLInputElement>("#signup-password-confirmation").focus();
    return;
  }
  setAuthenticating(true, signupForm);
  const generation = clickGeneration;
  let signedIn = false;
  try {
    const result = await api<{ user: User }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    if (generation !== clickGeneration || currentView !== "signup") {
      if (!localMode) await boot();
      return;
    }
    signupForm.reset();
    setUser(result.user);
    signedIn = true;
    await openGame();
  } catch (caught) {
    const error = requestError(caught);
    if (generation === clickGeneration && currentView === "signup")
      showError("#signup-error", error.message, true);
  } finally {
    setAuthenticating(false, signupForm);
    if (signedIn && !localMode && currentView === "game" && gameReady) clickButton.focus();
  }
});

const logoutButton = $<HTMLButtonElement>("#logout-button");
logoutButton.addEventListener("click", async () => {
  if (authenticating || signingOut) return;
  showError("#game-error", "");
  signingOut = true;
  updateGameControls();
  logoutButton.disabled = true;
  try {
    await api("/api/auth/logout", { method: "DELETE" });
    gameReady = false;
    setUser(null);
    showHome();
  } catch {
    showGameError("signOutError", true);
  } finally {
    signingOut = false;
    logoutButton.disabled = false;
    updateGameControls();
  }
});

clickButton.addEventListener("button-interaction", (event) => {
  const interaction: unknown = (event as CustomEvent).detail;
  if (interaction === "reconnect" || interaction === "reset")
    return recordButtonAchievement(interaction);
});

async function recordButtonAchievement(interaction: ButtonInteraction) {
  if (
    !gameReady ||
    currentView !== "game" ||
    signingOut ||
    authenticating ||
    localSaveReplacing ||
    (!localMode && (!user || offline))
  )
    return;
  const bit = buttonAchievementBits[interaction];
  if (((displayedCounters.button_achievements ?? 0) | pendingButtonAchievements) & bit) return;

  const generation = clickGeneration;
  const accountID = localMode ? undefined : user?.id;
  pendingButtonAchievements |= bit;
  updateGameControls();
  try {
    let earned: number;
    if (accountID) {
      const data = await api<{ button_achievements: number }>("/api/button-achievements", {
        method: "POST",
        headers: { "X-GoClick-User-ID": accountID },
        body: JSON.stringify({ interaction }),
      });
      earned = data.button_achievements;
      if (
        !Number.isInteger(earned) ||
        earned < 0 ||
        earned > buttonAchievementMask ||
        !(earned & bit)
      )
        throw new Error("The response did not confirm the button achievement.");
    } else {
      earned = await localGame.change(() =>
        generation === clickGeneration ? localGame.recordButtonAchievement(interaction) : 0,
      );
    }
    if (generation !== clickGeneration) return;
    renderCounters(mergeButtonAchievements(displayedCounters, earned), false, true);
    if (lastOnlineCounters && accountID)
      lastOnlineCounters = mergeButtonAchievements(lastOnlineCounters, earned);
  } catch (caught) {
    if (generation !== clickGeneration) return;
    const error = requestError(caught);
    if (error.status === 401) {
      if (!signingOut) handleExpiredSession();
    } else if (error.code === "account_changed") {
      gameReady = false;
      refreshQueued = true;
    } else showGameError("buttonAchievementError");
  } finally {
    if (generation === clickGeneration) {
      pendingButtonAchievements &= ~bit;
      updateGameControls();
      if (!hasPendingProgress()) {
        if (localMode && localRefreshQueued) synchronizeLocalSave();
        else if (!localMode && refreshQueued) refreshGame();
      }
    }
  }
}

clickButton.addEventListener("click", async (event) => {
  if (currentView !== "game" || clickButton.disabled) return;
  paintButtonLanguage(buttonLanguage.click(performance.now(), currentLanguage()));
  const earned = tactileButtons.get(clickButton)?.clickAchievements ?? 0;
  if (localMode) {
    await clickLocal(event, earned);
    return;
  }
  if (
    !user ||
    !gameReady ||
    (offline && !localMode) ||
    signingOut ||
    authenticating ||
    pendingClicks >= maxPendingClicks
  )
    return;
  if (coolingDown()) {
    tactileButtons.get(clickButton)?.respond("limited");
    clickSound.play("limited");
    return;
  }
  if (pendingClicks === 0) {
    showError("#game-error", "");
    clickBatchFailed = false;
  }
  pendingClicks++;
  updatePendingIndicator();
  const feedback = clickFeedback.start(clickButton, event);
  updateGameControls();
  const started = performance.now();
  const generation = clickGeneration;
  setConnection(null, "loading");
  let saved = false;
  try {
    const data = await api<Counters>("/api/clicks", {
      method: "POST",
      headers: {
        "X-GoClick-User-ID": user.id,
        ...(earned ? { "X-GoClick-Button-Achievements": String(earned) } : {}),
      },
    });
    if (generation !== clickGeneration) return;
    const count = data.click_count?.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      const error = new RequestError("The server response did not include a saved click count.");
      error.uncertain = true;
      throw error;
    }
    paintLastClick(true);
    renderCounters(data, false, true);
    if (count >= (lastOnlineCounters?.click_count?.count ?? 0))
      lastOnlineCounters = displayedCounters;
    feedback.success(performance.now() - started);
    saved = true;
  } catch (caught) {
    const error = requestError(caught);
    if (generation !== clickGeneration) return;
    feedback.fail(error.uncertain, error.status === 429);
    if (error.status === 401) {
      if (user && !signingOut) handleExpiredSession();
      return;
    }
    if (error.code === "account_changed") {
      gameReady = false;
      refreshQueued = true;
      return;
    }
    if (error.status === 429) {
      startCooldown(error.retryAfter);
      return;
    }
    clickBatchFailed = true;
    showGameError(error.uncertain ? "unconfirmedClick" : "unsavedClick", true);
    if (error.uncertain) retryGameButton.hidden = false;
    setConnection(null, "error");
  } finally {
    if (generation === clickGeneration) {
      pendingClicks--;
      updatePendingIndicator();
      updateGameControls();
      if (!clickBatchFailed && pendingClicks > 0) {
        setConnection(null, "loading");
      } else if (!clickBatchFailed && saved) {
        setConnection(performance.now() - started);
      }
      if (pendingClicks === 0 && refreshQueued) refreshGame();
    }
  }
});

async function boot(returningOnline = false) {
  if (localMode) {
    openLocalGame();
    return;
  }
  const generation = clickGeneration;
  show("loading");
  views.loading.setAttribute("aria-busy", "true");
  $(".loading-spinner").hidden = false;
  $("#loading-message").textContent = t("loadingCounter");
  retryBootButton.hidden = true;
  try {
    const state = await readGameState();
    if (generation !== clickGeneration || localMode) return;
    setUser(state.user);
    await openGame(state);
  } catch (caught) {
    const error = requestError(caught);
    if (generation !== clickGeneration || localMode) return;
    if (error.status === 401) {
      setUser(null);
      if (!returningOnline && pageFromLocation() === "achievements") show("achievements");
      else showHome();
      return;
    }
    $(".loading-spinner").hidden = true;
    $("#loading-message").textContent = t("loadError");
    retryBootButton.hidden = false;
    views.loading.setAttribute("aria-busy", "false");
    retryBootButton.focus();
  }
}

retryGameButton.addEventListener("click", refreshGame);
refreshCounterButton.addEventListener("click", refreshGame);
$<HTMLButtonElement>("#share-stats").addEventListener("click", () => {
  if (!gameReady || signingOut || pendingClicks > 0 || counterLoad || localSaveReplacing) return;
  return statsShare.open(displayedCounters, localMode);
});
retryBootButton.addEventListener("click", () => boot());

const optionsDialog = $<HTMLDialogElement>("#options-dialog");
let offlineCacheMessage: MessageKey = "offlineCachePreparing";
function paintOfflineCacheStatus() {
  if (offlineOnly) $("#offline-cache-status").textContent = t(offlineCacheMessage);
}
const replaceLocalConsent = $<HTMLInputElement>("#replace-local");
const importLocal = $<HTMLInputElement>("#import-local");
optionsDialog.addEventListener("close", () => clickSound.cancelPreview());
let currentOptionsNotice: { key: MessageKey; error: boolean; detail?: string } | null = null;
function paintOptionsMessage(target: HTMLElement, key: MessageKey, detail?: string) {
  target.textContent = t(key);
  if (detail) {
    const diagnostic = document.createElement("bdi");
    diagnostic.lang = "en";
    diagnostic.textContent = detail;
    target.append(" ", diagnostic);
  }
}
function paintOptionsNotice() {
  const notice = $("#options-status");
  if (currentOptionsNotice) {
    const { key, detail } = currentOptionsNotice;
    paintOptionsMessage(notice, key, detail);
  } else notice.textContent = "";
  notice.classList.toggle("notice-error", currentOptionsNotice?.error ?? false);
}
function optionsNotice(key?: MessageKey, error = false, detail?: string) {
  currentOptionsNotice = key ? { key, error, detail } : null;
  paintOptionsNotice();
}
function updateOptions() {
  $<HTMLButtonElement>("#copy-online-local").disabled =
    !lastOnlineCounters || hasPendingProgress() || localSaveReplacing;
  const name = user?.username;
  $("#copy-online-note").textContent =
    lastOnlineCounters && name
      ? t("copyAccountNote", { name: languageDirection() === "rtl" ? `\u2068${name}\u2069` : name })
      : t("copyAccountHint");
  const summary = $("#local-save-summary");
  try {
    const data = localGame.read();
    summary.textContent = t("localSaveCount", {
      count: formatNumber(data.click_count?.count ?? 0),
    });
  } catch (caught) {
    paintOptionsMessage(summary, "localSaveUnavailable", requestError(caught).message);
  }
}
$<HTMLButtonElement>("#options-button").addEventListener("click", () => {
  optionsNotice();
  replaceLocalConsent.checked = false;
  updateOptions();
  optionsDialog.showModal();
  optionsDialog.scrollTop = 0;
});
$<HTMLButtonElement>("#close-options").addEventListener("click", () => optionsDialog.close());
function saveOption(patch: Parameters<typeof gameSettings.update>[0]) {
  try {
    gameSettings.update(patch);
    optionsNotice();
  } catch {
    optionsNotice("settingsVisit", true);
  }
}
const paintOptionPreferencesLanguage = bindOptionPreferences(saveOption);
motionShortcut.addEventListener("click", () => {
  try {
    gameSettings.update({ motion: "off" });
  } catch {
    // The choice applies for this visit even if browser storage is unavailable.
  }
});
function openLocalGame(data?: Counters) {
  show(pageFromLocation());
  showError("#game-error", "");
  retryGameButton.hidden = true;
  try {
    applyLoadedCounters(data ?? localGame.read());
    counterCard.setAttribute("aria-busy", "false");
    updateGameControls();
    setConnection();
  } catch {
    showLocalLoadError();
  }
}
function showLocalLoadError() {
  gameReady = false;
  resetLocalSaveFeedback();
  renderCounters({}, true);
  updateGameControls();
  showGameError("localLoadError", true);
}
function resetLocalSaveFeedback() {
  lastClicks.delete("local");
  clearAchievementNotice();
  resetClickState();
}
function startLocalGame(scoreFirstClick = false) {
  if (hasPendingProgress() || signingOut || localSaveReplacing) return;
  try {
    const data = localGame.read();
    gameSettings.setMode("local");
    localMode = true;
    clearAchievementNotice();
    gameReady = false;
    resetClickState();
    optionsDialog.close();
    openLocalGame(data);
    if (currentView === "game") clickButton.focus();
    if (scoreFirstClick) {
      offlineStartNotice.textContent = t("playingOffline");
      offlineStartTimer = window.setTimeout(() => (offlineStartNotice.textContent = ""), 4000);
      return clickLocal();
    }
  } catch (caught) {
    optionsNotice("openLocalFailed", true, requestError(caught).message);
    if (!optionsDialog.open) {
      updateOptions();
      optionsDialog.showModal();
    }
  }
}
guestClickButton.addEventListener("click", () => {
  if (currentView === "home") return startLocalGame(true);
});
document
  .querySelectorAll<HTMLButtonElement>("[data-play-local]")
  .forEach((button) => button.addEventListener("click", () => startLocalGame()));
$<HTMLButtonElement>("#leave-local").addEventListener("click", async () => {
  if (offlineOnly || hasPendingProgress() || localSaveReplacing || authenticating) return;
  let remembered = true;
  try {
    gameSettings.setMode("online");
  } catch {
    remembered = false;
  }
  localMode = false;
  clearAchievementNotice();
  gameReady = false;
  resetClickState();
  renderCounters({}, true);
  await boot(true);
  if (!remembered) {
    updateOptions();
    optionsNotice("backOnlineVisit", true);
    optionsDialog.showModal();
  }
});
async function clickLocal(event: Activation = { detail: 0, clientX: 0, clientY: 0 }, earned = 0) {
  if (!gameReady || localSaveReplacing || pendingClicks >= maxPendingClicks) return;
  const feedback = clickFeedback.start(clickButton, event, true),
    generation = clickGeneration,
    acknowledgement = ++localAcknowledgement;
  const base = gameSettings.value.simulatedPing;
  const simulated = Math.round(base * (0.7 + Math.random() * 0.6));
  pendingClicks++;
  updatePendingIndicator();
  updateGameControls();
  setConnection(null, "loading");
  try {
    // Save immediately; simulated ping affects only the visual acknowledgement.
    const data = await localGame.change(() => localGame.increment(undefined, earned));
    if (generation !== clickGeneration) return;
    paintLastClick(true);
    renderCounters(data, false, true);
    showError("#game-error", "");
    window.setTimeout(() => {
      if (generation !== clickGeneration) return;
      feedback.success(simulated);
      if (acknowledgement === localAcknowledgement) setConnection(simulated);
    }, simulated);
  } catch {
    if (generation !== clickGeneration) return;
    feedback.fail(false);
    setConnection(null, "error");
    showGameError("localClickError", true);
  } finally {
    if (generation === clickGeneration) {
      pendingClicks--;
      updatePendingIndicator();
      updateGameControls();
      if (pendingClicks === 0 && localRefreshQueued) synchronizeLocalSave();
    }
  }
}
function canReplaceLocalSave() {
  if (localSaveReplacing) return false;
  if (!replaceLocalConsent.checked) {
    optionsNotice("replaceConsent", true);
    replaceLocalConsent.focus();
    return false;
  }
  if (hasPendingProgress()) {
    optionsNotice("waitPending", true);
    return false;
  }
  return true;
}
async function replaceLocalSave(
  operation: () => Counters | Promise<Counters>,
  completion: MessageKey,
  failure: MessageKey = "localReplacedFailed",
) {
  if (!canReplaceLocalSave()) return;
  localSaveReplacing = true;
  replaceLocalConsent.checked = false;
  updateGameControls();
  optionsNotice("replacingLocal");
  try {
    const data = await operation();
    await localGame.change(() => localGame.replace(data));
    if (localMode) {
      resetLocalSaveFeedback();
      openLocalGame();
    } else if (isGuestAchievements()) renderGuestAchievements();
    updateOptions();
    optionsNotice(completion);
  } catch (caught) {
    optionsNotice(failure, true, requestError(caught).message);
  } finally {
    localSaveReplacing = false;
    updateGameControls();
    if (localRefreshQueued) synchronizeLocalSave();
  }
}
$<HTMLButtonElement>("#restart-local").addEventListener("click", () =>
  replaceLocalSave(() => ({}), "localRestarted"),
);
$<HTMLButtonElement>("#copy-online-local").addEventListener("click", () => {
  if (!lastOnlineCounters) return;
  const snapshot = lastOnlineCounters;
  replaceLocalSave(() => snapshot, "accountCopied");
});
importLocal.addEventListener("click", (event) => {
  if (!canReplaceLocalSave()) event.preventDefault();
});
importLocal.addEventListener("change", async () => {
  const file = importLocal.files?.[0];
  importLocal.value = "";
  if (!file) return;
  if (file.size > 1024 * 1024) {
    optionsNotice("saveTooLarge", true);
    return;
  }
  await replaceLocalSave(
    async () => localGame.decode(await file.text()),
    "localImported",
    "importFailed",
  );
});
$<HTMLButtonElement>("#download-local").addEventListener("click", async () => {
  try {
    const saved = await localGame.change(() => localGame.encode(localGame.read()));
    const url = URL.createObjectURL(new Blob([saved], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "goclick-local.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    optionsNotice("localDownloaded");
  } catch (caught) {
    optionsNotice("downloadFailed", true, requestError(caught).message);
  }
});
function synchronizeLocalSave() {
  if (isGuestAchievements()) renderGuestAchievements();
  else if (localMode) {
    if (hasPendingProgress() || localSaveReplacing) {
      localRefreshQueued = true;
      return;
    }
    localRefreshQueued = false;
    try {
      const data = localGame.read();
      const previous = displayedCounters.click_count;
      const current = data.click_count;
      if (!gameReady || (current?.count ?? 0) < (previous?.count ?? 0)) {
        resetLocalSaveFeedback();
        replaceLocalConsent.checked = false;
        openLocalGame(data);
      } else {
        // A click in another tab does not cancel this tab's pending visual
        // and audio acknowledgement or move its keyboard focus.
        applyLoadedCounters(data);
      }
    } catch {
      showLocalLoadError();
    }
  }
  if (optionsDialog.open) updateOptions();
}
window.addEventListener("storage", (event) => {
  if (event.key === localGame.key || event.key === null) synchronizeLocalSave();
});

const paintLanguagePicker = languagePicker();
function applyLanguage() {
  translatePage();
  paintOptionPreferencesLanguage();
  paintOptionsNotice();
  paintOfflineCacheStatus();
  if (optionsDialog.open) updateOptions();
  paintLanguagePicker();
  document.documentElement.lang = currentLanguage();
  if (currentView === "loading")
    $("#loading-message").textContent = t(retryBootButton.hidden ? "loadingCounter" : "loadError");
  buttonLanguage.reset(currentLanguage());
  paintButtonLanguage(currentLanguage());
  if (isGuestAchievements()) renderGuestAchievements();
  else renderCounters(displayedCounters, true);
  if (currentView === "achievements") paintAchievementTitle();
  if (offlineStartNotice.textContent) offlineStartNotice.textContent = t("playingOffline");
  if (isPlayerView()) paintReset(true);
  updatePendingIndicator();
  updateGameControls();
  if (lastGameError) showGameError(lastGameError);
  if (cooldownUntil) paintCooldown();
  else setConnection(null, connectionState);
}
onLanguageChange(applyLanguage);
setLanguage(readLanguage());
applyLanguage();
window.addEventListener("storage", (event) => {
  if (event.key === languageStorageKey || event.key === null) setLanguage(readLanguage());
});

boot();

if (offlineOnly) {
  void offlineWorkerReady().then((ready) => {
    offlineCacheMessage = ready ? "offlineCacheReady" : "offlineCacheUnavailable";
    paintOfflineCacheStatus();
  });
}

export { show, setUser, openGame, refreshGame, startLocalGame };
