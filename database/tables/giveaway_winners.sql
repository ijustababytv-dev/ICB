-- Application namespace: icb. Current definition of giveaway_winners.
CREATE TABLE giveaway_winners (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id text NOT NULL,
    position integer NOT NULL,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,id)
);
