package main

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

type recordingSessionStore struct {
	mu    sync.Mutex
	calls []time.Time
}

func (store *recordingSessionStore) DeleteExpiredSessions(_ context.Context, now time.Time) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.calls = append(store.calls, now)
	return nil
}

func (store *recordingSessionStore) callCount() int {
	store.mu.Lock()
	defer store.mu.Unlock()
	return len(store.calls)
}

func TestReapExpiredSessionsRunsImmediatelyAndPeriodically(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	database := &recordingSessionStore{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	done := make(chan struct{})

	go func() {
		reapExpiredSessions(ctx, database, logger, 5*time.Millisecond, time.Now)
		close(done)
	}()

	deadline := time.After(time.Second)
	for database.callCount() < 2 {
		select {
		case <-deadline:
			t.Fatalf("cleanup calls = %d, want at least 2", database.callCount())
		case <-time.After(time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("session reaper did not stop after cancellation")
	}
}
