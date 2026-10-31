-- Application namespace: icb. Current definition of resource_progress.
CREATE TABLE resource_progress (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    resource_id text NOT NULL,
    quantity bigint NOT NULL DEFAULT 0,
    secondary_quantity bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id,resource_id)
);
