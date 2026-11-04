-- Application namespace: icb. Current definition of feature_commands.
CREATE TABLE feature_commands (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    command_id uuid NOT NULL,
    digest text NOT NULL,
    revision bigint NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id,feature,command_id)
);
