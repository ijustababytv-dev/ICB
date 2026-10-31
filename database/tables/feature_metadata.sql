-- Operational feature metadata is separate from presentation settings and entity progress.
CREATE TABLE feature_metadata (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
    PRIMARY KEY(owner_id,feature)
);
