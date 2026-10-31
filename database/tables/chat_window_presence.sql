-- Application namespace: icb. Current definition of chat_window_presence.
CREATE TABLE chat_window_presence (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    name_key text NOT NULL,
    window_id bigint NOT NULL,
    occurred_at timestamptz NOT NULL,
    awarded_at timestamptz,
    PRIMARY KEY(owner_id,name_key,window_id)
);
