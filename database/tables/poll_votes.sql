-- Application namespace: icb. Current definition of poll_votes.
CREATE TABLE poll_votes (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    name_key text NOT NULL,
    option_id text NOT NULL,
    display_name text NOT NULL,
    subscriber boolean NOT NULL,
    occurred_at bigint NOT NULL,
    PRIMARY KEY(owner_id,name_key,option_id)
);
