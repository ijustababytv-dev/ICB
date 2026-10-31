-- Application namespace: icb. Current definition of steam_achievements.
CREATE TABLE steam_achievements (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    app_id text NOT NULL,
    achievement_id text NOT NULL,
    details jsonb NOT NULL,
    unlocked_at timestamptz,
    PRIMARY KEY(owner_id,app_id,achievement_id)
);
