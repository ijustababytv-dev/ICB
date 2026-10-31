-- Application namespace: icb. Current definition of turn_entries.
CREATE TABLE turn_entries (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id bigint NOT NULL,
    name text NOT NULL,
    state text NOT NULL CHECK(state IN ('wait','go','done')),
    position integer NOT NULL,
    PRIMARY KEY(owner_id,id)
);
