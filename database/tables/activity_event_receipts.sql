-- Current definition of activity_event_receipts; apply live changes through a new migration.
CREATE TABLE activity_event_receipts (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    event_id uuid NOT NULL,
    PRIMARY KEY(owner_id, event_id)
);
