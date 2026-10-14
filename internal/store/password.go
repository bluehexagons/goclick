package store

import (
	"context"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// SetPassword is operator-only: imported JSON accounts contain no portable
// credentials. Never expose this operation as an unauthenticated claim flow.
func (s *Store) SetPassword(ctx context.Context, userID int64, password string, now time.Time) error {
	if len(password) < 8 || len(password) > 72 {
		return errors.New("password must be 8–72 bytes")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE users SET password_hash=?,updated_at=? WHERE id=?`, string(hash), formatTime(now), userID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=?`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO admin_audit(actor_username,action,target_user_id,result,details,occurred_at) VALUES ('operator','password_set',?,'success','',?)`, userID, formatTime(now)); err != nil {
		return err
	}
	return tx.Commit()
}
