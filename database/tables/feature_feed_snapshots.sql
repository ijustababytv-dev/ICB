-- Application namespace: icb. Current definition of feature_feed_snapshots.
CREATE TABLE feature_feed_snapshots (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    token uuid NOT NULL,
    watermark bigint NOT NULL,
    page integer NOT NULL,
    payload jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id,token,page)
);
