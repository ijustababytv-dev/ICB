-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of collector_history; apply live changes through a new migration.
CREATE TABLE collector_history (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    collector_id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id, collector_id, started_at)
);
