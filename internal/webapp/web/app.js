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
const connection = document.querySelector("#connection");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const pendingIndicator = document.querySelector("#pending-clicks");
let currentView = "", viewAnimation = null, impactAnimation = null;
let pingStateTimer = 0, pendingIndicatorTimer = 0;
const numberAnimations = new WeakMap();
motionPreference.addEventListener("change", () => {
  if (!motionPreference.matches) return;
  viewAnimation?.cancel(); impactAnimation?.cancel();
  for (const id of ["click-count", "day-streak", "month-streak", "year-streak"]) numberAnimations.get(document.querySelector(`#${id}`))?.cancel();
});
let user = null;
let gameReady = false;
let pendingClicks = 0;
let clickBatchFailed = false;
let signingOut = false;
let clickGeneration = 0;
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
  document.querySelector("#user-nav").hidden = !authenticated;
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
    connection.classList.toggle("is-loading", state === "loading");
    connection.classList.toggle("is-error", state === "error");
    const status = state === "loading" ? "Saving clicks" : state === "error" ? "Last request failed" : "No requests pending";
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
  window.clearTimeout(pingStateTimer);
  document.querySelector("#ping").textContent = "— ms";
  connection.classList.remove("is-loading", "is-error");
  connection.setAttribute("aria-label", "Ping: no click measured yet");
  tactileButtons.get(clickButton).reset();
  clickButton.disabled = !gameReady;
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

function celebrateClick() {
  if (motionPreference.matches) return;
  const bonus = document.createElement("span"); bonus.className = "click-bonus"; bonus.textContent = "+1";
  const effects = clickButton.closest(".button-stage").querySelector(".button-effects"); effects.append(bonus);
  bonus.animate([{ opacity: 0, transform: "translate(-50%, 5px) scale(.6)" }, { opacity: 1, transform: "translate(-50%, -5px) scale(1)", offset: .2 }, { opacity: 0, transform: "translate(-50%, -30px) scale(.9)" }], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(() => bonus.remove(), () => bonus.remove());
  impactAnimation?.cancel();
  impactAnimation = counterCard.animate([{ boxShadow: "0 0 0 0 #ffc83d00" }, { boxShadow: "0 0 28px -9px #ffc83d66", offset: .2 }, { boxShadow: "0 0 0 0 #ffc83d00" }], { duration: 300 });
}

clickButton.addEventListener("buttonstate", (event) => {
  document.querySelector("#button-hint").textContent = event.detail === "idle" ? "Mouse, touch, Space or Enter · one click per release." : "Held · release inside the button to add one click.";
});

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

async function openGame(initialCounters) {
  const generation = clickGeneration;
  show("game");
  showError("#game-error", "");
  retryGameButton.hidden = true;
  gameReady = false;
  clickButton.disabled = true;
  counterCard.setAttribute("aria-busy", "true");
  setConnection(null, "loading");
  try {
    const data = await (initialCounters ?? api("/api/clicks"));
    if (generation !== clickGeneration) return;
    renderCounters(data, true);
    gameReady = true;
    clickButton.disabled = false;
    setConnection();
  } catch (error) {
    if (generation !== clickGeneration) return;
    if (error.status === 401) {
      if (user && !signingOut) handleExpiredSession();
    } else {
      showError("#game-error", `Couldn’t load your counter. ${error.message}`, true);
      retryGameButton.hidden = false;
      setConnection(null, "error");
    }
  } finally {
    if (generation === clickGeneration) counterCard.setAttribute("aria-busy", "false");
  }
}

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
  clickButton.disabled = true;
  logoutButton.disabled = true;
  try {
    await api("/api/auth/logout", { method: "DELETE" });
    setUser(null);
    show("home");
  } catch (error) {
    gameReady = true;
    clickButton.disabled = pendingClicks >= maxPendingClicks;
    showError("#game-error", `Could not sign out: ${error.message}`, true);
  } finally {
    signingOut = false;
    logoutButton.disabled = false;
  }
});

clickButton.addEventListener("click", async () => {
  if (!gameReady || pendingClicks >= maxPendingClicks) return;
  if (pendingClicks === 0) {
    showError("#game-error", "");
    clickBatchFailed = false;
  }
  pendingClicks++;
  updatePendingIndicator();
  celebrateClick();
  clickButton.disabled = pendingClicks >= maxPendingClicks;
  const started = performance.now();
  const generation = clickGeneration;
  setConnection(null, "loading");
  let saved = false;
  try {
    const data = await api("/api/clicks", { method: "POST" });
    if (generation !== clickGeneration) return;
    renderCounters(data);
    saved = true;
  } catch (error) {
    if (generation !== clickGeneration) return;
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
    clickButton.disabled = !gameReady || pendingClicks >= maxPendingClicks;
    if (!clickBatchFailed && pendingClicks > 0) {
      setConnection(null, "loading");
    } else if (!clickBatchFailed && saved) {
      setConnection(performance.now() - started);
    }
  }
});

async function boot() {
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
    setUser(await api("/api/me"));
    await openGame(counters);
  } catch (error) {
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

retryGameButton.addEventListener("click", () => openGame());
retryBootButton.addEventListener("click", () => boot());

boot();
