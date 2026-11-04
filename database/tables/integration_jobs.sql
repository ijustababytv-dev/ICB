-- Application namespace: icb. Current definition of integration_jobs.
CREATE TABLE integration_jobs (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    kind text NOT NULL,
    due_at timestamptz NOT NULL,
    lease_token uuid,
    lease_until timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    PRIMARY KEY(owner_id,kind)
);
