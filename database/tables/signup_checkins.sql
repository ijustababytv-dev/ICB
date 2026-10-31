-- Application namespace: icb. Current definition of signup_checkins.
CREATE TABLE signup_checkins (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    event_id text NOT NULL,
    name_key text NOT NULL,
    checked_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id,feature,event_id,name_key)
);
