-- Application namespace: icb. Current definition of signup_events.
CREATE TABLE signup_events (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    id text NOT NULL,
    position integer NOT NULL,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,feature,id)
);
