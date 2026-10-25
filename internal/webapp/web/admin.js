// Generated from frontend/*.ts by npm run build. Do not edit directly.
"use strict";
(() => {
  // frontend/focus.ts
  var root = document.documentElement;
  root.dataset.focusInput = "pointer";
  var navigationKeys = /* @__PURE__ */ new Set([
    "Tab",
    "Enter",
    " ",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Escape"
  ]);
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (navigationKeys.has(event.key)) root.dataset.focusInput = "keyboard";
    },
    { capture: true }
  );
  document.addEventListener(
    "pointerdown",
    () => {
      root.dataset.focusInput = "pointer";
    },
    { capture: true, passive: true }
  );

  // frontend/interaction.ts
  document.addEventListener(
    "dragstart",
    (event) => {
      const target = event.target;
      const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      const editor = element?.closest("input, textarea, [contenteditable]");
      if (editor?.isContentEditable) return;
      if (editor?.matches("input:not([type=file]), textarea")) {
        const field = editor;
        if (!field.disabled && !field.readOnly) return;
      }
      event.preventDefault();
    },
    { capture: true }
  );

  // frontend/dom.ts
  function required(selector, root2 = document) {
    const element = root2.querySelector(selector);
    if (!element) throw new Error(`Required element missing: ${selector}`);
    return element;
  }
  function message(error) {
    return error instanceof Error ? error.message : "Something went wrong. Try again.";
  }
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // frontend/http.ts
  var RequestError = class extends Error {
    status = 0;
    uncertain = false;
    retryAfter = null;
    code;
  };
  function requestError(error) {
    return error instanceof RequestError ? error : new RequestError(message(error));
  }
  async function request(url, options = {}, binary = false) {
    const { timeoutMilliseconds = 3e4, signal, ...init } = options;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMilliseconds);
    try {
      return await readResponse(url, { ...init, signal: controller.signal }, binary);
    } catch (caught) {
      if (timedOut) {
        const cause = requestError(caught);
        const error = new RequestError("The server took too long to respond. Check your connection.");
        error.status = cause.status;
        error.code = cause.code;
        error.retryAfter = cause.retryAfter;
        error.uncertain = cause.status < 400 || cause.uncertain;
        throw error;
      }
      throw caught;
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async function readResponse(url, options, binary) {
    let response;
    try {
      response = await fetch(url, { credentials: "same-origin", ...options });
    } catch {
      const error = new RequestError("Can\u2019t reach Go Click. Check your connection and try again.");
      error.uncertain = true;
      throw error;
    }
    let data;
    try {
      if (response.ok && binary) return await response.blob();
      data = await response.json();
      if (!isRecord(data)) throw new TypeError("Expected a JSON object");
    } catch {
      if (response.ok) {
        const error = new RequestError("Couldn\u2019t read the server\u2019s response.");
        error.status = response.status;
        error.uncertain = true;
        throw error;
      }
      data = {};
    }
    if (!isRecord(data)) throw new TypeError("Expected a JSON object");
    if (!response.ok) {
      const text = Array.isArray(data.errors) && data.errors.every((item) => typeof item === "string") ? data.errors.join(". ") : typeof data.error === "string" ? data.error : "Request failed. Try again.";
      const error = new RequestError(text);
      error.status = response.status;
      error.code = typeof data.code === "string" ? data.code : void 0;
      error.retryAfter = response.headers.get("Retry-After");
      error.uncertain = response.status >= 500 && error.code !== "authentication_busy";
      throw error;
    }
    return data;
  }
  function jsonOptions(body) {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    };
  }

  // frontend/timestamp.ts
  function parseStoredTimestamp(value) {
    const parts = value.match(
      /^(?<day>\d{4}-\d{2}-\d{2})(?<separator>T| +)(?<hour>\d{1,2}):(?<minute>\d{2}):(?<second>\d{2})(?:[.,](?<fraction>\d+))?(?<zone>Z|[+-]\d{2}:\d{2})?$/
    )?.groups;
    if (!parts || parts.separator === "T" !== Boolean(parts.zone)) return /* @__PURE__ */ new Date(NaN);
    const normalized = `${parts.day}T${parts.hour?.padStart(2, "0")}:${parts.minute}:${parts.second}.${(parts.fraction ?? "").padEnd(3, "0").slice(0, 3)}Z`;
    const instant = new Date(normalized);
    if (Number.isNaN(instant.getTime()) || instant.toISOString() !== normalized) return /* @__PURE__ */ new Date(NaN);
    let offset = 0;
    if (parts.zone && parts.zone !== "Z") {
      const hours = Number(parts.zone.slice(1, 3));
      const minutes = Number(parts.zone.slice(4, 6));
      if (hours > 24 || minutes > 60) return /* @__PURE__ */ new Date(NaN);
      offset = (hours * 60 + minutes) * 6e4 * (parts.zone[0] === "+" ? 1 : -1);
    }
    return new Date(instant.getTime() - offset);
  }

  // frontend/admin.ts
  var number = (value) => new Intl.NumberFormat().format(value ?? 0);
  var date = (value) => value ? parseStoredTimestamp(value).toLocaleString() : "\u2014";
  function bytes(value) {
    if (!Number.isFinite(value) || value < 0) return "Unavailable";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${new Intl.NumberFormat(void 0, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
  }
  var actionName = {
    signup: "Created account",
    sign_in: "Signed in",
    click: "Saved a click",
    admin_granted: "Admin access granted",
    admin_revoked: "Admin access revoked",
    backup_export: "Backup exported",
    backup_restore: "Backup restored",
    rails_import: "Rails players imported",
    password_set: "Password set by operator"
  };
  var tab = "overview";
  var playersPage = 1;
  var activityPage = 1;
  var auditPage = 1;
  var detailActivityPage = 1;
  var detailEntityPage = 1;
  var selectedPlayer = null;
  var detailGeneration = 0;
  var restoring = false;
  var pendingReads = /* @__PURE__ */ new Map();
  function node(tag, className = "", text = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }
  function activityIcon(action) {
    const names = { click: "click", sign_in: "key", signup: "players" };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    use.setAttribute("href", `/icons.svg#${names[action] || "activity"}`);
    svg.append(use);
    return svg;
  }
  function notice(selector, text, error = false) {
    const element = required(selector);
    element.textContent = text;
    element.hidden = !text;
    element.classList.toggle("notice-error", error);
  }
  function denyAccess() {
    required("#dashboard-body").hidden = true;
    required("#access-error").hidden = false;
    required("#player-dialog").close();
  }
  async function request2(url, options = {}, binary = false) {
    try {
      return binary ? await request(url, options, true) : await request(url, options);
    } catch (caught) {
      const error = requestError(caught);
      if (!options.signal?.aborted && (error.status === 401 || error.status === 403 && error.message === "Administrator access required"))
        denyAccess();
      if (error.status === 429 && error.retryAfter)
        error.message = `Try again in ${error.retryAfter} seconds.`;
      throw error;
    }
  }
  async function latestRead(key, url) {
    pendingReads.get(key)?.abort();
    const controller = new AbortController();
    pendingReads.set(key, controller);
    try {
      const data = await request2(url, { signal: controller.signal });
      return pendingReads.get(key) === controller ? data : null;
    } catch (caught) {
      const error = requestError(caught);
      if (pendingReads.get(key) === controller) throw error;
      return null;
    } finally {
      if (pendingReads.get(key) === controller) pendingReads.delete(key);
    }
  }
  function playerButton(player) {
    const button = node("button", "text-button", player.username);
    button.type = "button";
    button.addEventListener("click", () => openPlayer(player.id));
    return button;
  }
  function emptyRow(body, columns, message2) {
    const row = node("tr");
    const cell2 = node("td", "empty", message2);
    cell2.colSpan = columns;
    row.append(cell2);
    body.append(row);
  }
  function cell(row, value, secondary) {
    const td = node("td", "", value);
    if (secondary) td.append(node("span", "secondary", secondary));
    row.append(td);
    return td;
  }
  function pager(selector, page, total, onPage) {
    const element = required(selector);
    element.replaceChildren(
      node(
        "span",
        "",
        `${number(total)} record${total === 1 ? "" : "s"} \xB7 Page ${page} of ${Math.max(1, Math.ceil(total / 25))}`
      )
    );
    for (const [label, next, disabled] of [
      ["Previous", page - 1, page <= 1],
      ["Next", page + 1, page * 25 >= total]
    ]) {
      const button = node("button", "button button-quiet", label);
      button.type = "button";
      button.disabled = disabled;
      button.addEventListener("click", () => onPage(next).catch(report));
      element.append(button);
    }
  }
  function report(error) {
    notice("#admin-error", requestError(error).message, true);
  }
  async function loadOverview() {
    const [stats, recent] = await Promise.all([
      request2("/api/admin/overview"),
      request2("/api/admin/activity?limit=6")
    ]);
    required("#metric-players").textContent = number(stats.players);
    required("#metric-admins").textContent = `${number(stats.admins)} administrator${stats.admins === 1 ? "" : "s"}`;
    required("#metric-clicks").textContent = number(stats.clicks);
    required("#metric-active").textContent = number(stats.active_players_24h);
    required("#metric-today").textContent = number(stats.clicks_24h);
    required("#metric-sessions").textContent = `${number(stats.active_sessions)} active sessions`;
    const chart = required("#daily-chart");
    chart.replaceChildren();
    const max = Math.max(1, ...stats.daily_clicks.map((day) => day.clicks));
    for (const day of stats.daily_clicks) {
      const column = node("div", "chart-column");
      column.setAttribute("aria-label", `${day.date}: ${number(day.clicks)} clicks`);
      const track = node("div", "chart-track");
      const bar = node("div", "chart-bar");
      bar.style.height = `${day.clicks / max * 100}%`;
      if (day.clicks > 0) bar.style.minHeight = "3px";
      track.append(bar);
      column.append(
        node("span", "chart-value", number(day.clicks)),
        track,
        node("span", "chart-date", day.date.slice(5))
      );
      chart.append(column);
    }
    const feed = required("#recent-activity");
    feed.replaceChildren();
    if (!recent.items.length) feed.append(node("p", "muted", "No recorded activity yet."));
    for (const event of recent.items) {
      const item = node("div", "activity-item");
      const who = node("div", "activity-who");
      const symbol = node("span", "event-symbol");
      symbol.append(activityIcon(event.action));
      const identity = node("div");
      identity.append(
        playerButton({ id: event.user_id, username: event.username }),
        node("div", "activity-action", actionName[event.action] || event.action)
      );
      who.append(symbol, identity);
      item.append(who, node("span", "muted", date(event.occurred_at)));
      feed.append(item);
    }
  }
  async function loadPlayers() {
    const page = playersPage, query = new URLSearchParams({
      page: String(page),
      q: required("#search").value.trim(),
      sort: required("#sort").value
    });
    const data = await latestRead("players", `/api/admin/players?${query}`);
    if (!data) return;
    const body = required("#players-rows");
    body.replaceChildren();
    if (!data.items.length) emptyRow(body, 5, "No players match this search.");
    for (const player of data.items) {
      const row = node("tr");
      const identity = cell(row, "");
      identity.append(playerButton(player));
      if (player.admin) identity.append(node("span", "pill", "ADMIN"));
      identity.append(node("span", "secondary", player.email || `Player #${player.id}`));
      cell(row, number(player.clicks));
      cell(
        row,
        `${number(player.day_streak)} / ${number(player.month_streak)} / ${number(player.year_streak)}`
      );
      cell(row, date(player.last_clicked_at));
      cell(row, date(player.created_at));
      body.append(row);
    }
    pager("#players-pager", page, data.total, async (page2) => {
      playersPage = page2;
      await loadPlayers();
    });
  }
  function activityRows(selector, items, includePlayer) {
    const body = required(selector);
    body.replaceChildren();
    if (!items.length) emptyRow(body, includePlayer ? 4 : 3, "No recorded activity yet.");
    for (const event of items) {
      const row = node("tr");
      if (includePlayer)
        cell(row, "").append(playerButton({ id: event.user_id, username: event.username }));
      cell(row, actionName[event.action] || event.action);
      cell(row, event.click_count == null ? "\u2014" : number(event.click_count));
      cell(row, date(event.occurred_at));
      body.append(row);
    }
  }
  async function loadActivity() {
    const page = activityPage, query = new URLSearchParams({ page: String(page) });
    if (required("#activity-user").value)
      query.set("user_id", required("#activity-user").value);
    const data = await latestRead("activity", `/api/admin/activity?${query}`);
    if (!data) return;
    activityRows("#activity-rows", data.items, true);
    pager("#activity-pager", page, data.total, async (page2) => {
      activityPage = page2;
      await loadActivity();
    });
  }
  async function loadAudit() {
    const page = auditPage, data = await latestRead("audit", `/api/admin/audit?page=${page}`);
    if (!data) return;
    const body = required("#audit-rows");
    body.replaceChildren();
    if (!data.items.length) emptyRow(body, 4, "No administrative activity yet.");
    for (const event of data.items) {
      const row = node("tr");
      cell(row, event.actor_username);
      cell(row, actionName[event.action] || event.action);
      cell(row, event.result);
      cell(row, date(event.occurred_at));
      body.append(row);
    }
    pager("#audit-pager", page, data.total, async (page2) => {
      auditPage = page2;
      await loadAudit();
    });
  }
  async function loadStorage() {
    const data = await request2("/api/admin/storage"), snapshots = data.recovery_snapshots;
    required("#storage-database").textContent = bytes(data.database_bytes);
    required("#storage-reusable").textContent = `${bytes(data.reusable_bytes)} reusable pages`;
    required("#storage-activity").textContent = number(data.activity_records);
    required("#storage-oldest-activity").textContent = data.oldest_activity_at ? `Since ${date(data.oldest_activity_at)}` : "No recorded activity";
    required("#storage-audit").textContent = number(data.audit_records);
    required("#storage-snapshots").textContent = snapshots ? `${number(snapshots.count)} \xB7 ${bytes(snapshots.bytes)}` : "Unavailable";
    required("#storage-snapshot-detail").textContent = !snapshots ? "Couldn\u2019t read the recovery directory." : snapshots.oldest_at ? `Oldest ${date(snapshots.oldest_at)}` : "No local recovery snapshots";
    const warnings = [];
    if (!snapshots)
      warnings.push(
        "Recovery snapshot usage could not be measured. Check the server log and directory access."
      );
    if (snapshots?.oversized)
      warnings.push(
        `${number(snapshots.oversized)} local recovery snapshot${snapshots.oversized === 1 ? " exceeds" : "s exceed"} the ${bytes(data.restore_limit_bytes)} panel upload limit. Use host-side recovery for those files.`
      );
    if (data.database_bytes >= data.restore_limit_bytes * 0.8)
      warnings.push(
        `Database allocation is approaching or above the ${bytes(data.restore_limit_bytes)} panel restore limit. Check the actual exported file size; larger snapshots require host-side recovery.`
      );
    notice("#storage-warning", warnings.join(" "));
  }
  async function loadBackups() {
    await Promise.all([loadStorage(), loadAudit()]);
  }
  async function refreshAfterOperation() {
    try {
      await loadBackups();
    } catch (caught) {
      const error = requestError(caught);
      notice(
        "#admin-error",
        `Operation completed, but the dashboard could not refresh. ${error.message}`,
        true
      );
    }
  }
  async function refresh() {
    if (restoring) return;
    notice("#admin-error", "");
    required("#refresh").disabled = true;
    required("#refresh").textContent = "Refreshing\u2026";
    try {
      await {
        overview: loadOverview,
        players: loadPlayers,
        activity: loadActivity,
        backups: loadBackups
      }[tab]();
      required("#updated-at").textContent = `Updated ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
    } catch (caught) {
      const error = requestError(caught);
      report(error);
    } finally {
      required("#refresh").disabled = false;
      required("#refresh").textContent = "Refresh data";
    }
  }
  function selectTab(next) {
    if (restoring) return;
    tab = next;
    for (const button of document.querySelectorAll("[data-tab]")) {
      if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    for (const panel of document.querySelectorAll(".admin-panel"))
      panel.hidden = panel.id !== `${tab}-panel`;
    refresh();
  }
  async function detailActivity(generation) {
    const page = detailActivityPage, data = await latestRead(
      "detail-activity",
      `/api/admin/activity?user_id=${selectedPlayer}&page=${page}`
    );
    if (!data || generation !== detailGeneration) return;
    activityRows("#detail-activity", data.items, false);
    pager("#detail-activity-pager", page, data.total, async (page2) => {
      detailActivityPage = page2;
      await detailActivity(generation);
    });
  }
  async function detailEntities(generation) {
    const page = detailEntityPage, data = await latestRead(
      "detail-entities",
      `/api/admin/players/${selectedPlayer}/entities?page=${page}`
    );
    if (!data || generation !== detailGeneration) return;
    const body = required("#detail-entities");
    body.replaceChildren();
    if (!data.items.length) emptyRow(body, 4, "No archived Rails entities for this player.");
    for (const entity of data.items) {
      const row = node("tr");
      cell(
        row,
        entity.kind ?? "(null kind)",
        `Entity #${entity.id} \xB7 ${entity.source === "json" ? "JSON" : "SQLite"}`
      );
      cell(row, entity.count == null ? "null" : number(entity.count));
      cell(row, date(entity.created_time), `Record: ${date(entity.created_at)}`);
      cell(row, date(entity.modified_time), `Record: ${date(entity.updated_at)}`);
      body.append(row);
    }
    pager("#detail-entities-pager", page, data.total, async (page2) => {
      detailEntityPage = page2;
      await detailEntities(generation);
    });
  }
  async function openPlayer(id) {
    selectedPlayer = id;
    detailActivityPage = detailEntityPage = 1;
    const generation = ++detailGeneration;
    required("#detail-title").textContent = "Loading player\u2026";
    required("#detail-content").hidden = true;
    notice("#detail-error", "");
    if (!required("#player-dialog").open)
      required("#player-dialog").showModal();
    try {
      const player = await request2(`/api/admin/players/${id}`);
      if (generation !== detailGeneration) return;
      required("#detail-title").textContent = player.username;
      const profile = required("#detail-profile");
      profile.replaceChildren();
      for (const [label, value] of [
        ["Player ID", player.id],
        ["Email", player.email || "Not provided"],
        ["Role", player.admin ? "Administrator" : "Player"],
        ["Joined", date(player.created_at)],
        ["Updated", date(player.updated_at)],
        ["All-time clicks", number(player.clicks)],
        [
          "Day / month / year streak",
          `${player.day_streak} / ${player.month_streak} / ${player.year_streak}`
        ],
        ["Last click", date(player.last_clicked_at)],
        ["Last recorded sign-in", date(player.last_sign_in_at)]
      ]) {
        const entry = node("div");
        entry.append(node("dt", "", label), node("dd", "", String(value)));
        profile.append(entry);
      }
      await Promise.all([detailActivity(generation), detailEntities(generation)]);
      if (generation === detailGeneration) required("#detail-content").hidden = false;
    } catch (caught) {
      const error = requestError(caught);
      if (generation === detailGeneration) notice("#detail-error", error.message, true);
    }
  }
  function busy(form, state, label) {
    const button = required("button[type=submit]", form);
    button.disabled = state;
    button.textContent = label;
    form.setAttribute("aria-busy", String(state));
  }
  required("#export-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (restoring) return;
    const form = event.currentTarget;
    busy(form, true, "Preparing backup\u2026");
    notice("#export-status", "Creating a consistent snapshot\u2026");
    const password = required("#export-password").value;
    required("#export-password").value = "";
    try {
      const blob = await request2(
        "/api/admin/backups/export",
        {
          ...jsonOptions({ password }),
          timeoutMilliseconds: 15e4
        },
        true
      );
      const url = URL.createObjectURL(blob);
      const link = node("a");
      link.href = url;
      link.download = `goclick-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.db`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 6e4);
      notice("#export-status", "Backup ready. Keep this file in a private recovery location.");
      await refreshAfterOperation();
    } catch (caught) {
      const error = requestError(caught);
      notice("#export-status", error.message, true);
    } finally {
      busy(form, false, "Download backup");
    }
  });
  required("#restore-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (restoring) return;
    const form = event.currentTarget;
    const file = required("#restore-file").files?.[0];
    if (!file || file.size > 128 * 1024 * 1024) {
      notice("#restore-status", "Choose a Go Click SQLite backup up to 128 MiB.", true);
      return;
    }
    const data = new FormData();
    data.append("password", required("#restore-password").value);
    data.append("confirmation", required("#restore-confirmation").value);
    data.append("backup", file);
    required("#restore-password").value = "";
    restoring = true;
    busy(form, true, "Restoring\u2026");
    notice(
      "#restore-status",
      "Validating the uploaded data and saving a recovery snapshot. Leave this page open until replacement completes."
    );
    try {
      const result = await request2("/api/admin/backups/restore", {
        timeoutMilliseconds: 15e4,
        method: "POST",
        body: data
      });
      required("#dashboard-body").hidden = true;
      required("#restore-success").hidden = false;
      required("#restore-summary").textContent = `${number(result.users)} accounts and ${number(result.entities)} archived entities restored. Recovery snapshot: ${result.recovery_backup}.`;
      required("#refresh").hidden = true;
    } catch (caught) {
      const error = requestError(caught);
      notice(
        "#restore-status",
        error.message + (error.uncertain ? " Sign in again and check the audit history before retrying; the connection may have failed after replacement." : ""),
        true
      );
    } finally {
      restoring = false;
      busy(form, false, "Restore database");
    }
  });
  for (const button of document.querySelectorAll("[data-tab]"))
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  required("#view-activity").addEventListener("click", () => selectTab("activity"));
  required("#refresh").addEventListener("click", refresh);
  required("#player-search").addEventListener("submit", (event) => {
    event.preventDefault();
    playersPage = 1;
    loadPlayers().catch(report);
  });
  required("#activity-filter").addEventListener("submit", (event) => {
    event.preventDefault();
    activityPage = 1;
    loadActivity().catch(report);
  });
  required("#close-detail").addEventListener(
    "click",
    () => required("#player-dialog").close()
  );
  required("#player-dialog").addEventListener("close", () => detailGeneration++);
  (async () => {
    try {
      const user = await request2("/api/me");
      if (!user.admin) {
        denyAccess();
        return;
      }
      required("#admin-name").textContent = user.username;
      for (const input of document.querySelectorAll("[data-admin-username]"))
        input.value = user.username;
      await refresh();
    } catch (caught) {
      const error = requestError(caught);
      report(error);
    }
  })();
})();
