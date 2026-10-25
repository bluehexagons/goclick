package store

import "context"

type StorageStats struct {
	DatabaseBytes    int64   `json:"database_bytes"`
	ReusableBytes    int64   `json:"reusable_bytes"`
	ActivityRecords  int64   `json:"activity_records"`
	AuditRecords     int64   `json:"audit_records"`
	OldestActivityAt *string `json:"oldest_activity_at"`
}

// Storage reports the main database's logical allocation, including committed
// pages still in WAL. This is not a filesystem usage or exact export-size
// measurement: WAL/SHM sidecars are additional, and VACUUM INTO compacts exports.
func (s *Store) Storage(ctx context.Context) (StorageStats, error) {
	var out StorageStats
	// The chronological minimum cannot be later than the raw text minimum.
	// Its conservative date ceiling includes every instant at or before that
	// anchor, so the time index can narrow the exact sort without losing the
	// oldest record. An empty history leaves both the anchor and result NULL.
	err := s.db.QueryRowContext(ctx, `SELECT
		page_count * page_size, freelist_count * page_size,
		(SELECT COUNT(*) FROM player_activity),
		(SELECT COUNT(*) FROM admin_audit),
		(SELECT occurred_at FROM player_activity
		 WHERE occurred_at < (SELECT goclick_date_ceiling(MIN(occurred_at)) FROM player_activity)
		 ORDER BY goclick_time_key(occurred_at) LIMIT 1)
		FROM pragma_page_count, pragma_page_size, pragma_freelist_count`).Scan(
		&out.DatabaseBytes, &out.ReusableBytes, &out.ActivityRecords, &out.AuditRecords, &out.OldestActivityAt)
	return out, err
}
