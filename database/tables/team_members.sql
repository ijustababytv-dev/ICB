-- Application namespace: icb. Current definition of team_members.
CREATE TABLE team_members (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    name_key text NOT NULL,
    display_name text NOT NULL,
    team_id text,
    score bigint NOT NULL DEFAULT 0,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,name_key)
);
