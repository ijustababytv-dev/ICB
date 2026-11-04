-- Application namespace: icb. Current definition of giveaway_awards.
CREATE TABLE giveaway_awards (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id uuid NOT NULL,
    name_key text,
    source_key text NOT NULL,
    delta bigint NOT NULL,
    kind text NOT NULL,
    occurred_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id,id),
    UNIQUE(owner_id,source_key)
);
