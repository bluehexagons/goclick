package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"github.com/bluehexagons/goclick/internal/webapp"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databasePath := env("GOCLICK_DATABASE", "data/goclick.db")
	database, err := store.Open(databasePath)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	secureCookies, err := strconv.ParseBool(env("GOCLICK_SECURE_COOKIES", "false"))
	if err != nil {
		logger.Error("parse GOCLICK_SECURE_COOKIES", "error", err)
		os.Exit(1)
	}
	app, err := webapp.New(database, webapp.Config{
		SecureCookies: secureCookies,
		Logger:        logger,
	})
	if err != nil {
		logger.Error("create application", "error", err)
		os.Exit(1)
	}

	shutdownSignals, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go reapExpiredSessions(shutdownSignals, database, logger, 24*time.Hour, time.Now)

	server := &http.Server{
		Addr:              env("GOCLICK_ADDR", ":8080"),
		Handler:           app.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	go func() {
		<-shutdownSignals.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("graceful shutdown", "error", err)
		}
	}()

	logger.Info("Go Click listening", "address", server.Addr, "database", databasePath, "secure_cookies", secureCookies)
	err = server.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("serve", "error", err)
		os.Exit(1)
	}
}

type expiredSessionStore interface {
	DeleteExpiredSessions(context.Context, time.Time) error
}

func reapExpiredSessions(
	ctx context.Context,
	database expiredSessionStore,
	logger *slog.Logger,
	interval time.Duration,
	now func() time.Time,
) {
	cleanup := func() {
		cleanupContext, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err := database.DeleteExpiredSessions(cleanupContext, now()); err != nil && ctx.Err() == nil {
			logger.Warn("clean expired sessions", "error", err)
		}
	}

	cleanup()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanup()
		}
	}
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
