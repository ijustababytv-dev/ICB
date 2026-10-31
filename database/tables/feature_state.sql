-- Current definition of feature_state; apply live changes through a new migration.
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
