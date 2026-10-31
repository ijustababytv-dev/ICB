-- Application namespace: icb. Current definition of turn_entries.
CREATE TABLE turn_entries (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id bigint NOT NULL,
    entry_uuid uuid NOT NULL,
    round_id uuid NOT NULL,
    name text NOT NULL,
    state text NOT NULL CHECK(state IN ('wait','go','done')),
    position integer NOT NULL,
    PRIMARY KEY(owner_id,id),
    FOREIGN KEY(owner_id,round_id) REFERENCES turn_rounds(owner_id,id)
);
