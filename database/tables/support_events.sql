-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of support_events; apply live changes through a new migration.
CREATE TABLE support_events (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    event_id uuid NOT NULL,
    viewer_id uuid,
    platform text NOT NULL,
    type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    reporting_date date NOT NULL,
    timezone text NOT NULL,
    source_event_id text,
    quantity bigint,
    months bigint,
    bits bigint,
    money_minor bigint,
    currency text,
    tier text,
    subtype text,
    anonymous boolean NOT NULL DEFAULT false,
    raid_size bigint,
    ticket_delta bigint DEFAULT 0,
    PRIMARY KEY(owner_id, event_id),
    FOREIGN KEY(owner_id, viewer_id) REFERENCES viewers(owner_id, id)
);
