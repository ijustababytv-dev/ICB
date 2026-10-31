-- Application namespace: icb. Current definition of feature_timers.
CREATE TABLE feature_timers (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    id text NOT NULL,
    position integer NOT NULL,
    ends_at bigint,
    paused_ms bigint NOT NULL DEFAULT 0,
    status text NOT NULL,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,feature,id)
);
