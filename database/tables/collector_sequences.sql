-- Application namespace: icb. Current definition of collector_sequences.
CREATE TABLE collector_sequences (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    collector_id uuid NOT NULL,
    sequence bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id,collector_id)
);
