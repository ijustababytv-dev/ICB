-- Current definition of source_event_receipts; apply live changes through a new migration.
CREATE TABLE source_event_receipts (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    platform text NOT NULL,
    source_event_id text NOT NULL,
    type text NOT NULL,
    PRIMARY KEY(owner_id, platform, source_event_id, type)
);
