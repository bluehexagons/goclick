"use strict";
const $ = (selector) => document.querySelector(selector);
const number = (value) => new Intl.NumberFormat().format(value ?? 0);
const date = (value) => value ? new Date(value).toLocaleString() : "—";
const actionName = { signup: "Created account", sign_in: "Signed in", click: "Saved a click", admin_granted: "Admin access granted", admin_revoked: "Admin access revoked", backup_export: "Backup exported", backup_restore: "Backup restored", rails_import: "Rails players imported", password_set: "Password set by operator" };
let tab = "overview";
let playersPage = 1, activityPage = 1, auditPage = 1, detailActivityPage = 1, detailEntityPage = 1;
let selectedPlayer = null, detailGeneration = 0, restoring = false;
function node(tag, className = "", text = "") { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; }
function notice(selector, text, error = false) { const element = $(selector); element.textContent = text; element.hidden = !text; element.classList.toggle("notice-error", error); }
function denyAccess() { $("#dashboard-body").hidden = true; $("#access-error").hidden = false; $("#player-dialog").close(); }
async function request(url, options = {}, binary = false) {
  let response;
  try { response = await fetch(url, { credentials: "same-origin", ...options }); }
  catch (_) { const error = new Error("Can’t reach Go Click. Check your connection and try again."); error.uncertain = true; throw error; }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || (response.status === 403 && data.error === "Administrator access required")) denyAccess();
    const retry = response.headers.get("Retry-After");
    const error = new Error(response.status === 429 && retry ? `Try again in ${retry} seconds.` : (data.error || "Request failed. Try again."));
    error.uncertain = response.status >= 500; error.code = data.code;
    throw error;
  }
  try { return binary ? await response.blob() : await response.json(); }
  catch (_) { const error = new Error("Couldn’t read the server’s response."); error.uncertain = true; throw error; }
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
  const [stats, recent] = await Promise.all([request("/api/admin/overview"), request("/api/admin/activity?limit=8")]);
  $("#metric-players").textContent = number(stats.players); $("#metric-admins").textContent = `${number(stats.admins)} administrator${stats.admins === 1 ? "" : "s"}`;
  $("#metric-clicks").textContent = number(stats.clicks); $("#metric-active").textContent = number(stats.active_players_24h); $("#metric-today").textContent = number(stats.clicks_24h); $("#metric-sessions").textContent = `${number(stats.active_sessions)} active sessions`;
  const chart = $("#daily-chart"); chart.replaceChildren(); const max = Math.max(1, ...stats.daily_clicks.map((day) => day.clicks));
  for (const day of stats.daily_clicks) {
    const column = node("div", "chart-column"); column.setAttribute("aria-label", `${day.date}: ${number(day.clicks)} clicks`);
    const track = node("div", "chart-track"); const bar = node("div", "chart-bar"); bar.style.height = `${day.clicks / max * 100}%`; track.append(bar);
    column.append(node("span", "chart-value", number(day.clicks)), track, node("span", "chart-date", day.date.slice(5))); chart.append(column);
  }
  const feed = $("#recent-activity"); feed.replaceChildren();
  if (!recent.items.length) feed.append(node("p", "muted", "No recorded activity yet."));
  for (const event of recent.items) { const item = node("div", "activity-item"); const who = node("div"); who.append(playerButton({ id: event.user_id, username: event.username }), node("div", "", actionName[event.action] || event.action)); item.append(who, node("span", "muted", date(event.occurred_at))); feed.append(item); }
}
async function loadPlayers() {
  const query = new URLSearchParams({ page: playersPage, q: $("#search").value.trim(), sort: $("#sort").value });
  const data = await request(`/api/admin/players?${query}`); const body = $("#players-rows"); body.replaceChildren();
  if (!data.items.length) emptyRow(body, 5, "No players match this search.");
  for (const player of data.items) { const row = node("tr"); const identity = cell(row, ""); identity.append(playerButton(player)); if (player.admin) identity.append(node("span", "pill", "ADMIN")); identity.append(node("span", "secondary", player.email || `Player #${player.id}`)); cell(row, number(player.clicks)); cell(row, `${number(player.day_streak)} / ${number(player.month_streak)} / ${number(player.year_streak)}`); cell(row, date(player.last_clicked_at)); cell(row, date(player.created_at)); body.append(row); }
  pager("#players-pager", playersPage, data.total, async (page) => { playersPage = page; await loadPlayers(); });
}
function activityRows(selector, items, includePlayer) {
  const body = $(selector); body.replaceChildren(); if (!items.length) emptyRow(body, includePlayer ? 4 : 3, "No recorded activity yet.");
  for (const event of items) { const row = node("tr"); if (includePlayer) cell(row, "").append(playerButton({ id: event.user_id, username: event.username })); cell(row, actionName[event.action] || event.action); cell(row, event.click_count == null ? "—" : number(event.click_count)); cell(row, date(event.occurred_at)); body.append(row); }
}
async function loadActivity() {
  const query = new URLSearchParams({ page: activityPage }); if ($("#activity-user").value) query.set("user_id", $("#activity-user").value);
  const data = await request(`/api/admin/activity?${query}`); activityRows("#activity-rows", data.items, true);
  pager("#activity-pager", activityPage, data.total, async (page) => { activityPage = page; await loadActivity(); });
}
async function loadAudit() {
  const data = await request(`/api/admin/audit?page=${auditPage}`); const body = $("#audit-rows"); body.replaceChildren(); if (!data.items.length) emptyRow(body, 4, "No administrative activity yet.");
  for (const event of data.items) { const row = node("tr"); cell(row, event.actor_username); cell(row, actionName[event.action] || event.action); cell(row, event.result); cell(row, date(event.occurred_at)); body.append(row); }
  pager("#audit-pager", auditPage, data.total, async (page) => { auditPage = page; await loadAudit(); });
}
async function refresh() {
  if (restoring) return; notice("#admin-error", ""); $("#refresh").disabled = true; $("#refresh").textContent = "Refreshing…";
  try { await ({ overview: loadOverview, players: loadPlayers, activity: loadActivity, backups: loadAudit })[tab](); $("#updated-at").textContent = `Updated ${new Date().toLocaleTimeString()}`; }
  catch (error) { report(error); }
  finally { $("#refresh").disabled = false; $("#refresh").textContent = "Refresh data"; }
}
function selectTab(next) { if (restoring) return; tab = next; for (const button of document.querySelectorAll("[data-tab]")) { if (button.dataset.tab === tab) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); } for (const panel of document.querySelectorAll(".admin-panel")) panel.hidden = panel.id !== `${tab}-panel`; refresh(); }
async function detailActivity(generation) {
  const data = await request(`/api/admin/activity?user_id=${selectedPlayer}&page=${detailActivityPage}`); if (generation !== detailGeneration) return;
  activityRows("#detail-activity", data.items, false); pager("#detail-activity-pager", detailActivityPage, data.total, async (page) => { detailActivityPage = page; await detailActivity(generation); });
}
async function detailEntities(generation) {
  const data = await request(`/api/admin/players/${selectedPlayer}/entities?page=${detailEntityPage}`); if (generation !== detailGeneration) return;
  const body = $("#detail-entities"); body.replaceChildren(); if (!data.items.length) emptyRow(body, 4, "No archived Rails entities for this player.");
  for (const entity of data.items) { const row = node("tr"); cell(row, entity.kind ?? "(null kind)", `Entity #${entity.id} · ${entity.source === "json" ? "JSON" : "SQLite"}`); cell(row, entity.count == null ? "null" : number(entity.count)); cell(row, date(entity.created_time), `Record: ${date(entity.created_at)}`); cell(row, date(entity.modified_time), `Record: ${date(entity.updated_at)}`); body.append(row); }
  pager("#detail-entities-pager", detailEntityPage, data.total, async (page) => { detailEntityPage = page; await detailEntities(generation); });
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
  try { const blob = await request("/api/admin/backups/export", jsonOptions({ password }), true); const url = URL.createObjectURL(blob); const link = node("a"); link.href = url; link.download = `goclick-${new Date().toISOString().replace(/[:.]/g, "-")}.db`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); notice("#export-status", "Backup ready. Keep this file in a private recovery location."); await loadAudit(); }
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
  try { const result = await request("/api/admin/import/rails", { method: "POST", body: data }); notice("#import-status", `${number(result.users)} players and ${number(result.entities)} entities imported. Recovery snapshot: ${result.recovery_backup}.${result.new_passwords_required ? " New accounts need an operator-set password before signing in." : " Existing passwords were preserved."}`); await loadAudit(); }
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
