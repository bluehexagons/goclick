package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"
)

type recordingSessionStore struct {
	mu    sync.Mutex
	calls []time.Time
}

func TestServeWaitsForActiveRequestsDuringShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	started := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseRequest := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseRequest()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "finished")
	})}
	defer server.Close()
	shutdownStarted := make(chan struct{})
	server.RegisterOnShutdown(func() { close(shutdownStarted) })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	done := make(chan error, 1)
	go func() { done <- serve(ctx, server, listener, logger) }()
	requestDone := make(chan error, 1)
	go func() {
		client := &http.Client{Timeout: 5 * time.Second}
		response, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			defer response.Body.Close()
			var body []byte
			body, err = io.ReadAll(response.Body)
			if err == nil && string(body) != "finished" {
				err = errors.New("request did not finish")
			}
		}
		requestDone <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case <-shutdownStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not start")
	}
	select {
	case err := <-done:
		t.Fatalf("server returned while request was active: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	releaseRequest()
	select {
	case err := <-requestDone:
		if err != nil {
			t.Fatalf("active request failed during shutdown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("request did not finish")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("shutdown returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not finish shutdown")
	}
}

func TestServeReturnsListenerFailureWithoutWaitingForSignal(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	listener.Close()
	done := make(chan error, 1)
	go func() {
		done <- serve(context.Background(), &http.Server{}, listener, slog.New(slog.NewTextHandler(io.Discard, nil)))
	}()
	select {
	case err := <-done:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatalf("listener failure = %v, want net.ErrClosed", err)
		}
	case <-time.After(time.Second):
		t.Fatal("server hung after listener failure")
	}
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
