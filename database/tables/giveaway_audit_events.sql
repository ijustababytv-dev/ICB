-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of giveaway_audit_events; apply live changes through a new migration.
CREATE TABLE giveaway_audit_events (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    event_id uuid NOT NULL,
    viewer_id uuid,
    type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    reporting_date date NOT NULL,
    timezone text NOT NULL,
    ticket_delta bigint DEFAULT 0,
    action_id uuid NOT NULL,
    PRIMARY KEY(owner_id, event_id),
    FOREIGN KEY(owner_id, viewer_id) REFERENCES viewers(owner_id, id)
);
