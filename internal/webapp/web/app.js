"use strict";

const views = {
  home: document.querySelector("#home-view"),
  auth: document.querySelector("#auth-view"),
  game: document.querySelector("#game-view"),
};
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const clickButton = document.querySelector("#click-button");
let user = null;

function show(view) {
  const authenticated = view === "game";
  views.home.hidden = view !== "home";
  views.auth.hidden = view !== "login" && view !== "signup";
  views.game.hidden = !authenticated;
  loginForm.hidden = view !== "login";
  signupForm.hidden = view !== "signup";
  document.querySelector("#guest-nav").hidden = authenticated;
  document.querySelector("#user-nav").hidden = !authenticated;
  if (view === "login") document.querySelector("#login-identifier").focus();
  if (view === "signup") document.querySelector("#signup-username").focus();
}

function showError(id, message) {
  const element = document.querySelector(id);
  element.textContent = message;
  element.hidden = !message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    ...options,
  });
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
  user = nextUser;
  if (!user) return;
  document.querySelector("#nav-username").textContent = user.username;
  document.querySelector("#game-username").textContent = user.username;
}

function renderCounters(data) {
  const clicks = data.click_count;
  document.querySelector("#click-count").textContent = clicks?.count ?? 0;
  document.querySelector("#day-streak").textContent = data.streak_counter_day?.count ?? 0;
  document.querySelector("#month-streak").textContent = data.streak_counter_month?.count ?? 0;
  document.querySelector("#year-streak").textContent = data.streak_counter_year?.count ?? 0;
  document.querySelector("#last-click").textContent = clicks?.modified_time
    ? `Last click ${new Date(clicks.modified_time).toLocaleString()}`
    : "No clicks yet. You know what to do.";
}

async function openGame() {
  show("game");
  try {
    renderCounters(await api("/api/clicks"));
  } catch (error) {
    if (error.status === 401) {
      setUser(null);
      show("login");
    } else {
      showError("#game-error", error.message);
    }
  }
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "home" && user) openGame();
    else show(view);
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("#login-error", "");
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
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
    showError("#login-error", error.message);
  } finally {
    button.disabled = false;
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("#signup-error", "");
  const form = new FormData(signupForm);
  if (form.get("password") !== form.get("password_confirmation")) {
    showError("#signup-error", "Passwords do not match");
    return;
  }
  const button = signupForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const result = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    signupForm.reset();
    setUser(result.user);
    await openGame();
  } catch (error) {
    showError("#signup-error", error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "DELETE" });
  } catch (_) {
    // Clear the local view even if the server is temporarily unavailable.
  }
  setUser(null);
  show("home");
});

clickButton.addEventListener("click", async () => {
  if (clickButton.disabled) return;
  showError("#game-error", "");
  clickButton.disabled = true;
  clickButton.classList.remove("clicked");
  void clickButton.offsetWidth;
  clickButton.classList.add("clicked");
  const started = performance.now();
  try {
    renderCounters(await api("/api/clicks", { method: "POST" }));
    document.querySelector("#ping").textContent = `${Math.round(performance.now() - started)} ms`;
  } catch (error) {
    showError("#game-error", error.status === 429 && error.retryAfter
      ? `Slow down for ${error.retryAfter} seconds.`
      : error.message);
  } finally {
    clickButton.disabled = false;
  }
});

async function boot() {
  try {
    setUser(await api("/api/me"));
    await openGame();
  } catch (_) {
    show("home");
  }
}

boot();
