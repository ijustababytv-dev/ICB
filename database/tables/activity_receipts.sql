-- Current definition of activity_receipts; apply live changes through a new migration.
CREATE TABLE activity_receipts (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    batch_id uuid NOT NULL,
    digest text NOT NULL,
    collector_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id, batch_id)
);
