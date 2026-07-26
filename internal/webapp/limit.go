package webapp

import (
	"sync"
	"time"
)

type limitEntry struct {
	count int
	reset time.Time
}

type limiter struct {
	mu      sync.Mutex
	entries map[string]limitEntry
	now     func() time.Time
}

func newLimiter(now func() time.Time) *limiter {
	return &limiter{entries: make(map[string]limitEntry), now: now}
}

func (l *limiter) allow(key string, maximum int, window time.Duration) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	entry, exists := l.entries[key]
	if !exists || !now.Before(entry.reset) {
		l.entries[key] = limitEntry{count: 1, reset: now.Add(window)}
		l.prune(now)
		return true, 0
	}
	if entry.count >= maximum {
		return false, entry.reset.Sub(now)
	}
	entry.count++
	l.entries[key] = entry
	return true, 0
}

func (l *limiter) prune(now time.Time) {
	if len(l.entries) < 10_000 {
		return
	}
	for key, entry := range l.entries {
		if !now.Before(entry.reset) {
			delete(l.entries, key)
		}
	}
	// Keep attacker-controlled keys from growing memory without bound.
	if len(l.entries) > 50_000 {
		clear(l.entries)
	}
}
