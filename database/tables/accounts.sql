-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of accounts; apply live changes through a new migration.
CREATE TABLE accounts (
    id uuid PRIMARY KEY,
    login_name text NOT NULL UNIQUE CHECK (login_name = lower(login_name)),
    password_salt text NOT NULL,
    password_hash text NOT NULL,
    scrypt_n integer NOT NULL,
    scrypt_r integer NOT NULL,
    scrypt_p integer NOT NULL,
    reporting_timezone text NOT NULL DEFAULT 'America/Chicago',
    enabled boolean NOT NULL DEFAULT true,
    live_cutover_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
