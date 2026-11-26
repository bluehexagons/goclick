package store

import (
	"context"
	"database/sql"
	"fmt"
)

// ButtonAchievements tracks earned button gestures and individual socket visits.
type ButtonAchievements uint8

const (
	ReconnectedPlug ButtonAchievements = 1 << iota
	SlackCordClick
	ResetOutlet
	Rebound
	HoldThatThought
	OffGrid
	TopSocket
	BottomSocket

	ClickButtonAchievementMask = SlackCordClick | Rebound | HoldThatThought | OffGrid
	bothSockets                = TopSocket | BottomSocket
)

var buttonAchievementSchemaTable = schemaTable{"button_achievements", []string{"user_id", "earned"}}

func (s *Store) RecordButtonAchievement(ctx context.Context, userID int64, earned ButtonAchievements) (ButtonAchievements, error) {
	switch earned {
	case ReconnectedPlug, ResetOutlet, ReconnectedPlug | TopSocket, ReconnectedPlug | BottomSocket:
		return saveButtonAchievement(ctx, s.db, userID, earned)
	default:
		return 0, fmt.Errorf("invalid standalone button achievement %d", earned)
	}
}

func saveButtonAchievement(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, userID int64, earned ButtonAchievements) (ButtonAchievements, error) {
	var result ButtonAchievements
	err := db.QueryRowContext(ctx, `
		INSERT INTO button_achievements (user_id,earned) VALUES (?,?)
		ON CONFLICT(user_id) DO UPDATE SET earned=button_achievements.earned | excluded.earned
		RETURNING earned`, userID, earned).Scan(&result)
	if err != nil {
		return 0, fmt.Errorf("save button achievement: %w", err)
	}
	return result, nil
}
