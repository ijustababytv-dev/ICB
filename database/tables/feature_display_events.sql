-- Application namespace: icb. Current definition of feature_display_events.
CREATE TABLE feature_display_events (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id uuid NOT NULL,
    revision bigint NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id,id)
);
