-- Application namespace: icb. Current definition of feature_migrations.
CREATE TABLE feature_migrations (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    source_sha256 text NOT NULL,
    cutover_at timestamptz NOT NULL,
    input_watermark text NOT NULL,
    revision bigint NOT NULL,
    source_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY(owner_id,feature)
);
