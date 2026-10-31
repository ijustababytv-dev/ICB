-- Application namespace: icb. Current definition of feature_undo.
CREATE TABLE feature_undo (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    id uuid NOT NULL,
    backup_name text NOT NULL,
    before_state jsonb NOT NULL,
    after_revision bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id,feature,id),
    UNIQUE(owner_id,feature,backup_name)
);
