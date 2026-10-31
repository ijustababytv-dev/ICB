-- Application namespace: icb. Current definition of resource_slot_progress.
CREATE TABLE resource_slot_progress (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    resource_id text NOT NULL,
    slot_id text NOT NULL,
    quantity bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id,resource_id,slot_id)
);
