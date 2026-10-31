-- Application namespace: icb. Current definition of hunt_players.
CREATE TABLE hunt_players (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    name_key text NOT NULL,
    display_name text NOT NULL,
    team_id text,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,name_key)
);
