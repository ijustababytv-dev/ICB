-- Application namespace: icb. Current definition of weekly_progress.
CREATE TABLE weekly_progress (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    goal_id text NOT NULL,
    week_start text NOT NULL,
    quantity bigint NOT NULL DEFAULT 0,
    done boolean NOT NULL DEFAULT false,
    PRIMARY KEY(owner_id,goal_id)
);
