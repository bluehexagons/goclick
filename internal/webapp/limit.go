package webapp

import (
	"sync"
	"time"
)

const maxLimiterEntries = 50_000

type limitEntry struct {
	count int
	reset time.Time
}

type limiter struct {
	mu      sync.Mutex
	entries map[string]limitEntry
	now     func() time.Time
	pruneAt time.Time
}

func newLimiter(now func() time.Time) *limiter {
	return &limiter{entries: make(map[string]limitEntry), now: now}
}

func (l *limiter) allow(key string, maximum int, window time.Duration) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if !now.Before(l.pruneAt) {
		l.prune(now)
		l.pruneAt = now.Add(time.Minute)
	}

	entry, exists := l.entries[key]
	if !exists || !now.Before(entry.reset) {
		// Never clear active limits to make room for attacker-controlled keys.
		// Existing clients retain their budgets; new keys wait for cleanup.
		if !exists && len(l.entries) >= maxLimiterEntries {
			return false, l.pruneAt.Sub(now)
		}
		l.entries[key] = limitEntry{count: 1, reset: now.Add(window)}
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
	for key, entry := range l.entries {
		if !now.Before(entry.reset) {
			delete(l.entries, key)
		}
	}
}
