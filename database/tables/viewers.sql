-- Current definition of viewers; apply live changes through a new migration.
CREATE TABLE viewers (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES accounts(id),
    platform text NOT NULL,
    platform_user_id text,
    username text NOT NULL,
    display_name text NOT NULL,
    UNIQUE(owner_id, id)
);
