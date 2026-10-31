-- Compact replay protection; no original game log line is retained.
CREATE TABLE game_event_receipts (
    owner_id uuid NOT NULL,
    source_key text NOT NULL,
    digest text NOT NULL,
    collector_id uuid NOT NULL,
    session_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id,source_key),
    FOREIGN KEY(owner_id,session_id) REFERENCES game_sessions(owner_id,session_id)
);
