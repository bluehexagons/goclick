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
const numberAnimations = new WeakMap();
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

function setConnection(message, state = "") {
  document.querySelector("#ping").textContent = message;
  connection.classList.toggle("is-loading", state === "loading");
  connection.classList.toggle("is-error", state === "error");
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
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(Array.isArray(data.errors) ? data.errors.join(". ") : (data.error || "Something went wrong"));
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    throw error;
  }
  return data;
}

function setUser(nextUser) {
  const identityChanged = user?.id !== nextUser?.id;
  user = nextUser;
  document.querySelector("#nav-username").textContent = user?.username ?? "";
  document.querySelector("#game-username").textContent = user?.username ?? "";
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
  tactileButtons.get(clickButton).reset();
  clickButton.disabled = !gameReady;
}

function updatePendingIndicator() {
  pendingIndicator.hidden = pendingClicks === 0;
  pendingIndicator.textContent = pendingClicks ? `+${pendingClicks} saving` : "";
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
  document.querySelector("#button-hint").textContent = event.detail === "held" ? "Aaand… let go." : event.detail === "pressed" ? "Got it. Hold a little…" : "Push, hold, let go.";
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
    : "No clicks yet.";
}

async function openGame(initialCounters) {
  const greetings = ["Welcome back!", "Hi again!", "Thanks for coming by."];
  document.querySelector("#game-greeting").textContent = greetings[Math.floor(Math.random() ** 2 * greetings.length)];
  const generation = clickGeneration;
  show("game");
  showError("#game-error", "");
  retryGameButton.hidden = true;
  gameReady = false;
  clickButton.disabled = true;
  counterCard.setAttribute("aria-busy", "true");
  setConnection("Loading…", "loading");
  try {
    const data = await (initialCounters ?? api("/api/clicks"));
    if (generation !== clickGeneration) return;
    renderCounters(data, true);
    gameReady = true;
    clickButton.disabled = false;
    setConnection("Ready");
  } catch (error) {
    if (generation !== clickGeneration) return;
    if (error.status === 401) {
      if (user && !signingOut) handleExpiredSession();
    } else {
      showError("#game-error", `Couldn’t load your counter. ${error.message}`, true);
      retryGameButton.hidden = false;
      setConnection("Not connected", "error");
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
  setConnection(pendingClicks === 1 ? "Saving click…" : `Saving ${pendingClicks} clicks…`, "loading");
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
      : `Your click wasn’t saved. ${error.message}`, true);
    setConnection("Not saved", "error");
  } finally {
    if (generation !== clickGeneration) return;
    pendingClicks--;
    updatePendingIndicator();
    clickButton.disabled = !gameReady || pendingClicks >= maxPendingClicks;
    if (!clickBatchFailed && pendingClicks > 0) {
      setConnection(pendingClicks === 1 ? "Saving click…" : `Saving ${pendingClicks} clicks…`, "loading");
    } else if (!clickBatchFailed && saved) {
      setConnection(`Saved · ${Math.round(performance.now() - started)} ms`);
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
