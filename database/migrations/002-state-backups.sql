-- The local runtime stays authoritative in Step 1. These are recoverable owner-scoped
-- copies, not another engine that mutates live trackers or awards giveaway tickets.
CREATE TABLE feature_state (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    state_key text NOT NULL,
    revision bigint NOT NULL,
    sha256 text NOT NULL,
    payload jsonb NOT NULL,
    captured_at timestamptz NOT NULL,
    collector_id uuid NOT NULL,
    PRIMARY KEY(owner_id,state_key)
);
CREATE TABLE state_import_runs (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    source_sha256 text NOT NULL,
    state_key text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id,state_key,source_sha256)
);
