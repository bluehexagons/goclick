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
	// Raw text indexes cannot satisfy chronological ranges/order for mixed
	// formats: queries must inspect candidate timestamps. User-scoped sign-in
	// lookups still use the existing partial index's user_id prefix, then sort
	// that user's sign-ins. Do not prefilter by text and exclude valid instants.
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
