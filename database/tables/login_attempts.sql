-- Current definition of login_attempts; apply live changes through a new migration.
CREATE TABLE login_attempts (
    attempt_key text PRIMARY KEY,
    failures integer NOT NULL,
    expires_at timestamptz NOT NULL
);
