package webapp

import (
	"strconv"
	"testing"
	"time"
)

func TestLimiterCapacityPreservesActiveLimits(t *testing.T) {
	now := time.Now()
	l := newLimiter(func() time.Time { return now })
	if allowed, _ := l.allow("protected", 1, time.Minute); !allowed {
		t.Fatal("initial request denied")
	}
	for i := 1; i < maxLimiterEntries; i++ {
		if allowed, _ := l.allow(strconv.Itoa(i), 2, time.Minute); !allowed {
			t.Fatal("request denied before capacity was reached")
		}
	}
	if allowed, retry := l.allow("overflow", 1, time.Minute); allowed || retry <= 0 {
		t.Fatalf("overflow request = %v, retry=%v", allowed, retry)
	}
	if len(l.entries) != maxLimiterEntries {
		t.Fatalf("entry count = %d, want %d", len(l.entries), maxLimiterEntries)
	}
	if allowed, _ := l.allow("protected", 1, time.Minute); allowed {
		t.Fatal("capacity exhaustion reset an active rate limit")
	}
	if allowed, _ := l.allow("1", 2, time.Minute); !allowed {
		t.Fatal("capacity exhaustion blocked an existing client's remaining budget")
	}
	now = now.Add(time.Minute)
	if allowed, _ := l.allow("overflow", 1, time.Minute); !allowed {
		t.Fatal("expired entries did not free capacity")
	}
	if len(l.entries) != 1 {
		t.Fatalf("expired entries were retained: %d", len(l.entries))
	}
}
