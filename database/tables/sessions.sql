-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of sessions; apply live changes through a new migration.
CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked boolean NOT NULL DEFAULT false
);
