package webapp

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestPlayGuardRegularCadenceIsTemporaryAndAccountBound(t *testing.T) {
	g := newPlayGuard()
	now := time.Now()
	for i := 0; i < 300; i++ {
		if retry, _ := g.allow(1, now.Add(time.Duration(i)*time.Second)); retry != 0 {
			t.Fatalf("premature cooldown at %d", i)
		}
	}
	now = now.Add(300 * time.Second)
	if retry, reason := g.allow(1, now); retry != 15*time.Second || reason != "regular_cadence" {
		t.Fatalf("cooldown = %v %q", retry, reason)
	}
	if retry, reason := g.allow(1, now.Add(time.Second)); retry != 14*time.Second || reason != "" {
		t.Fatalf("repeated rejection changed cooldown: %v %q", retry, reason)
	}
	if retry, _ := g.allow(2, now); retry != 0 {
		t.Fatal("another account inherited the cooldown")
	}
	if retry, _ := g.allow(1, now.Add(15*time.Second)); retry != 0 {
		t.Fatal("cooldown did not expire")
	}
}

func TestPlayGuardAllowsIrregularPlayBurstsAndBreaks(t *testing.T) {
	for _, mode := range []string{"irregular", "bursts", "breaks"} {
		t.Run(mode, func(t *testing.T) {
			g := newPlayGuard()
			now := time.Now()
			for i := 0; i < 1500; i++ {
				switch mode {
				case "irregular":
					now = now.Add(time.Duration(100+i%17*53) * time.Millisecond)
				case "bursts":
					if i%4 == 0 {
						now = now.Add(time.Second)
					}
				case "breaks":
					if i%200 == 0 {
						now = now.Add(20 * time.Second)
					} else {
						now = now.Add(time.Second)
					}
				}
				if retry, reason := g.allow(1, now); retry != 0 {
					t.Fatalf("normal %s play paused: %v %q", mode, retry, reason)
				}
			}
		})
	}
}

func TestPlayGuardUninterruptedActivityAndBoundedMemory(t *testing.T) {
	g := newPlayGuard()
	now := time.Now()
	for i := 0; i < 1199; i++ {
		// Uneven intervals avoid the regular-cadence rule, with no 15-second break.
		if retry, _ := g.allow(1, now); retry != 0 {
			t.Fatal("premature pause")
		}
		now = now.Add(time.Duration(2+i%2) * time.Second)
	}
	if retry, reason := g.allow(1, now); retry != 30*time.Second || reason != "uninterrupted_activity" {
		t.Fatalf("long activity: %v %s", retry, reason)
	}
	for id := int64(2); id <= maxLimiterEntries; id++ {
		g.allow(id, now)
	}
	if retry, reason := g.allow(maxLimiterEntries+1, now); retry <= 0 || reason != "capacity" {
		t.Fatal("guard memory is unbounded")
	}
	if len(g.entries) != maxLimiterEntries {
		t.Fatal("guard exceeded capacity")
	}
	// Expiry prunes old accounts without resetting an active cooldown.
	now = now.Add(11 * time.Minute)
	if retry, _ := g.allow(maxLimiterEntries+1, now); retry != 0 {
		t.Fatal("expired entries kept capacity")
	}
	if len(g.entries) != 1 {
		t.Fatal("inactive entries were retained")
	}
}

func TestPlayGuardConcurrentBursts(t *testing.T) {
	g := newPlayGuard()
	now := time.Now()
	var wg sync.WaitGroup
	for range 100 {
		wg.Go(func() {
			if retry, _ := g.allow(1, now); retry != 0 {
				t.Error("concurrent burst rejected")
			}
		})
	}
	wg.Wait()
}

func TestActivityCooldownRejectsBeforeMutationAndAllowsRecovery(t *testing.T) {
	app, db, client, id := adminTestApp(t)
	now := time.Now().UTC()
	app.now = func() time.Time { return now }
	app.limiter.now = app.now
	app.playGuard.entries[id] = playActivity{first: now.Add(-5 * time.Minute), last: now.Add(-time.Second), regularSince: now.Add(-5 * time.Minute), clicks: 300, intervals: 299, mean: 1}
	for _, path := range []string{"/api/clicks", "/entities/increment"} {
		response := jsonRequest(t, client, "POST", "http://goclick.test"+path, nil, nil)
		if response.StatusCode != 429 || response.Header.Get("Retry-After") != "15" {
			t.Fatalf("cooldown: %d %s", response.StatusCode, readBody(t, response))
		}
		response.Body.Close()
	}
	counters, err := db.CurrentCounters(context.Background(), id)
	if err != nil || counters.Exists {
		t.Fatalf("rejected clicks changed progress: %+v %v", counters, err)
	}
	now = now.Add(15 * time.Second)
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, nil)
	var result entitiesResponse
	decodeResponse(t, response, &result)
	if result.ClickCount == nil || result.ClickCount.Count != 1 {
		t.Fatalf("recovery: %+v", result)
	}
}

func TestConfigurableClickBudgetAndValidation(t *testing.T) {
	app, db, client, _ := adminTestApp(t)
	app.clicksPerMinute = 2
	for i := 1; i <= 3; i++ {
		response := jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, nil)
		want := http.StatusOK
		if i == 3 {
			want = 429
		}
		if response.StatusCode != want {
			t.Fatalf("click %d: %d", i, response.StatusCode)
		}
		if i == 3 {
			if seconds, _ := strconv.Atoi(response.Header.Get("Retry-After")); seconds < 1 {
				t.Fatal("missing retry deadline")
			}
		}
		response.Body.Close()
	}
	for _, config := range []Config{{ClicksPerMinute: -1}, {ClicksPerIPMinute: -1}, {ClicksPerMinute: 1000001}} {
		if _, err := New(db, config); err == nil {
			t.Fatal("invalid click budget accepted")
		}
	}
}

func TestCustomIPBudgetAlsoCoversLegacyClicks(t *testing.T) {
	app, _, client, _ := adminTestApp(t)
	app.clicksPerIPMinute = 2
	for i, path := range []string{"/api/clicks", "/entities/increment", "/api/clicks"} {
		response := jsonRequest(t, client, "POST", "http://goclick.test"+path, nil, nil)
		want := 200
		if i == 2 {
			want = 429
		}
		if response.StatusCode != want {
			t.Fatalf("request %d: %d", i, response.StatusCode)
		}
		response.Body.Close()
	}
}
