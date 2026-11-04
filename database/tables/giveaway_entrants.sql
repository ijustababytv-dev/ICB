-- Application namespace: icb. Current definition of giveaway_entrants.
CREATE TABLE giveaway_entrants (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    name_key text NOT NULL,
    name text NOT NULL,
    tickets bigint NOT NULL DEFAULT 0 CHECK(tickets>=0),
    bits bigint NOT NULL DEFAULT 0,
    months bigint NOT NULL DEFAULT 0,
    gifts bigint NOT NULL DEFAULT 0,
    notes text NOT NULL DEFAULT '',
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,name_key)
);
