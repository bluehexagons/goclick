package store

import (
	"context"
	"database/sql"
	"fmt"
)

// ButtonAchievements is the persisted mask of earned button badges.
type ButtonAchievements uint8

const (
	ReconnectedPlug ButtonAchievements = 1 << iota
	SlackCordClick
	ResetOutlet
	Rebound
	HoldThatThought

	ClickButtonAchievementMask = SlackCordClick | Rebound | HoldThatThought
)

var buttonAchievementSchemaTable = schemaTable{"button_achievements", []string{"user_id", "earned"}}

func (s *Store) RecordButtonAchievement(ctx context.Context, userID int64, earned ButtonAchievements) (ButtonAchievements, error) {
	if earned != ReconnectedPlug && earned != ResetOutlet {
		return 0, fmt.Errorf("invalid standalone button achievement %d", earned)
	}
	return saveButtonAchievement(ctx, s.db, userID, earned)
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
