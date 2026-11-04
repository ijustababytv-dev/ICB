-- Application namespace: icb. Private API keys live only in Secrets Manager.
CREATE TABLE steam_accounts (
    owner_id uuid PRIMARY KEY REFERENCES accounts(id),
    steam_id text NOT NULL,
    profile_input text NOT NULL,
    app_id bigint NOT NULL,
    enabled boolean NOT NULL,
    known_initialized boolean NOT NULL,
    last_poll bigint,
    last_ok bigint,
    last_error text NOT NULL,
    schema_at bigint NOT NULL
);
