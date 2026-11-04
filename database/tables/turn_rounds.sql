CREATE TABLE turn_rounds (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    PRIMARY KEY(owner_id,id)
);
