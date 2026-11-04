-- Application namespace: icb. Current definition of collector_input_receipts.
CREATE TABLE collector_input_receipts (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    collector_id uuid NOT NULL,
    sequence bigint NOT NULL,
    source_key text NOT NULL,
    digest text NOT NULL,
    occurred_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id,collector_id,sequence),
    UNIQUE(owner_id,source_key)
);
