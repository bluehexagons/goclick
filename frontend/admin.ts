import "./focus.js";
import "./interaction.js";
import { request as sendRequest, requestError, jsonOptions } from "./http.js";
import type { RequestOptions } from "./http.js";
import { required as $ } from "./dom.js";
import type {
  User,
  Page,
  AdminPlayer,
  Activity,
  Audit,
  ArchivedEntity,
  Overview,
  StorageStats,
  RecoveryResult,
} from "./types.js";
const number = (value: number | null | undefined) => new Intl.NumberFormat().format(value ?? 0);
const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "—");
function bytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
}
const actionName: Record<string, string> = {
  signup: "Created account",
  sign_in: "Signed in",
  click: "Saved a click",
  admin_granted: "Admin access granted",
  admin_revoked: "Admin access revoked",
  backup_export: "Backup exported",
  backup_restore: "Backup restored",
  rails_import: "Rails players imported",
  password_set: "Password set by operator",
};
type Tab = "overview" | "players" | "activity" | "backups";
let tab: Tab = "overview";
let playersPage = 1,
  activityPage = 1,
  auditPage = 1,
  detailActivityPage = 1,
  detailEntityPage = 1;
let selectedPlayer: number | null = null;
let detailGeneration = 0,
  restoring = false;
const pendingReads = new Map<string, AbortController>();
function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
function activityIcon(action: string) {
  const names: Record<string, string> = { click: "click", sign_in: "key", signup: "players" };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `/icons.svg#${names[action] || "activity"}`);
  svg.append(use);
  return svg;
}
function notice(selector: string, text: string, error = false) {
  const element = $(selector);
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle("notice-error", error);
}
function denyAccess() {
  $("#dashboard-body").hidden = true;
  $("#access-error").hidden = false;
  $<HTMLDialogElement>("#player-dialog").close();
}
function request<T>(url: string, options?: RequestOptions, binary?: false): Promise<T>;
function request(url: string, options: RequestOptions, binary: true): Promise<Blob>;
async function request<T>(
  url: string,
  options: RequestOptions = {},
  binary = false,
): Promise<T | Blob> {
  try {
    return binary ? await sendRequest(url, options, true) : await sendRequest<T>(url, options);
  } catch (caught) {
    const error = requestError(caught);
    if (
      error.status === 401 ||
      (error.status === 403 && error.message === "Administrator access required")
    )
      denyAccess();
    if (error.status === 429 && error.retryAfter)
      error.message = `Try again in ${error.retryAfter} seconds.`;
    throw error;
  }
}
async function latestRead<T>(key: string, url: string): Promise<T | null> {
  pendingReads.get(key)?.abort();
  const controller = new AbortController();
  pendingReads.set(key, controller);
  try {
    const data = await request<T>(url, { signal: controller.signal });
    return pendingReads.get(key) === controller ? data : null;
  } catch (caught) {
    const error = requestError(caught);
    if (pendingReads.get(key) === controller) throw error;
    return null;
  } finally {
    if (pendingReads.get(key) === controller) pendingReads.delete(key);
  }
}
function playerButton(player: Pick<User, "id" | "username">) {
  const button = node("button", "text-button", player.username);
  button.type = "button";
  button.addEventListener("click", () => openPlayer(player.id));
  return button;
}
function emptyRow(body: HTMLElement, columns: number, message: string) {
  const row = node("tr");
  const cell = node("td", "empty", message);
  cell.colSpan = columns;
  row.append(cell);
  body.append(row);
}
function cell(row: HTMLElement, value: string, secondary?: string) {
  const td = node("td", "", value);
  if (secondary) td.append(node("span", "secondary", secondary));
  row.append(td);
  return td;
}
function pager(
  selector: string,
  page: number,
  total: number,
  onPage: (page: number) => Promise<void>,
) {
  const element = $(selector);
  element.replaceChildren(
    node(
      "span",
      "",
      `${number(total)} record${total === 1 ? "" : "s"} · Page ${page} of ${Math.max(1, Math.ceil(total / 25))}`,
    ),
  );
  for (const [label, next, disabled] of [
    ["Previous", page - 1, page <= 1],
    ["Next", page + 1, page * 25 >= total],
  ] as const) {
    const button = node("button", "button button-quiet", label);
    button.type = "button";
    button.disabled = disabled;
    button.addEventListener("click", () => onPage(next).catch(report));
    element.append(button);
  }
}
function report(error: unknown) {
  notice("#admin-error", requestError(error).message, true);
}
async function loadOverview() {
  const [stats, recent] = await Promise.all([
    request<Overview>("/api/admin/overview"),
    request<Page<Activity>>("/api/admin/activity?limit=6"),
  ]);
  $("#metric-players").textContent = number(stats.players);
  $("#metric-admins").textContent =
    `${number(stats.admins)} administrator${stats.admins === 1 ? "" : "s"}`;
  $("#metric-clicks").textContent = number(stats.clicks);
  $("#metric-active").textContent = number(stats.active_players_24h);
  $("#metric-today").textContent = number(stats.clicks_24h);
  $("#metric-sessions").textContent = `${number(stats.active_sessions)} active sessions`;
  const chart = $("#daily-chart");
  chart.replaceChildren();
  const max = Math.max(1, ...stats.daily_clicks.map((day) => day.clicks));
  for (const day of stats.daily_clicks) {
    const column = node("div", "chart-column");
    column.setAttribute("aria-label", `${day.date}: ${number(day.clicks)} clicks`);
    const track = node("div", "chart-track");
    const bar = node("div", "chart-bar");
    bar.style.height = `${(day.clicks / max) * 100}%`;
    if (day.clicks > 0) bar.style.minHeight = "3px";
    track.append(bar);
    column.append(
      node("span", "chart-value", number(day.clicks)),
      track,
      node("span", "chart-date", day.date.slice(5)),
    );
    chart.append(column);
  }
  const feed = $("#recent-activity");
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
      node("div", "activity-action", actionName[event.action] || event.action),
    );
    who.append(symbol, identity);
    item.append(who, node("span", "muted", date(event.occurred_at)));
    feed.append(item);
  }
}
async function loadPlayers() {
  const page = playersPage,
    query = new URLSearchParams({
      page: String(page),
      q: $<HTMLInputElement>("#search").value.trim(),
      sort: $<HTMLSelectElement>("#sort").value,
    });
  const data = await latestRead<Page<AdminPlayer>>("players", `/api/admin/players?${query}`);
  if (!data) return;
  const body = $("#players-rows");
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
      `${number(player.day_streak)} / ${number(player.month_streak)} / ${number(player.year_streak)}`,
    );
    cell(row, date(player.last_clicked_at));
    cell(row, date(player.created_at));
    body.append(row);
  }
  pager("#players-pager", page, data.total, async (page) => {
    playersPage = page;
    await loadPlayers();
  });
}
function activityRows(selector: string, items: Activity[], includePlayer: boolean) {
  const body = $(selector);
  body.replaceChildren();
  if (!items.length) emptyRow(body, includePlayer ? 4 : 3, "No recorded activity yet.");
  for (const event of items) {
    const row = node("tr");
    if (includePlayer)
      cell(row, "").append(playerButton({ id: event.user_id, username: event.username }));
    cell(row, actionName[event.action] || event.action);
    cell(row, event.click_count == null ? "—" : number(event.click_count));
    cell(row, date(event.occurred_at));
    body.append(row);
  }
}
async function loadActivity() {
  const page = activityPage,
    query = new URLSearchParams({ page: String(page) });
  if ($<HTMLInputElement>("#activity-user").value)
    query.set("user_id", $<HTMLInputElement>("#activity-user").value);
  const data = await latestRead<Page<Activity>>("activity", `/api/admin/activity?${query}`);
  if (!data) return;
  activityRows("#activity-rows", data.items, true);
  pager("#activity-pager", page, data.total, async (page) => {
    activityPage = page;
    await loadActivity();
  });
}
async function loadAudit() {
  const page = auditPage,
    data = await latestRead<Page<Audit>>("audit", `/api/admin/audit?page=${page}`);
  if (!data) return;
  const body = $("#audit-rows");
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
  pager("#audit-pager", page, data.total, async (page) => {
    auditPage = page;
    await loadAudit();
  });
}
async function loadStorage() {
  const data = await request<StorageStats>("/api/admin/storage"),
    snapshots = data.recovery_snapshots;
  $("#storage-database").textContent = bytes(data.database_bytes);
  $("#storage-reusable").textContent = `${bytes(data.reusable_bytes)} reusable pages`;
  $("#storage-activity").textContent = number(data.activity_records);
  $("#storage-oldest-activity").textContent = data.oldest_activity_at
    ? `Since ${date(data.oldest_activity_at)}`
    : "No recorded activity";
  $("#storage-audit").textContent = number(data.audit_records);
  $("#storage-snapshots").textContent = snapshots
    ? `${number(snapshots.count)} · ${bytes(snapshots.bytes)}`
    : "Unavailable";
  $("#storage-snapshot-detail").textContent = !snapshots
    ? "Couldn’t read the recovery directory."
    : snapshots.oldest_at
      ? `Oldest ${date(snapshots.oldest_at)}`
      : "No local recovery snapshots";
  const warnings = [];
  if (!snapshots)
    warnings.push(
      "Recovery snapshot usage could not be measured. Check the server log and directory access.",
    );
  if (snapshots?.oversized)
    warnings.push(
      `${number(snapshots.oversized)} local recovery snapshot${snapshots.oversized === 1 ? " exceeds" : "s exceed"} the ${bytes(data.restore_limit_bytes)} panel upload limit. Use host-side recovery for those files.`,
    );
  if (data.database_bytes >= data.restore_limit_bytes * 0.8)
    warnings.push(
      `Database allocation is approaching or above the ${bytes(data.restore_limit_bytes)} panel restore limit. Check the actual exported file size; larger snapshots require host-side recovery.`,
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
      true,
    );
  }
}
async function refresh() {
  if (restoring) return;
  notice("#admin-error", "");
  $<HTMLButtonElement>("#refresh").disabled = true;
  $<HTMLButtonElement>("#refresh").textContent = "Refreshing…";
  try {
    await {
      overview: loadOverview,
      players: loadPlayers,
      activity: loadActivity,
      backups: loadBackups,
    }[tab]();
    $("#updated-at").textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (caught) {
    const error = requestError(caught);
    report(error);
  } finally {
    $<HTMLButtonElement>("#refresh").disabled = false;
    $<HTMLButtonElement>("#refresh").textContent = "Refresh data";
  }
}
function selectTab(next: Tab) {
  if (restoring) return;
  tab = next;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  for (const panel of document.querySelectorAll<HTMLElement>(".admin-panel"))
    panel.hidden = panel.id !== `${tab}-panel`;
  refresh();
}
async function detailActivity(generation: number) {
  const page = detailActivityPage,
    data = await latestRead<Page<Activity>>(
      "detail-activity",
      `/api/admin/activity?user_id=${selectedPlayer}&page=${page}`,
    );
  if (!data || generation !== detailGeneration) return;
  activityRows("#detail-activity", data.items, false);
  pager("#detail-activity-pager", page, data.total, async (page) => {
    detailActivityPage = page;
    await detailActivity(generation);
  });
}
async function detailEntities(generation: number) {
  const page = detailEntityPage,
    data = await latestRead<Page<ArchivedEntity>>(
      "detail-entities",
      `/api/admin/players/${selectedPlayer}/entities?page=${page}`,
    );
  if (!data || generation !== detailGeneration) return;
  const body = $("#detail-entities");
  body.replaceChildren();
  if (!data.items.length) emptyRow(body, 4, "No archived Rails entities for this player.");
  for (const entity of data.items) {
    const row = node("tr");
    cell(
      row,
      entity.kind ?? "(null kind)",
      `Entity #${entity.id} · ${entity.source === "json" ? "JSON" : "SQLite"}`,
    );
    cell(row, entity.count == null ? "null" : number(entity.count));
    cell(row, date(entity.created_time), `Record: ${date(entity.created_at)}`);
    cell(row, date(entity.modified_time), `Record: ${date(entity.updated_at)}`);
    body.append(row);
  }
  pager("#detail-entities-pager", page, data.total, async (page) => {
    detailEntityPage = page;
    await detailEntities(generation);
  });
}
async function openPlayer(id: number) {
  selectedPlayer = id;
  detailActivityPage = detailEntityPage = 1;
  const generation = ++detailGeneration;
  $("#detail-title").textContent = "Loading player…";
  $("#detail-content").hidden = true;
  notice("#detail-error", "");
  if (!$<HTMLDialogElement>("#player-dialog").open)
    $<HTMLDialogElement>("#player-dialog").showModal();
  try {
    const player = await request<AdminPlayer>(`/api/admin/players/${id}`);
    if (generation !== detailGeneration) return;
    $("#detail-title").textContent = player.username;
    const profile = $("#detail-profile");
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
        `${player.day_streak} / ${player.month_streak} / ${player.year_streak}`,
      ],
      ["Last click", date(player.last_clicked_at)],
      ["Last recorded sign-in", date(player.last_sign_in_at)],
    ] as const) {
      const entry = node("div");
      entry.append(node("dt", "", label), node("dd", "", String(value)));
      profile.append(entry);
    }
    await Promise.all([detailActivity(generation), detailEntities(generation)]);
    if (generation === detailGeneration) $("#detail-content").hidden = false;
  } catch (caught) {
    const error = requestError(caught);
    if (generation === detailGeneration) notice("#detail-error", error.message, true);
  }
}
function busy(form: HTMLFormElement, state: boolean, label: string) {
  const button = $<HTMLButtonElement>("button[type=submit]", form);
  button.disabled = state;
  button.textContent = label;
  form.setAttribute("aria-busy", String(state));
}
$<HTMLFormElement>("#export-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (restoring) return;
  const form = event.currentTarget as HTMLFormElement;
  busy(form, true, "Preparing backup…");
  notice("#export-status", "Creating a consistent snapshot…");
  const password = $<HTMLInputElement>("#export-password").value;
  $<HTMLInputElement>("#export-password").value = "";
  try {
    const blob = await request(
      "/api/admin/backups/export",
      {
        ...jsonOptions({ password }),
        timeoutMilliseconds: 150000,
      },
      true,
    );
    const url = URL.createObjectURL(blob);
    const link = node("a");
    link.href = url;
    link.download = `goclick-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    notice("#export-status", "Backup ready. Keep this file in a private recovery location.");
    await refreshAfterOperation();
  } catch (caught) {
    const error = requestError(caught);
    notice("#export-status", error.message, true);
  } finally {
    busy(form, false, "Download backup");
  }
});
$<HTMLFormElement>("#restore-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (restoring) return;
  const form = event.currentTarget as HTMLFormElement;
  const file = $<HTMLInputElement>("#restore-file").files?.[0];
  if (!file || file.size > 128 * 1024 * 1024) {
    notice("#restore-status", "Choose a Go Click SQLite backup up to 128 MiB.", true);
    return;
  }
  const data = new FormData();
  data.append("password", $<HTMLInputElement>("#restore-password").value);
  data.append("confirmation", $<HTMLInputElement>("#restore-confirmation").value);
  data.append("backup", file);
  $<HTMLInputElement>("#restore-password").value = "";
  restoring = true;
  busy(form, true, "Restoring…");
  notice(
    "#restore-status",
    "Validating the uploaded data and saving a recovery snapshot. Leave this page open until replacement completes.",
  );
  try {
    const result = await request<RecoveryResult>("/api/admin/backups/restore", {
      timeoutMilliseconds: 150000,
      method: "POST",
      body: data,
    });
    $("#dashboard-body").hidden = true;
    $("#restore-success").hidden = false;
    $("#restore-summary").textContent =
      `${number(result.users)} accounts and ${number(result.entities)} archived entities restored. Recovery snapshot: ${result.recovery_backup}.`;
    $<HTMLButtonElement>("#refresh").hidden = true;
  } catch (caught) {
    const error = requestError(caught);
    notice(
      "#restore-status",
      error.message +
        (error.uncertain
          ? " Sign in again and check the audit history before retrying; the connection may have failed after replacement."
          : ""),
      true,
    );
  } finally {
    restoring = false;
    busy(form, false, "Restore database");
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tab]"))
  button.addEventListener("click", () => selectTab(button.dataset.tab as Tab));
$<HTMLButtonElement>("#view-activity").addEventListener("click", () => selectTab("activity"));
$<HTMLButtonElement>("#refresh").addEventListener("click", refresh);
$<HTMLFormElement>("#player-search").addEventListener("submit", (event) => {
  event.preventDefault();
  playersPage = 1;
  loadPlayers().catch(report);
});
$<HTMLFormElement>("#activity-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  activityPage = 1;
  loadActivity().catch(report);
});
$<HTMLButtonElement>("#close-detail").addEventListener("click", () =>
  $<HTMLDialogElement>("#player-dialog").close(),
);
$<HTMLDialogElement>("#player-dialog").addEventListener("close", () => detailGeneration++);
(async () => {
  try {
    const user = await request<User>("/api/me");
    if (!user.admin) {
      denyAccess();
      return;
    }
    $("#admin-name").textContent = user.username;
    for (const input of document.querySelectorAll<HTMLInputElement>("[data-admin-username]"))
      input.value = user.username;
    await refresh();
  } catch (caught) {
    const error = requestError(caught);
    report(error);
  }
})();

export { request, loadPlayers, loadActivity };
