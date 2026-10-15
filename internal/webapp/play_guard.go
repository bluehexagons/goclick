package webapp

import (
	"math"
	"sync"
	"time"
)

// This is deliberately a soft friction check, not proof that someone is a bot.
// Only server receipt times are used. No fingerprints or client claims are
// trusted, and cooldowns expire without changing accounts or saved progress.
type playActivity struct {
	first, last, regularSince, blockedUntil time.Time
	clicks, intervals                       int
	mean, m2                                float64
}

type playGuard struct {
	mu      sync.Mutex
	entries map[int64]playActivity
	pruneAt time.Time
}

func newPlayGuard() *playGuard { return &playGuard{entries: make(map[int64]playActivity)} }

func (g *playGuard) allow(id int64, now time.Time) (time.Duration, string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !now.Before(g.pruneAt) {
		for id, entry := range g.entries {
			if now.Sub(entry.last) >= 10*time.Minute && !now.Before(entry.blockedUntil) {
				delete(g.entries, id)
			}
		}
		g.pruneAt = now.Add(time.Minute)
	}
	entry, exists := g.entries[id]
	if now.Before(entry.blockedUntil) {
		return entry.blockedUntil.Sub(now), ""
	}
	if !exists && len(g.entries) >= maxLimiterEntries {
		return time.Minute, "capacity"
	}
	if !exists || now.Sub(entry.last) >= 15*time.Second || now.Before(entry.last) || !entry.blockedUntil.IsZero() {
		g.entries[id] = playActivity{first: now, last: now, regularSince: now, clicks: 1}
		return 0, ""
	}
	interval := now.Sub(entry.last)
	entry.last = now
	entry.clicks++
	// Batches and short bursts are normal, especially with several fingers. They
	// break the regular-cadence sample rather than looking like a perfect timer.
	if interval < 50*time.Millisecond || interval > 5*time.Second {
		entry.regularSince, entry.intervals, entry.mean, entry.m2 = now, 0, 0, 0
	} else {
		entry.intervals++
		value := interval.Seconds()
		delta := value - entry.mean
		entry.mean += delta / float64(entry.intervals)
		entry.m2 += delta * (value - entry.mean)
	}
	var retry time.Duration
	var reason string
	if entry.intervals >= 240 && now.Sub(entry.regularSince) >= 5*time.Minute &&
		math.Sqrt(math.Max(0, entry.m2)/float64(entry.intervals))/entry.mean <= .04 {
		retry, reason = 15*time.Second, "regular_cadence"
	} else if now.Sub(entry.first) >= 45*time.Minute && entry.clicks >= 1200 {
		retry, reason = 30*time.Second, "uninterrupted_activity"
	}
	if retry > 0 {
		entry.blockedUntil = now.Add(retry)
	}
	g.entries[id] = entry
	return retry, reason
}
