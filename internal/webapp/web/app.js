"use strict";

const views = {
  loading: document.querySelector("#loading-view"),
  home: document.querySelector("#home-view"),
  auth: document.querySelector("#auth-view"),
  game: document.querySelector("#game-view"),
};
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const clickButton = document.querySelector("#click-button");
const counterCard = document.querySelector("#counter-card");
const retryGameButton = document.querySelector("#retry-game-button");
const retryBootButton = document.querySelector("#retry-boot-button");
const refreshCounterButton = document.querySelector("#refresh-counter");
const connection = document.querySelector("#connection");
const pendingIndicator = document.querySelector("#pending-clicks");
let currentView = "", viewAnimation = null;
let pingStateTimer = 0, pendingIndicatorTimer = 0;
const numberAnimations = new WeakMap();
motionPreference.addEventListener("change", () => {
  if (!motionPreference.matches) return;
  viewAnimation?.cancel();
  for (const id of ["click-count", "day-streak", "month-streak", "year-streak"]) numberAnimations.get(document.querySelector(`#${id}`))?.cancel();
});
let user = null;
let localMode = gameSettings.mode() === "local";
let lastOnlineCounters = null;
let gameReady = false;
let pendingClicks = 0;
let clickBatchFailed = false;
let signingOut = false;
let clickGeneration = 0;
let counterLoad = null;
let refreshQueued = false;
let offline = navigator.onLine === false;
let lastCounterSync = -Infinity;
const maxPendingClicks = 6;

function show(view) {
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
  document.querySelector("#guest-nav").hidden = authenticated || view === "loading";
  document.querySelector("#user-nav").hidden = !authenticated || localMode;
  document.querySelector("#local-nav").hidden = !authenticated || !localMode;
  if (changed && view !== "loading" && !motionPreference.matches) {
    const incoming = view === "login" ? loginForm : view === "signup" ? signupForm : views[view];
    viewAnimation = incoming.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  if (view === "login") {
    showError("#login-error", "");
    resetPasswordVisibility(loginForm);
    document.querySelector("#login-identifier").focus();
  }
  if (view === "signup") {
    showError("#signup-error", "");
    resetPasswordVisibility(signupForm);
    document.querySelector("#signup-username").focus();
  }
}

function showError(id, message, focus = false) {
  const element = document.querySelector(id);
  element.textContent = message;
  element.hidden = !message;
  if (message && focus) element.focus();
}

function setConnection(milliseconds = null, state = "") {
  window.clearTimeout(pingStateTimer);
  if (Number.isFinite(milliseconds) && milliseconds !== null) document.querySelector("#ping").textContent = `${Math.round(milliseconds)} ms`;
  const paintState = () => {
    connection.classList.toggle("is-loading", state === "loading" && (!offline || localMode));
    connection.classList.toggle("is-error", state === "error" || (offline && !localMode));
    const status = offline && !localMode ? "Offline. Clicking paused" : state === "loading" ? "Request in progress" : state === "error" ? "Last request failed" : "No requests pending";
    connection.setAttribute("aria-label", `Ping ${document.querySelector("#ping").textContent}. ${status}.`);
  };
  // Keep the last measurement visible. Brief gaps between clicks should not
  // flash the indicator back to idle or shift the badge's width.
  if (!state && connection.classList.contains("is-loading")) pingStateTimer = window.setTimeout(paintState, 220);
  else paintState();
}

function setSubmitting(form, submitting) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = submitting;
  button.textContent = submitting ? button.dataset.busyLabel : button.dataset.label;
  form.setAttribute("aria-busy", String(submitting));
}

function resetPasswordVisibility(container) {
  container.querySelectorAll("[data-toggle-password]").forEach((button) => {
    const input = document.querySelector(`#${button.dataset.togglePassword}`);
    input.type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-label", "Show password");
  });
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      ...options,
    });
  } catch (_) {
    const error = new Error("Can’t reach Go Click. Check your connection and try again.");
    error.status = 0;
    error.uncertain = true;
    throw error;
  }
  let data;
  try {
    data = await response.json();
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new TypeError("Expected a JSON object");
  } catch (_) {
    if (response.ok) {
      const error = new Error("Couldn’t read the server’s response.");
      error.status = response.status;
      error.uncertain = true;
      throw error;
    }
    data = {};
  }
  if (!response.ok) {
    const error = new Error(Array.isArray(data.errors) ? data.errors.join(". ") : (data.error || "Something went wrong"));
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    error.uncertain = response.status >= 500;
    throw error;
  }
  return data;
}

function setUser(nextUser) {
  const identityChanged = user?.id !== nextUser?.id;
  user = nextUser;
  if (identityChanged) lastOnlineCounters = null;
  document.querySelector("#nav-username").textContent = user?.username ?? "";
  document.querySelector("#game-username").textContent = user?.username ?? "";
  document.querySelector("#game-player-id").textContent = user ? `#${user.id}` : "";
  document.querySelector("#admin-link").hidden = !user?.admin;
  if (identityChanged) {
    resetClickState();
    renderCounters({}, true);
  }
}

function resetClickState() {
  clickGeneration++;
  pendingClicks = 0;
  updatePendingIndicator();
  clickBatchFailed = false;
  refreshQueued = false;
  window.clearTimeout(pingStateTimer);
  document.querySelector("#ping").textContent = "— ms";
  connection.classList.remove("is-loading", "is-error");
  connection.setAttribute("aria-label", "Ping: no click measured yet");
  tactileButtons.get(clickButton).reset();
  clickFeedback.reset();
  updateGameControls();
}

function updateGameControls() {
  clickButton.disabled = !gameReady || (offline && !localMode) || signingOut || (!localMode && pendingClicks >= maxPendingClicks);
  // Keep a focused refresh control in the tab order while its read is in flight.
  // Repeated activations share counterLoad instead of starting another request.
  refreshCounterButton.disabled = (offline && !localMode) || signingOut || pendingClicks > 0;
  refreshCounterButton.setAttribute("aria-disabled", String(refreshCounterButton.disabled || !!counterLoad));
  refreshCounterButton.setAttribute("aria-busy", String(!!counterLoad));
  document.querySelector("#network-notice").hidden = !offline || localMode;
  document.querySelector("#local-mode-note").hidden = !localMode;
  document.querySelector("#counter-label").textContent = localMode ? "Local clicks" : "Saved clicks";
  document.querySelector(".connection-label").textContent = localMode ? "Sim ping" : "Ping";
  document.querySelectorAll("[data-play-local]").forEach(button => { button.hidden = localMode; button.disabled = pendingClicks > 0 || signingOut; });
  document.querySelector("#leave-local").disabled = pendingClicks > 0;
  document.querySelector("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0;
  if (localMode) {
    document.querySelector("#game-username").textContent = "Offline play";
    document.querySelector("#game-player-id").textContent = "this browser";
  }
}

function updatePendingIndicator() {
  if (pendingClicks === 0) {
    window.clearTimeout(pendingIndicatorTimer); pendingIndicatorTimer = 0;
    pendingIndicator.hidden = true; pendingIndicator.textContent = ""; return;
  }
  pendingIndicator.textContent = `+${pendingClicks} pending`;
  if (pendingIndicator.hidden && !pendingIndicatorTimer) pendingIndicatorTimer = window.setTimeout(() => {
    pendingIndicatorTimer = 0; pendingIndicator.hidden = pendingClicks === 0;
  }, 180);
}

function animateNumber(element) {
  if (motionPreference.matches) return;
  numberAnimations.get(element)?.cancel();
  numberAnimations.set(element, element.animate([{ transform: "scale(1)", color: "var(--ink)" }, { transform: "scale(1.08)", color: "var(--gold)", offset: .25 }, { transform: "scale(1)", color: "var(--ink)" }], { duration: 240, easing: "cubic-bezier(.2,.75,.3,1)" }));
}

function renderCounters(data, allowDecrease = false) {
  const clicks = data.click_count;
  const displayedClicks = Number(document.querySelector("#click-count").textContent);
  if (!allowDecrease && clicks && Number.isFinite(displayedClicks) && clicks.count < displayedClicks) return;
  for (const [id, count] of [["click-count", clicks?.count ?? 0], ["day-streak", data.streak_counter_day?.count ?? 0], ["month-streak", data.streak_counter_month?.count ?? 0], ["year-streak", data.streak_counter_year?.count ?? 0]]) {
    const element = document.querySelector(`#${id}`), changed = element.textContent !== String(count);
    element.textContent = count;
    if (changed && !allowDecrease) animateNumber(element);
  }
  document.querySelector("#last-click").textContent = clicks?.modified_time
    ? `Last click ${new Date(clicks.modified_time).toLocaleString()}`
    : "No saved clicks yet.";
}

function openGame(initialCounters, verifyIdentity = false) {
  if (localMode) { openLocalGame(); return Promise.resolve(); }
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
  counterLoad = (async () => {
    try {
      // Check identity as well as counters: another tab may have switched accounts.
      const [nextUser, data] = verifyIdentity
        ? await Promise.all([api("/api/me"), api("/api/clicks")])
        : [user, await (initialCounters ?? api("/api/clicks"))];
      if (generation !== clickGeneration) return;
      if (verifyIdentity) {
        setUser(nextUser);
        generation = clickGeneration;
      }
      lastOnlineCounters = data;
      renderCounters(data, true);
      lastCounterSync = performance.now();
      gameReady = true;
      updateGameControls();
      if (focusButton && !clickButton.disabled) clickButton.focus();
      setConnection();
    } catch (error) {
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
      counterLoad = null;
      updateGameControls();
    }
  })();
  updateGameControls();
  return counterLoad;
}

function refreshGame() {
  if (localMode) { if (currentView === "game") openLocalGame(); return; }
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
document.addEventListener("visibilitychange", () => { if (!document.hidden) resumeGame(); });
window.addEventListener("focus", resumeGame);
window.addEventListener("pageshow", (event) => { if (event.persisted) refreshGame(); });

function handleExpiredSession() {
  gameReady = false;
  setUser(null);
  show("login");
  showError("#login-error", "Your session expired. Sign in to keep clicking.", true);
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "home" && user) openGame();
    else show(view);
  });
});

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.togglePassword}`);
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
  try {
    const form = new FormData(loginForm);
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    loginForm.reset();
    setUser(result.user);
    await openGame();
  } catch (error) {
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
    document.querySelector("#signup-password-confirmation").focus();
    return;
  }
  setSubmitting(signupForm, true);
  try {
    const result = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    signupForm.reset();
    setUser(result.user);
    await openGame();
  } catch (error) {
    showError("#signup-error", error.message, true);
  } finally {
    setSubmitting(signupForm, false);
  }
});

const logoutButton = document.querySelector("#logout-button");
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
  } catch (error) {
    gameReady = true;
    showError("#game-error", `Could not sign out: ${error.message}`, true);
  } finally {
    signingOut = false;
    logoutButton.disabled = false;
    updateGameControls();
  }
});

clickButton.addEventListener("click", async event => {
  if (localMode) { await clickLocal(event); return; }
  if (!gameReady || (offline && !localMode) || signingOut || (!localMode && pendingClicks >= maxPendingClicks)) return;
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
    const data = await api("/api/clicks", { method: "POST" });
    if (generation !== clickGeneration) return;
    renderCounters(data);
    if ((data.click_count?.count ?? 0) >= (lastOnlineCounters?.click_count?.count ?? 0)) lastOnlineCounters = data;
    feedback.success(performance.now() - started);
    saved = true;
  } catch (error) {
    if (generation !== clickGeneration) return;
    feedback.fail(error.uncertain);
    if (error.status === 401) {
      if (user && !signingOut) handleExpiredSession();
      return;
    }
    clickBatchFailed = true;
    showError("#game-error", error.status === 429 && error.retryAfter
      ? `Slow down for ${error.retryAfter} seconds.`
      : error.uncertain
        ? `Couldn’t confirm your click. Reload your counter to check whether it saved. ${error.message}`
        : `Your click wasn’t saved. ${error.message}`, true);
    if (error.uncertain) retryGameButton.hidden = false;
    setConnection(null, "error");
  } finally {
    if (generation !== clickGeneration) return;
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
});

async function boot() {
  if (localMode) { openLocalGame(); return; }
  const generation = clickGeneration;
  show("loading");
  views.loading.setAttribute("aria-busy", "true");
  document.querySelector(".loading-spinner").hidden = false;
  document.querySelector("#loading-message").textContent = "Loading your counter…";
  retryBootButton.hidden = true;
  try {
    // Start both reads together, but let identity decide whether to show the
    // game. Observe the counter rejection even if checking identity fails.
    const counters = api("/api/clicks");
    counters.catch(() => {});
    const identity = await api("/api/me");
    if (generation !== clickGeneration || localMode) return;
    setUser(identity);
    await openGame(counters);
  } catch (error) {
    if (generation !== clickGeneration || localMode) return;
    if (error.status === 401) {
      show("home");
      return;
    }
    document.querySelector(".loading-spinner").hidden = true;
    document.querySelector("#loading-message").textContent = error.message;
    retryBootButton.hidden = false;
    views.loading.setAttribute("aria-busy", "false");
    retryBootButton.focus();
  }
}

retryGameButton.addEventListener("click", refreshGame);
refreshCounterButton.addEventListener("click", refreshGame);
retryBootButton.addEventListener("click", () => boot());

const optionsDialog = document.querySelector("#options-dialog");
function optionsNotice(message, error = false) {
  const notice = document.querySelector("#options-status");
  notice.textContent = message; notice.hidden = !message; notice.classList.toggle("notice-error", error);
}
function updateOptions() {
  document.querySelector("#motion-setting").value = gameSettings.value.motion;
  document.querySelector("#simulated-ping").value = String(gameSettings.value.simulatedPing);
  document.querySelector("#copy-online-local").disabled = !lastOnlineCounters || pendingClicks > 0;
  document.querySelector("#copy-online-note").textContent = lastOnlineCounters
    ? `Copy the last loaded account progress for ${user?.username ?? "your account"}. This only replaces the local save.`
    : "Open your account counter first to make a copy. Copying only replaces the local save.";
  try {
    const data = localGame.read();
    document.querySelector("#local-save-summary").textContent = `${data.click_count?.count ?? 0} clicks saved in this browser.`;
  } catch (error) { document.querySelector("#local-save-summary").textContent = `Local save unavailable. ${error.message}`; }
}
document.querySelector("#options-button").addEventListener("click", () => {
  optionsNotice(""); document.querySelector("#replace-local").checked = false;
  updateOptions(); optionsDialog.showModal();
});
document.querySelector("#close-options").addEventListener("click", () => optionsDialog.close());
for (const [selector, key, convert] of [["#motion-setting", "motion", String], ["#simulated-ping", "simulatedPing", Number]]) {
  document.querySelector(selector).addEventListener("change", event => {
    try { gameSettings.update({ [key]: convert(event.target.value) }); optionsNotice("Option saved."); }
    catch (_) { optionsNotice("Applied for this visit. Browser storage is unavailable, so this option could not be remembered.", true); }
  });
}
function openLocalGame(data) {
  show("game"); showError("#game-error", ""); retryGameButton.hidden = true;
  try {
    renderCounters(data ?? localGame.read(), true); gameReady = true;
    counterCard.setAttribute("aria-busy", "false"); updateGameControls(); setConnection();
  } catch (error) {
    gameReady = false; updateGameControls();
    showError("#game-error", `Couldn’t load your local save. ${error.message} Open Options to import a copy or restart the local save.`, true);
  }
}
function startLocalGame() {
  if (pendingClicks > 0 || signingOut) return;
  try {
    const data = localGame.read();
    gameSettings.setMode("local"); localMode = true; gameReady = false; resetClickState();
    optionsDialog.close(); openLocalGame(data); clickButton.focus();
  } catch (error) {
    optionsNotice(`Couldn’t open the local save. ${error.message}`, true);
    if (!optionsDialog.open) { updateOptions(); optionsDialog.showModal(); }
  }
}
document.querySelectorAll("[data-play-local]").forEach(button => button.addEventListener("click", startLocalGame));
document.querySelector("#leave-local").addEventListener("click", () => {
  if (pendingClicks > 0) return;
  try { gameSettings.setMode("online"); }
  catch (_) { showError("#game-error", "Browser storage is unavailable. Couldn’t remember the mode change.", true); return; }
  localMode = false; gameReady = false; resetClickState(); boot();
});
async function clickLocal(event) {
  if (!gameReady) return;
  const feedback = clickFeedback.start(clickButton, event, true), generation = clickGeneration;
  const base = gameSettings.value.simulatedPing;
  const simulated = Math.round(base * (.7 + Math.random() * .6));
  pendingClicks++; updateGameControls();
  setConnection(null, "loading");
  try {
    // Save immediately; simulated ping affects only the visual acknowledgement.
    const data = await localGame.change(() => localGame.increment());
    if (generation !== clickGeneration) return;
    renderCounters(data); showError("#game-error", "");
    window.setTimeout(() => {
      if (generation !== clickGeneration) return;
      feedback.success(simulated); setConnection(simulated);
    }, simulated);
  } catch (error) {
    if (generation !== clickGeneration) return;
    feedback.fail(false); setConnection(null, "error");
    showError("#game-error", `Your local click wasn’t saved. Browser storage may be full or unavailable. ${error.message}`, true);
  } finally {
    if (generation === clickGeneration) { pendingClicks--; updateGameControls(); }
  }
}
async function replaceLocalSave(operation, message) {
  if (!document.querySelector("#replace-local").checked) { optionsNotice("Check “Allow replacing my local save” first.", true); return; }
  if (pendingClicks > 0) { optionsNotice("Wait for pending clicks to finish, then try again.", true); return; }
  try {
    const data = await localGame.change(operation);
    document.querySelector("#replace-local").checked = false;
    if (localMode) { resetClickState(); openLocalGame(data); }
    updateOptions(); optionsNotice(message);
  } catch (error) { optionsNotice(`Local save was not replaced. ${error.message}`, true); }
}
document.querySelector("#restart-local").addEventListener("click", () => replaceLocalSave(() => localGame.replace({}), "Local save restarted."));
document.querySelector("#copy-online-local").addEventListener("click", () => {
  if (!lastOnlineCounters) return;
  const snapshot = lastOnlineCounters;
  replaceLocalSave(() => localGame.replace(snapshot), "Account progress copied to the local save. Account progress is unchanged.");
});
document.querySelector("#import-local").addEventListener("change", async event => {
  const file = event.target.files[0]; event.target.value = "";
  if (!file) return;
  if (file.size > 1024 * 1024) { optionsNotice("Choose a local save smaller than 1 MiB.", true); return; }
  try {
    const data = localGame.decode(await file.text());
    await replaceLocalSave(() => localGame.replace(data), "Local save imported.");
  } catch (error) { optionsNotice(`Couldn’t import this local save. ${error.message}`, true); }
});
document.querySelector("#download-local").addEventListener("click", async () => {
  try {
    const saved = await localGame.change(() => localGame.encode(localGame.read()));
    const url = URL.createObjectURL(new Blob([saved], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "goclick-local.json";
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    optionsNotice("Local save downloaded.");
  } catch (error) { optionsNotice(`Couldn’t download the local save. ${error.message}`, true); }
});
window.addEventListener("storage", event => {
  if (event.key === localGame.key && localMode && pendingClicks === 0) openLocalGame();
});

boot();
