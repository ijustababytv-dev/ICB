-- Application namespace: icb. Current definition of feature_changes.
CREATE TABLE feature_changes (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    revision bigint NOT NULL,
    feature text NOT NULL,
    snapshot jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id,revision,feature)
);
