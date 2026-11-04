-- Application namespace: icb. A collector boot is explicit, not a Lambda initialization event.
CREATE TABLE game_sessions (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    session_id uuid NOT NULL,
    collector_id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    PRIMARY KEY(owner_id,session_id)
);
