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
	if err := database.DeleteExpiredSessions(context.Background(), time.Now()); err != nil {
		logger.Warn("clean expired sessions", "error", err)
	}

	server := &http.Server{
		Addr:              env("GOCLICK_ADDR", ":8080"),
		Handler:           app.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	shutdownSignals, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
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

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
