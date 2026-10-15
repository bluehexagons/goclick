export interface User {
  id: number;
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
export type Counters = Partial<Record<CounterKind, Counter | null>>;
export type ResponseState = "saved" | "fast" | "slow" | "error";
export interface Activation {
  detail: number;
  clientX: number;
  clientY: number;
}
export interface ButtonState {
  x: number;
  y: number;
  rx: number;
  ry: number;
  press: number;
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
  id: number;
  user_id: number;
  username: string;
  action: string;
  occurred_at: string;
  click_count: number | null;
}
export interface Audit {
  id: number;
  actor_username: string;
  action: string;
  result: string;
  occurred_at: string;
}
export interface ArchivedEntity {
  id: number;
  user_id: number;
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
  source_format?: string;
  admin_username?: string;
  new_passwords_required?: boolean;
}
