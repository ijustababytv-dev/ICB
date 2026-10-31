-- Application namespace: icb. Current definition of signup_entries.
CREATE TABLE signup_entries (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    event_id text NOT NULL,
    id text NOT NULL,
    name_key text NOT NULL,
    display_name text NOT NULL,
    position integer NOT NULL,
    checked_in boolean NOT NULL DEFAULT false,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,feature,event_id,id),
    FOREIGN KEY(owner_id,feature,event_id) REFERENCES signup_events(owner_id,feature,id) ON DELETE CASCADE
);
