-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of collector_leases; apply live changes through a new migration.
CREATE TABLE collector_leases (
    owner_id uuid PRIMARY KEY REFERENCES accounts(id),
    collector_id uuid NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
