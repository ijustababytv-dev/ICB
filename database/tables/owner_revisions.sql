-- Application namespace: icb. Current definition of owner_revisions.
CREATE TABLE owner_revisions (
    owner_id uuid NOT NULL REFERENCES accounts(id) PRIMARY KEY,
    revision bigint NOT NULL DEFAULT 0,
    active_at timestamptz NOT NULL DEFAULT now()
);
