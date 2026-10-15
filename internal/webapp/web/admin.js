"use strict";
const $ = (selector) => document.querySelector(selector);
const number = (value) => new Intl.NumberFormat().format(value ?? 0);
const date = (value) => value ? new Date(value).toLocaleString() : "—";
function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
}
const actionName = { signup: "Created account", sign_in: "Signed in", click: "Saved a click", admin_granted: "Admin access granted", admin_revoked: "Admin access revoked", backup_export: "Backup exported", backup_restore: "Backup restored", rails_import: "Rails players imported", password_set: "Password set by operator" };
let tab = "overview";
let playersPage = 1, activityPage = 1, auditPage = 1, detailActivityPage = 1, detailEntityPage = 1;
let selectedPlayer = null, detailGeneration = 0, restoring = false;
const pendingReads = new Map();
function node(tag, className = "", text = "") { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; }
function activityIcon(action) {
  const names = { click: "click", sign_in: "key", signup: "players" };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.setAttribute("class", "icon"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `/icons.svg#${names[action] || "activity"}`); svg.append(use); return svg;
}
function notice(selector, text, error = false) { const element = $(selector); element.textContent = text; element.hidden = !text; element.classList.toggle("notice-error", error); }
function denyAccess() { $("#dashboard-body").hidden = true; $("#access-error").hidden = false; $("#player-dialog").close(); }
async function request(url, options = {}, binary = false) {
  let response;
  try { response = await fetch(url, { credentials: "same-origin", ...options }); }
  catch (_) { const error = new Error("Can’t reach Go Click. Check your connection and try again."); error.uncertain = true; throw error; }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    if (response.status === 401 || (response.status === 403 && data.error === "Administrator access required")) denyAccess();
    const retry = response.headers.get("Retry-After");
    const error = new Error(response.status === 429 && retry ? `Try again in ${retry} seconds.` : (data.error || "Request failed. Try again."));
    error.uncertain = response.status >= 500 && data.code !== "authentication_busy"; error.code = data.code;
    throw error;
  }
  try {
    if (binary) return await response.blob();
    const data = await response.json();
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new TypeError("Expected a JSON object");
    return data;
  }
  catch (_) { const error = new Error("Couldn’t read the server’s response."); error.uncertain = true; throw error; }
}
async function latestRead(key, url) {
  pendingReads.get(key)?.abort();
  const controller = new AbortController(); pendingReads.set(key, controller);
  try {
    const data = await request(url, { signal: controller.signal });
    return pendingReads.get(key) === controller ? data : null;
  } catch (error) {
    if (pendingReads.get(key) === controller) throw error;
    return null;
  } finally {
    if (pendingReads.get(key) === controller) pendingReads.delete(key);
  }
}
function jsonOptions(body) { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
function playerButton(player) { const button = node("button", "text-button", player.username); button.type = "button"; button.addEventListener("click", () => openPlayer(player.id)); return button; }
function emptyRow(body, columns, message) { const row = node("tr"); const cell = node("td", "empty", message); cell.colSpan = columns; row.append(cell); body.append(row); }
function cell(row, value, secondary) { const td = node("td", "", value); if (secondary) td.append(node("span", "secondary", secondary)); row.append(td); return td; }
function pager(selector, page, total, onPage) {
  const element = $(selector); element.replaceChildren(node("span", "", `${number(total)} record${total === 1 ? "" : "s"} · Page ${page} of ${Math.max(1, Math.ceil(total / 25))}`));
  for (const [label, next, disabled] of [["Previous", page - 1, page <= 1], ["Next", page + 1, page * 25 >= total]]) {
    const button = node("button", "button button-quiet", label); button.type = "button"; button.disabled = disabled;
    button.addEventListener("click", () => onPage(next).catch(report)); element.append(button);
  }
}
function report(error) { notice("#admin-error", error.message, true); }
async function loadOverview() {
  const [stats, recent] = await Promise.all([request("/api/admin/overview"), request("/api/admin/activity?limit=6")]);
  $("#metric-players").textContent = number(stats.players); $("#metric-admins").textContent = `${number(stats.admins)} administrator${stats.admins === 1 ? "" : "s"}`;
  $("#metric-clicks").textContent = number(stats.clicks); $("#metric-active").textContent = number(stats.active_players_24h); $("#metric-today").textContent = number(stats.clicks_24h); $("#metric-sessions").textContent = `${number(stats.active_sessions)} active sessions`;
  const chart = $("#daily-chart"); chart.replaceChildren(); const max = Math.max(1, ...stats.daily_clicks.map((day) => day.clicks));
  for (const day of stats.daily_clicks) {
    const column = node("div", "chart-column"); column.setAttribute("aria-label", `${day.date}: ${number(day.clicks)} clicks`);
    const track = node("div", "chart-track"); const bar = node("div", "chart-bar"); bar.style.height = `${day.clicks / max * 100}%`; if (day.clicks > 0) bar.style.minHeight = "3px"; track.append(bar);
    column.append(node("span", "chart-value", number(day.clicks)), track, node("span", "chart-date", day.date.slice(5))); chart.append(column);
  }
  const feed = $("#recent-activity"); feed.replaceChildren();
  if (!recent.items.length) feed.append(node("p", "muted", "No recorded activity yet."));
  for (const event of recent.items) { const item = node("div", "activity-item"); const who = node("div", "activity-who"); const symbol = node("span", "event-symbol"); symbol.append(activityIcon(event.action)); const identity = node("div"); identity.append(playerButton({ id: event.user_id, username: event.username }), node("div", "activity-action", actionName[event.action] || event.action)); who.append(symbol, identity); item.append(who, node("span", "muted", date(event.occurred_at))); feed.append(item); }
}
async function loadPlayers() {
  const page = playersPage, query = new URLSearchParams({ page, q: $("#search").value.trim(), sort: $("#sort").value });
  const data = await latestRead("players", `/api/admin/players?${query}`); if (!data) return;
  const body = $("#players-rows"); body.replaceChildren();
  if (!data.items.length) emptyRow(body, 5, "No players match this search.");
  for (const player of data.items) { const row = node("tr"); const identity = cell(row, ""); identity.append(playerButton(player)); if (player.admin) identity.append(node("span", "pill", "ADMIN")); identity.append(node("span", "secondary", player.email || `Player #${player.id}`)); cell(row, number(player.clicks)); cell(row, `${number(player.day_streak)} / ${number(player.month_streak)} / ${number(player.year_streak)}`); cell(row, date(player.last_clicked_at)); cell(row, date(player.created_at)); body.append(row); }
  pager("#players-pager", page, data.total, async (page) => { playersPage = page; await loadPlayers(); });
}
function activityRows(selector, items, includePlayer) {
  const body = $(selector); body.replaceChildren(); if (!items.length) emptyRow(body, includePlayer ? 4 : 3, "No recorded activity yet.");
  for (const event of items) { const row = node("tr"); if (includePlayer) cell(row, "").append(playerButton({ id: event.user_id, username: event.username })); cell(row, actionName[event.action] || event.action); cell(row, event.click_count == null ? "—" : number(event.click_count)); cell(row, date(event.occurred_at)); body.append(row); }
}
async function loadActivity() {
  const page = activityPage, query = new URLSearchParams({ page }); if ($("#activity-user").value) query.set("user_id", $("#activity-user").value);
  const data = await latestRead("activity", `/api/admin/activity?${query}`); if (!data) return;
  activityRows("#activity-rows", data.items, true);
  pager("#activity-pager", page, data.total, async (page) => { activityPage = page; await loadActivity(); });
}
async function loadAudit() {
  const page = auditPage, data = await latestRead("audit", `/api/admin/audit?page=${page}`); if (!data) return;
  const body = $("#audit-rows"); body.replaceChildren(); if (!data.items.length) emptyRow(body, 4, "No administrative activity yet.");
  for (const event of data.items) { const row = node("tr"); cell(row, event.actor_username); cell(row, actionName[event.action] || event.action); cell(row, event.result); cell(row, date(event.occurred_at)); body.append(row); }
  pager("#audit-pager", page, data.total, async (page) => { auditPage = page; await loadAudit(); });
}
async function loadStorage() {
  const data = await request("/api/admin/storage"), snapshots = data.recovery_snapshots;
  $("#storage-database").textContent = bytes(data.database_bytes);
  $("#storage-reusable").textContent = `${bytes(data.reusable_bytes)} reusable pages`;
  $("#storage-activity").textContent = number(data.activity_records);
  $("#storage-oldest-activity").textContent = data.oldest_activity_at ? `Since ${date(data.oldest_activity_at)}` : "No recorded activity";
  $("#storage-audit").textContent = number(data.audit_records);
  $("#storage-snapshots").textContent = snapshots ? `${number(snapshots.count)} · ${bytes(snapshots.bytes)}` : "Unavailable";
  $("#storage-snapshot-detail").textContent = !snapshots ? "Couldn’t read the recovery directory." : snapshots.oldest_at ? `Oldest ${date(snapshots.oldest_at)}` : "No local recovery snapshots";
  const warnings = [];
  if (!snapshots) warnings.push("Recovery snapshot usage could not be measured. Check the server log and directory access.");
  if (snapshots?.oversized) warnings.push(`${number(snapshots.oversized)} local recovery snapshot${snapshots.oversized === 1 ? " exceeds" : "s exceed"} the ${bytes(data.restore_limit_bytes)} panel upload limit. Use host-side recovery for those files.`);
  if (data.database_bytes >= data.restore_limit_bytes * .8) warnings.push(`Database allocation is approaching or above the ${bytes(data.restore_limit_bytes)} panel restore limit. Check the actual exported file size; larger snapshots require host-side recovery.`);
  notice("#storage-warning", warnings.join(" "));
}
async function loadBackups() { await Promise.all([loadStorage(), loadAudit()]); }
async function refreshAfterOperation() {
  try { await loadBackups(); }
  catch (error) { notice("#admin-error", `Operation completed, but the dashboard could not refresh. ${error.message}`, true); }
}
async function refresh() {
  if (restoring) return; notice("#admin-error", ""); $("#refresh").disabled = true; $("#refresh").textContent = "Refreshing…";
  try { await ({ overview: loadOverview, players: loadPlayers, activity: loadActivity, backups: loadBackups })[tab](); $("#updated-at").textContent = `Updated ${new Date().toLocaleTimeString()}`; }
  catch (error) { report(error); }
  finally { $("#refresh").disabled = false; $("#refresh").textContent = "Refresh data"; }
}
function selectTab(next) { if (restoring) return; tab = next; for (const button of document.querySelectorAll("[data-tab]")) { if (button.dataset.tab === tab) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); } for (const panel of document.querySelectorAll(".admin-panel")) panel.hidden = panel.id !== `${tab}-panel`; refresh(); }
async function detailActivity(generation) {
  const page = detailActivityPage, data = await latestRead("detail-activity", `/api/admin/activity?user_id=${selectedPlayer}&page=${page}`); if (!data || generation !== detailGeneration) return;
  activityRows("#detail-activity", data.items, false); pager("#detail-activity-pager", page, data.total, async (page) => { detailActivityPage = page; await detailActivity(generation); });
}
async function detailEntities(generation) {
  const page = detailEntityPage, data = await latestRead("detail-entities", `/api/admin/players/${selectedPlayer}/entities?page=${page}`); if (!data || generation !== detailGeneration) return;
  const body = $("#detail-entities"); body.replaceChildren(); if (!data.items.length) emptyRow(body, 4, "No archived Rails entities for this player.");
  for (const entity of data.items) { const row = node("tr"); cell(row, entity.kind ?? "(null kind)", `Entity #${entity.id} · ${entity.source === "json" ? "JSON" : "SQLite"}`); cell(row, entity.count == null ? "null" : number(entity.count)); cell(row, date(entity.created_time), `Record: ${date(entity.created_at)}`); cell(row, date(entity.modified_time), `Record: ${date(entity.updated_at)}`); body.append(row); }
  pager("#detail-entities-pager", page, data.total, async (page) => { detailEntityPage = page; await detailEntities(generation); });
}
async function openPlayer(id) {
  selectedPlayer = id; detailActivityPage = detailEntityPage = 1; const generation = ++detailGeneration;
  $("#detail-title").textContent = "Loading player…"; $("#detail-content").hidden = true; notice("#detail-error", ""); if (!$("#player-dialog").open) $("#player-dialog").showModal();
  try {
    const player = await request(`/api/admin/players/${id}`); if (generation !== detailGeneration) return;
    $("#detail-title").textContent = player.username; const profile = $("#detail-profile"); profile.replaceChildren();
    for (const [label, value] of [["Player ID", player.id], ["Email", player.email || "Not provided"], ["Role", player.admin ? "Administrator" : "Player"], ["Joined", date(player.created_at)], ["Updated", date(player.updated_at)], ["All-time clicks", number(player.clicks)], ["Day / month / year streak", `${player.day_streak} / ${player.month_streak} / ${player.year_streak}`], ["Last click", date(player.last_clicked_at)], ["Last recorded sign-in", date(player.last_sign_in_at)]]) { const entry = node("div"); entry.append(node("dt", "", label), node("dd", "", String(value))); profile.append(entry); }
    await Promise.all([detailActivity(generation), detailEntities(generation)]); if (generation === detailGeneration) $("#detail-content").hidden = false;
  } catch (error) { if (generation === detailGeneration) notice("#detail-error", error.message, true); }
}
function busy(form, state, label) { const button = form.querySelector("button[type=submit]"); button.disabled = state; button.textContent = label; form.setAttribute("aria-busy", String(state)); }
let restoreFileGeneration = 0;
$("#restore-file").addEventListener("change", async () => {
  const generation = ++restoreFileGeneration, file = $("#restore-file").files[0];
  let json = false;
  try {
    if (file) { const header = await file.slice(0, 16).text(); json = header !== "SQLite format 3\0" && (file.type === "application/json" || /\.json$/i.test(file.name) || header.trimStart().startsWith("{")); }
  } catch (_) { notice("#restore-status", "Can’t read the selected file. Choose it again.", true); }
  if (generation !== restoreFileGeneration) return;
  $("#restore-json-access").hidden = !json;
  for (const input of $("#restore-json-access").querySelectorAll("input")) { input.disabled = !json; input.required = json; if (!json) input.value = ""; }
});
$("#export-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (restoring) return; const form = event.currentTarget; busy(form, true, "Preparing backup…"); notice("#export-status", "Creating a consistent snapshot…");
  const password = $("#export-password").value; $("#export-password").value = "";
  try { const blob = await request("/api/admin/backups/export", jsonOptions({ password }), true); const url = URL.createObjectURL(blob); const link = node("a"); link.href = url; link.download = `goclick-${new Date().toISOString().replace(/[:.]/g, "-")}.db`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); notice("#export-status", "Backup ready. Keep this file in a private recovery location."); await refreshAfterOperation(); }
  catch (error) { notice("#export-status", error.message, true); }
  finally { busy(form, false, "Download backup"); }
});
$("#restore-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (restoring) return; const form = event.currentTarget; const file = $("#restore-file").files[0];
  const json = !$("#restore-json-access").hidden;
  if (!file || file.size > (json ? 16 : 128) * 1024 * 1024) { notice("#restore-status", "Choose a SQLite database up to 128 MiB, or Rails JSON up to 16 MiB.", true); return; }
  if (!$("#restore-json-access").hidden && $("#restore-admin-password").value !== $("#restore-admin-password-confirmation").value) { notice("#restore-status", "The new administrator passwords do not match.", true); return; }
  const data = new FormData(); data.append("password", $("#restore-password").value); data.append("confirmation", $("#restore-confirmation").value); data.append("backup", file); $("#restore-password").value = "";
  if (!$("#restore-json-access").hidden) { for (const input of $("#restore-json-access").querySelectorAll("input")) { data.append(input.name, input.value); if (input.type === "password") input.value = ""; } }
  restoring = true; busy(form, true, "Restoring…"); notice("#restore-status", "Validating the uploaded data and saving a recovery snapshot. Leave this page open until replacement completes.");
  try { const result = await request("/api/admin/backups/restore", { method: "POST", body: data }); $("#dashboard-body").hidden = true; $("#restore-success").hidden = false; $("#restore-result-title").textContent = result.source_format === "goclick" ? "Database restored" : "Rails players migrated"; $("#restore-summary").textContent = `${number(result.users)} accounts and ${number(result.entities)} archived entities restored. Recovery snapshot: ${result.recovery_backup}.${result.admin_username ? ` Sign in as ${result.admin_username} with the new password you set. Other JSON-imported accounts need an operator-set password.` : ""}`; $("#refresh").hidden = true; }
  catch (error) { notice("#restore-status", error.message + (error.uncertain ? " Sign in again and check the audit history before retrying; the connection may have failed after replacement." : ""), true); }
  finally { restoring = false; busy(form, false, "Restore or migrate database"); }
});
$("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (restoring) return;
  const form = event.currentTarget, file = $("#import-file").files[0];
  if (!file || file.size > 128 * 1024 * 1024) { notice("#import-status", "Choose a Rails database up to 128 MiB, or JSON up to 16 MiB.", true); return; }
  const data = new FormData(); data.append("password", $("#import-password").value); data.append("confirmation", $("#import-confirmation").value); data.append("backup", file); $("#import-password").value = "";
  restoring = true; busy(form, true, "Importing…"); notice("#import-status", "Saving a recovery snapshot and checking the import…");
  $("#import-replacement-link").hidden = true;
  try { const result = await request("/api/admin/import/rails", { method: "POST", body: data }); notice("#import-status", `${number(result.users)} players and ${number(result.entities)} entities imported. Recovery snapshot: ${result.recovery_backup}.${result.new_passwords_required ? " New accounts need an operator-set password before signing in." : " Existing passwords were preserved."}`); await refreshAfterOperation(); }
  catch (error) { notice("#import-status", error.message + (error.uncertain ? " Check the audit history before retrying; the connection may have failed after the import." : ""), true); $("#import-replacement-link").hidden = error.code !== "import_conflict"; }
  finally { restoring = false; busy(form, false, "Import Rails players"); }
});
for (const button of document.querySelectorAll("[data-tab]")) button.addEventListener("click", () => selectTab(button.dataset.tab));
$("#view-activity").addEventListener("click", () => selectTab("activity"));
$("#refresh").addEventListener("click", refresh);
$("#player-search").addEventListener("submit", (event) => { event.preventDefault(); playersPage = 1; loadPlayers().catch(report); });
$("#activity-filter").addEventListener("submit", (event) => { event.preventDefault(); activityPage = 1; loadActivity().catch(report); });
$("#close-detail").addEventListener("click", () => $("#player-dialog").close());
$("#player-dialog").addEventListener("close", () => detailGeneration++);
(async () => { try { const user = await request("/api/me"); if (!user.admin) { denyAccess(); return; } $("#admin-name").textContent = user.username; for (const input of document.querySelectorAll("[data-admin-username]")) input.value = user.username; await refresh(); } catch (error) { report(error); } })();
