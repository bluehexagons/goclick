package store

import (
	"database/sql/driver"
	"encoding/binary"
	"fmt"
	"time"

	"modernc.org/sqlite"
)

func init() {
	// Register once before opening any databases, including replacement pooled
	// connections and read-only backups. These functions never change stored
	// timestamps or require schema objects in exported databases.
	// Raw text indexes cannot decide chronological ranges/order for mixed
	// formats. Wide date bounds can narrow candidates before exact comparison.
	// User-scoped sign-in lookups still use the existing partial index's
	// user_id prefix, then sort that user's sign-ins.
	registerTimestampFunction("goclick_time_key", func(t time.Time) driver.Value {
		// SQLite compares BLOBs bytewise. Flip the seconds' sign bit so negative
		// Unix seconds sort first, then compare the nanoseconds within a second.
		// UnixNano would overflow for otherwise accepted dates outside 1678–2262.
		key := make([]byte, 12)
		binary.BigEndian.PutUint64(key[:8], uint64(t.Unix())^(uint64(1)<<63))
		binary.BigEndian.PutUint32(key[8:], uint32(t.Nanosecond()))
		return key
	})
	registerTimestampFunction("goclick_utc_date", func(t time.Time) driver.Value {
		return dateKey(t)
	})
	registerTimestampFunction("goclick_date_ceiling", func(t time.Time) driver.Value {
		return timestampDateCeiling(t)
	})
}

// Every accepted timestamp starts with a four-digit local date. Go's parser
// accepts offsets up to 25 hours (including 24:60), so that date can differ
// from the UTC date by two days. These deliberately wide, indexable bounds
// only select candidates; goclick_time_key still decides the exact result.
func timestampDateFloor(t time.Time) string {
	day := t.UTC().AddDate(0, 0, -2)
	if day.Year() < 0 || day.Year() > 9999 {
		return ""
	}
	return dateKey(day)
}

func timestampDateCeiling(t time.Time) string {
	day := t.UTC().AddDate(0, 0, 3)
	if day.Year() < 0 || day.Year() > 9999 {
		// All accepted timestamps start with an ASCII digit.
		return ":"
	}
	return dateKey(day)
}

func registerTimestampFunction(name string, convert func(time.Time) driver.Value) {
	sqlite.MustRegisterDeterministicScalarFunction(name, 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		// Preserve NULL for players who have never clicked.
		if args[0] == nil {
			return nil, nil
		}
		value, ok := args[0].(string)
		if !ok {
			return nil, fmt.Errorf("%s requires a text timestamp", name)
		}
		parsed, err := parseTime(value)
		if err != nil {
			return nil, err
		}
		return convert(parsed), nil
	})
}
