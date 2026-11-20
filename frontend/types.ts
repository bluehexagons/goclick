export interface User {
  id: string;
  username: string;
  email: string | null;
  admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Counter {
  count: number;
  modified_time: string | null;
}
export const counterKinds = [
  "click_count",
  "streak_counter_day",
  "streak_counter_month",
  "streak_counter_year",
] as const;
export type CounterKind = (typeof counterKinds)[number];
export interface ClickProgress {
  recent_days: number;
  week_streak: number;
  best_day_streak: number;
  best_week_streak: number;
}
export interface ClickAchievements {
  day_clicks: number;
  week_clicks: number;
  month_clicks: number;
  hours: number;
  active_days: number;
  active_months: number;
  earned: number;
}
export type Counters = Partial<Record<CounterKind, Counter | null>> & {
  progress?: ClickProgress;
  achievements?: ClickAchievements;
};
export interface GameState {
  user: User;
  counters: Counters;
}
export type ResponseState = "saved" | "fast" | "slow" | "error" | "pending" | "limited";
export interface Activation {
  detail: number;
  clientX: number;
  clientY: number;
}
export interface ButtonState {
  reducedMotion?: boolean;
  powered?: boolean;
  holdLight?: number;
  drainLight?: number;
  bootLight?: number;
  labelCharge?: number;
  labelPhase?: number;
  x: number;
  y: number;
  rx: number;
  ry: number;
  press: number;
  copper: number;
  pop: number;
  flash: number;
  response: number;
  responseProgress: number;
  responseColor: [number, number, number];
}
export interface ButtonController {
  reset(cancelled?: boolean): void;
  respond(state: ResponseState, milliseconds?: number): void;
}
export interface Renderer {
  draw(state?: ButtonState): void;
}

export interface Page<T> {
  items: T[];
  total: number;
}
export interface AdminPlayer extends User {
  clicks: number;
  day_streak: number;
  month_streak: number;
  year_streak: number;
  last_clicked_at: string | null;
  last_sign_in_at: string | null;
}
export interface Activity {
  id: string;
  user_id: string;
  username: string;
  action: string;
  occurred_at: string;
  click_count: number | null;
}
export interface Audit {
  id: string;
  actor_username: string;
  action: string;
  result: string;
  occurred_at: string;
}
export interface ArchivedEntity {
  id: string;
  user_id: string;
  kind: string | null;
  count: number | null;
  created_time: string | null;
  modified_time: string | null;
  created_at: string | null;
  updated_at: string | null;
  source: string;
}
export interface Overview {
  players: number;
  admins: number;
  clicks: number;
  active_players_24h: number;
  active_sessions: number;
  clicks_24h: number;
  daily_clicks: { date: string; clicks: number }[];
}
export interface StorageStats {
  database_bytes: number;
  reusable_bytes: number;
  activity_records: number;
  oldest_activity_at: string | null;
  audit_records: number;
  restore_limit_bytes: number;
  recovery_snapshots: {
    count: number;
    bytes: number;
    oversized: number;
    oldest_at: string | null;
  } | null;
}
export interface RecoveryResult {
  users: number;
  entities: number;
  recovery_backup: string;
}
