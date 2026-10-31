-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of state_import_runs; apply live changes through a new migration.
CREATE TABLE state_import_runs (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    source_sha256 text NOT NULL,
    state_key text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id,state_key,source_sha256)
);
