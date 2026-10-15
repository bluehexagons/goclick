import { request, requestError } from "./http.js";
import { required as $ } from "./dom.js";
import { gameSettings, motionPreference } from "./preferences.js";
import { localGame } from "./local-game.js";
import { tactileButtons } from "./button.js";
import { clickFeedback } from "./click-feedback.js";
import type { User, Counters, Activation } from "./types.js";

const views = {
  loading: $("#loading-view"),
  home: $("#home-view"),
  auth: $("#auth-view"),
  game: $("#game-view"),
};
const loginForm = $<HTMLFormElement>("#login-form");
const signupForm = $<HTMLFormElement>("#signup-form");
const clickButton = $<HTMLButtonElement>("#click-button");
const counterCard = $("#counter-card");
const retryGameButton = $<HTMLButtonElement>("#retry-game-button");
const retryBootButton = $<HTMLButtonElement>("#retry-boot-button");
const refreshCounterButton = $<HTMLButtonElement>("#refresh-counter");
const connection = $("#connection");
const pendingIndicator = $("#pending-clicks");
type View = "loading" | "home" | "login" | "signup" | "game";
let currentView: View | "" = "";
let viewAnimation: Animation | null = null;
let pingStateTimer = 0,
  pendingIndicatorTimer = 0;
const numberAnimations = new WeakMap<HTMLElement, Animation>();
motionPreference.addEventListener("change", () => {
  if (!motionPreference.matches) return;
  viewAnimation?.cancel();
  for (const id of ["click-count", "day-streak", "month-streak", "year-streak"])
    numberAnimations.get($(`#${id}`))?.cancel();
});
let user: User | null = null;
let localMode = gameSettings.mode() === "local";
let lastOnlineCounters: Counters | null = null;
let gameReady = false;
let pendingClicks = 0;
let clickBatchFailed = false;
let signingOut = false;
let clickGeneration = 0;
let counterLoad: Promise<void> | null = null;
let counterLoadOwner: object | null = null;
let refreshQueued = false;
let offline = navigator.onLine === false;
let lastCounterSync = -Infinity;
const maxPendingClicks = 6;

function show(view: View) {
  const changed = view !== currentView;
  if (changed) {
    for (const controller of tactileButtons.values()) controller.reset();
    viewAnimation?.cancel();
  }
  currentView = view;
  if (changed) window.scrollTo(0, 0);
  const authenticated = view === "game";
  views.loading.hidden = view !== "loading";
  views.home.hidden = view !== "home";
  views.auth.hidden = view !== "login" && view !== "signup";
  views.game.hidden = !authenticated;
  loginForm.hidden = view !== "login";
  signupForm.hidden = view !== "signup";
  $("#guest-nav").hidden = authenticated || view === "loading";
  $("#user-nav").hidden = !authenticated || localMode;
  $("#local-nav").hidden = !authenticated || !localMode;
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
  const element = $(id);
  element.textContent = message;
  element.hidden = !message;
  if (message && focus) element.focus();
}

function setConnection(milliseconds: number | null = null, state: "" | "loading" | "error" = "") {
  window.clearTimeout(pingStateTimer);
  if (Number.isFinite(milliseconds) && milliseconds !== null)
    $("#ping").textContent = `${Math.round(milliseconds)} ms`;
  const paintState = () => {
    connection.classList.toggle("is-loading", state === "loading" && (!offline || localMode));
    connection.classList.toggle("is-error", state === "error" || (offline && !localMode));
    const status =
      offline && !localMode
        ? "Offline. Clicking paused"
        : state === "loading"
          ? "Request in progress"
          : state === "error"
            ? "Last request failed"
            : "No requests pending";
    connection.setAttribute("aria-label", `Ping ${$("#ping").textContent}. ${status}.`);
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
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return request<T>(url, { ...options, headers });
}

function setUser(nextUser: User | null) {
  const identityChanged = user?.id !== nextUser?.id;
  user = nextUser;
  if (identityChanged) lastOnlineCounters = null;
  $("#nav-username").textContent = user?.username ?? "";
  $("#game-username").textContent = user?.username ?? "";
  $("#game-player-id").textContent = user ? `#${user.id}` : "";
  $<HTMLAnchorElement>("#admin-link").hidden = !user?.admin;
  if (identityChanged) {
    resetClickState();
    renderCounters({}, true);
  }
}

function resetClickState() {
  clickGeneration++;
  // Detach stale reads so returning from local play can load immediately.
  counterLoad = null;
  counterLoadOwner = null;
  counterCard.setAttribute("aria-busy", "false");
  pendingClicks = 0;
  updatePendingIndicator();
  clickBatchFailed = false;
  refreshQueued = false;
  window.clearTimeout(pingStateTimer);
  $("#ping").textContent = "— ms";
  connection.classList.remove("is-loading", "is-error");
  connection.setAttribute("aria-label", "Ping: no click measured yet");
  tactileButtons.get(clickButton)?.reset();
  clickFeedback.reset();
  updateGameControls();
}

function updateGameControls() {
  clickButton.disabled =
    !gameReady ||
    (offline && !localMode) ||
    signingOut ||
    (!localMode && pendingClicks >= maxPendingClicks);
  // Keep a focused refresh control in the tab order while its read is in flight.
  // Repeated activations share counterLoad instead of starting another request.
  refreshCounterButton.disabled = (offline && !localMode) || signingOut || pendingClicks > 0;
  refreshCounterButton.setAttribute(
    "aria-disabled",
    String(refreshCounterButton.disabled || !!counterLoad),
  );
  refreshCounterButton.setAttribute("aria-busy", String(!!counterLoad));
  $("#network-notice").hidden = !offline || localMode;
  $("#local-mode-note").hidden = !localMode;
  $("#counter-label").textContent = localMode ? "Local clicks" : "Saved clicks";
  $(".connection-label").textContent = localMode ? "Sim ping" : "Ping";
  document.querySelectorAll<HTMLButtonElement>("[data-play-local]").forEach((button) => {
    button.hidden = localMode;
    button.disabled = pendingClicks > 0 || signingOut;
  });
  $<HTMLButtonElement>("#leave-local").disabled = pendingClicks > 0;
  $<HTMLButtonElement>("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0;
  if (localMode) {
    $("#game-username").textContent = "Offline play";
    $("#game-player-id").textContent = "this browser";
  }
}

function updatePendingIndicator() {
  if (pendingClicks === 0) {
    window.clearTimeout(pendingIndicatorTimer);
    pendingIndicatorTimer = 0;
    pendingIndicator.hidden = true;
    pendingIndicator.textContent = "";
    return;
  }
  pendingIndicator.textContent = `+${pendingClicks} pending`;
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

function renderCounters(data: Counters, allowDecrease = false) {
  const clicks = data.click_count;
  const displayedClicks = Number($("#click-count").textContent);
  if (
    !allowDecrease &&
    clicks &&
    Number.isFinite(displayedClicks) &&
    clicks.count < displayedClicks
  )
    return;
  for (const [id, count] of [
    ["click-count", clicks?.count ?? 0],
    ["day-streak", data.streak_counter_day?.count ?? 0],
    ["month-streak", data.streak_counter_month?.count ?? 0],
    ["year-streak", data.streak_counter_year?.count ?? 0],
  ] as const) {
    const element = $(`#${id}`),
      changed = element.textContent !== String(count);
    element.textContent = String(count);
    if (changed && !allowDecrease) animateNumber(element);
  }
  $("#last-click").textContent = clicks?.modified_time
    ? `Last click ${new Date(clicks.modified_time).toLocaleString()}`
    : "No saved clicks yet.";
}

function openGame(
  initialCounters?: Counters | Promise<Counters>,
  verifyIdentity = false,
): Promise<void> {
  if (localMode) {
    openLocalGame();
    return Promise.resolve();
  }
  if (counterLoad) return counterLoad;
  if (pendingClicks > 0) {
    refreshQueued = true;
    return Promise.resolve();
  }
  let generation = clickGeneration;
  const focusButton = currentView === "login" || currentView === "signup";
  show("game");
  showError("#game-error", "");
  retryGameButton.hidden = true;
  gameReady = false;
  clickButton.disabled = true;
  if (!verifyIdentity) counterCard.setAttribute("aria-busy", "true");
  setConnection(null, "loading");
  const owner = {};
  counterLoadOwner = owner;
  const load = (async () => {
    try {
      // Check identity as well as counters: another tab may have switched accounts.
      const [nextUser, data] = verifyIdentity
        ? await Promise.all([api<User>("/api/me"), api<Counters>("/api/clicks")])
        : [user, await (initialCounters ?? api<Counters>("/api/clicks"))];
      if (generation !== clickGeneration) return;
      if (verifyIdentity) {
        const activeLoad = counterLoad;
        setUser(nextUser);
        counterLoad = activeLoad;
        generation = clickGeneration;
        counterLoadOwner = owner;
      }
      lastOnlineCounters = data;
      renderCounters(data, true);
      lastCounterSync = performance.now();
      gameReady = true;
      updateGameControls();
      if (focusButton && !clickButton.disabled) clickButton.focus();
      setConnection();
    } catch (caught) {
      const error = requestError(caught);
      if (generation !== clickGeneration) return;
      if (error.status === 401) {
        if (user && !signingOut) handleExpiredSession();
      } else {
        showError("#game-error", `Couldn’t load your counter. ${error.message}`, !verifyIdentity);
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
  if (localMode) {
    if (currentView === "game") openLocalGame();
    return;
  }
  if (currentView !== "game" || !user || signingOut || offline || document.hidden) return;
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
  // Visibility and focus often arrive together. A brief switch away should not
  // interrupt the button or repeatedly fetch data we just loaded.
  if (gameReady && performance.now() - lastCounterSync < 15000) return;
  refreshGame();
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) resumeGame();
});
window.addEventListener("focus", resumeGame);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) refreshGame();
});

function handleExpiredSession() {
  gameReady = false;
  setUser(null);
  show("login");
  showError("#login-error", "Your session expired. Sign in to keep clicking.", true);
}

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "home" && user) openGame();
    else if (view === "home" || view === "login" || view === "signup") show(view);
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

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("#login-error", "");
  setSubmitting(loginForm, true);
  const generation = clickGeneration;
  try {
    const form = new FormData(loginForm);
    const result = await api<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    if (generation !== clickGeneration || currentView !== "login") return;
    loginForm.reset();
    setUser(result.user);
    await openGame();
  } catch (caught) {
    const error = requestError(caught);
    if (generation === clickGeneration && currentView === "login")
      showError("#login-error", error.message, true);
  } finally {
    setSubmitting(loginForm, false);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("#signup-error", "");
  const form = new FormData(signupForm);
  if (form.get("password") !== form.get("password_confirmation")) {
    showError("#signup-error", "Passwords do not match.", true);
    $<HTMLInputElement>("#signup-password-confirmation").focus();
    return;
  }
  setSubmitting(signupForm, true);
  const generation = clickGeneration;
  try {
    const result = await api<{ user: User }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    if (generation !== clickGeneration || currentView !== "signup") return;
    signupForm.reset();
    setUser(result.user);
    await openGame();
  } catch (caught) {
    const error = requestError(caught);
    if (generation === clickGeneration && currentView === "signup")
      showError("#signup-error", error.message, true);
  } finally {
    setSubmitting(signupForm, false);
  }
});

const logoutButton = $<HTMLButtonElement>("#logout-button");
logoutButton.addEventListener("click", async () => {
  showError("#game-error", "");
  signingOut = true;
  gameReady = false;
  updateGameControls();
  logoutButton.disabled = true;
  try {
    await api("/api/auth/logout", { method: "DELETE" });
    setUser(null);
    show("home");
  } catch (caught) {
    const error = requestError(caught);
    gameReady = true;
    showError("#game-error", `Could not sign out: ${error.message}`, true);
  } finally {
    signingOut = false;
    logoutButton.disabled = false;
    updateGameControls();
  }
});

clickButton.addEventListener("click", async (event) => {
  if (localMode) {
    await clickLocal(event);
    return;
  }
  if (
    !gameReady ||
    (offline && !localMode) ||
    signingOut ||
    (!localMode && pendingClicks >= maxPendingClicks)
  )
    return;
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
    const data = await api<Counters>("/api/clicks", { method: "POST" });
    if (generation !== clickGeneration) return;
    renderCounters(data);
    if ((data.click_count?.count ?? 0) >= (lastOnlineCounters?.click_count?.count ?? 0))
      lastOnlineCounters = data;
    feedback.success(performance.now() - started);
    saved = true;
  } catch (caught) {
    const error = requestError(caught);
    if (generation !== clickGeneration) return;
    feedback.fail(error.uncertain);
    if (error.status === 401) {
      if (user && !signingOut) handleExpiredSession();
      return;
    }
    clickBatchFailed = true;
    showError(
      "#game-error",
      error.status === 429 && error.retryAfter
        ? `Slow down for ${error.retryAfter} seconds.`
        : error.uncertain
          ? `Couldn’t confirm your click. Reload your counter to check whether it saved. ${error.message}`
          : `Your click wasn’t saved. ${error.message}`,
      true,
    );
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

async function boot() {
  if (localMode) {
    openLocalGame();
    return;
  }
  const generation = clickGeneration;
  show("loading");
  views.loading.setAttribute("aria-busy", "true");
  $(".loading-spinner").hidden = false;
  $("#loading-message").textContent = "Loading your counter…";
  retryBootButton.hidden = true;
  try {
    // Start both reads together, but let identity decide whether to show the
    // game. Observe the counter rejection even if checking identity fails.
    const counters = api<Counters>("/api/clicks");
    counters.catch(() => {});
    const identity = await api<User>("/api/me");
    if (generation !== clickGeneration || localMode) return;
    setUser(identity);
    await openGame(counters);
  } catch (caught) {
    const error = requestError(caught);
    if (generation !== clickGeneration || localMode) return;
    if (error.status === 401) {
      show("home");
      return;
    }
    $(".loading-spinner").hidden = true;
    $("#loading-message").textContent = error.message;
    retryBootButton.hidden = false;
    views.loading.setAttribute("aria-busy", "false");
    retryBootButton.focus();
  }
}

retryGameButton.addEventListener("click", refreshGame);
refreshCounterButton.addEventListener("click", refreshGame);
retryBootButton.addEventListener("click", () => boot());

const optionsDialog = $<HTMLDialogElement>("#options-dialog");
function optionsNotice(message: string, error = false) {
  const notice = $("#options-status");
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle("notice-error", error);
}
function updateOptions() {
  $<HTMLSelectElement>("#motion-setting").value = gameSettings.value.motion;
  $<HTMLSelectElement>("#simulated-ping").value = String(gameSettings.value.simulatedPing);
  $<HTMLButtonElement>("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0;
  $("#copy-online-note").textContent = lastOnlineCounters
    ? `Copy the last loaded account progress for ${user?.username ?? "your account"}. This only replaces the local save.`
    : "Open your account counter first to make a copy. Copying only replaces the local save.";
  try {
    const data = localGame.read();
    $("#local-save-summary").textContent =
      `${data.click_count?.count ?? 0} clicks saved in this browser.`;
  } catch (caught) {
    const error = requestError(caught);
    $("#local-save-summary").textContent = `Local save unavailable. ${error.message}`;
  }
}
$<HTMLButtonElement>("#options-button").addEventListener("click", () => {
  optionsNotice("");
  $<HTMLInputElement>("#replace-local").checked = false;
  updateOptions();
  optionsDialog.showModal();
});
$<HTMLButtonElement>("#close-options").addEventListener("click", () => optionsDialog.close());
function saveOption(patch: Parameters<typeof gameSettings.update>[0]) {
  try {
    gameSettings.update(patch);
    optionsNotice("Option saved.");
  } catch {
    optionsNotice(
      "Applied for this visit. Browser storage is unavailable, so this option could not be remembered.",
      true,
    );
  }
}
$<HTMLSelectElement>("#motion-setting").addEventListener("change", () => {
  const motion = $<HTMLSelectElement>("#motion-setting").value;
  if (motion === "auto" || motion === "on" || motion === "off") saveOption({ motion });
});
$<HTMLSelectElement>("#simulated-ping").addEventListener("change", () => {
  const simulatedPing = Number($<HTMLSelectElement>("#simulated-ping").value);
  if (simulatedPing === 0 || simulatedPing === 80 || simulatedPing === 250 || simulatedPing === 800)
    saveOption({ simulatedPing });
});
function openLocalGame(data?: Counters) {
  show("game");
  showError("#game-error", "");
  retryGameButton.hidden = true;
  try {
    renderCounters(data ?? localGame.read(), true);
    gameReady = true;
    counterCard.setAttribute("aria-busy", "false");
    updateGameControls();
    setConnection();
  } catch (caught) {
    const error = requestError(caught);
    gameReady = false;
    updateGameControls();
    showError(
      "#game-error",
      `Couldn’t load your local save. ${error.message} Open Options to import a copy or restart the local save.`,
      true,
    );
  }
}
function startLocalGame() {
  if (pendingClicks > 0 || signingOut) return;
  try {
    const data = localGame.read();
    gameSettings.setMode("local");
    localMode = true;
    gameReady = false;
    resetClickState();
    optionsDialog.close();
    openLocalGame(data);
    clickButton.focus();
  } catch (caught) {
    const error = requestError(caught);
    optionsNotice(`Couldn’t open the local save. ${error.message}`, true);
    if (!optionsDialog.open) {
      updateOptions();
      optionsDialog.showModal();
    }
  }
}
document
  .querySelectorAll<HTMLButtonElement>("[data-play-local]")
  .forEach((button) => button.addEventListener("click", startLocalGame));
$<HTMLButtonElement>("#leave-local").addEventListener("click", () => {
  if (pendingClicks > 0) return;
  try {
    gameSettings.setMode("online");
  } catch {
    showError(
      "#game-error",
      "Browser storage is unavailable. Couldn’t remember the mode change.",
      true,
    );
    return;
  }
  localMode = false;
  gameReady = false;
  resetClickState();
  boot();
});
async function clickLocal(event: Activation) {
  if (!gameReady) return;
  const feedback = clickFeedback.start(clickButton, event, true),
    generation = clickGeneration;
  const base = gameSettings.value.simulatedPing;
  const simulated = Math.round(base * (0.7 + Math.random() * 0.6));
  pendingClicks++;
  updateGameControls();
  setConnection(null, "loading");
  try {
    // Save immediately; simulated ping affects only the visual acknowledgement.
    const data = await localGame.change(() => localGame.increment());
    if (generation !== clickGeneration) return;
    renderCounters(data);
    showError("#game-error", "");
    window.setTimeout(() => {
      if (generation !== clickGeneration) return;
      feedback.success(simulated);
      setConnection(simulated);
    }, simulated);
  } catch (caught) {
    const error = requestError(caught);
    if (generation !== clickGeneration) return;
    feedback.fail(false);
    setConnection(null, "error");
    showError(
      "#game-error",
      `Your local click wasn’t saved. Browser storage may be full or unavailable. ${error.message}`,
      true,
    );
  } finally {
    if (generation === clickGeneration) {
      pendingClicks--;
      updateGameControls();
    }
  }
}
async function replaceLocalSave(operation: () => Counters | Promise<Counters>, message: string) {
  if (!$<HTMLInputElement>("#replace-local").checked) {
    optionsNotice("Check “Allow replacing my local save” first.", true);
    return;
  }
  if (pendingClicks > 0) {
    optionsNotice("Wait for pending clicks to finish, then try again.", true);
    return;
  }
  try {
    const data = await localGame.change(operation);
    $<HTMLInputElement>("#replace-local").checked = false;
    if (localMode) {
      resetClickState();
      openLocalGame(data);
    }
    updateOptions();
    optionsNotice(message);
  } catch (caught) {
    const error = requestError(caught);
    optionsNotice(`Local save was not replaced. ${error.message}`, true);
  }
}
$<HTMLButtonElement>("#restart-local").addEventListener("click", () =>
  replaceLocalSave(() => localGame.replace({}), "Local save restarted."),
);
$<HTMLButtonElement>("#copy-online-local").addEventListener("click", () => {
  if (!lastOnlineCounters) return;
  const snapshot = lastOnlineCounters;
  replaceLocalSave(
    () => localGame.replace(snapshot),
    "Account progress copied to the local save. Account progress is unchanged.",
  );
});
$<HTMLInputElement>("#import-local").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 1024 * 1024) {
    optionsNotice("Choose a local save smaller than 1 MiB.", true);
    return;
  }
  try {
    const data = localGame.decode(await file.text());
    await replaceLocalSave(() => localGame.replace(data), "Local save imported.");
  } catch (caught) {
    const error = requestError(caught);
    optionsNotice(`Couldn’t import this local save. ${error.message}`, true);
  }
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
    optionsNotice("Local save downloaded.");
  } catch (caught) {
    const error = requestError(caught);
    optionsNotice(`Couldn’t download the local save. ${error.message}`, true);
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === localGame.key && localMode && pendingClicks === 0) openLocalGame();
});

boot();

export { show, setUser, openGame, refreshGame, startLocalGame };
