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
CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (
    attempt_key text PRIMARY KEY,
    failures integer NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);
CREATE TABLE collector_leases (
    owner_id uuid PRIMARY KEY REFERENCES accounts(id),
    collector_id uuid NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE TABLE collector_history (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    collector_id uuid NOT NULL,
    started_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id, collector_id, started_at)
);
CREATE TABLE viewers (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES accounts(id),
    platform text NOT NULL,
    platform_user_id text,
    username text NOT NULL,
    display_name text NOT NULL,
    UNIQUE(owner_id, id)
);
CREATE UNIQUE INDEX viewers_platform_id ON viewers(owner_id, platform, platform_user_id)
    WHERE platform_user_id IS NOT NULL;
CREATE UNIQUE INDEX viewers_fallback_name ON viewers(owner_id, platform, username)
    WHERE platform_user_id IS NULL;
CREATE INDEX viewers_owner_name ON viewers(owner_id, username);
CREATE TABLE migration_runs (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES accounts(id),
    source_file text NOT NULL,
    source_sha256 text NOT NULL,
    importer_version integer NOT NULL,
    cutoff_at timestamptz NOT NULL,
    status text NOT NULL CHECK(status IN ('prepared', 'complete', 'partial')),
    verification jsonb NOT NULL DEFAULT '{}',
    UNIQUE(owner_id, source_sha256, importer_version)
);
CREATE TABLE activity_receipts (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    batch_id uuid NOT NULL,
    digest text NOT NULL,
    collector_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id, batch_id)
);
CREATE TABLE source_event_receipts (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    platform text NOT NULL,
    source_event_id text NOT NULL,
    type text NOT NULL,
    PRIMARY KEY(owner_id, platform, source_event_id, type)
);
CREATE TABLE activity_event_receipts (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    event_id uuid NOT NULL,
    PRIMARY KEY(owner_id, event_id)
);
CREATE TABLE support_events (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    event_id uuid NOT NULL,
    viewer_id uuid,
    platform text NOT NULL,
    type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    reporting_date date NOT NULL,
    timezone text NOT NULL,
    source_event_id text,
    quantity bigint,
    months bigint,
    bits bigint,
    money_minor bigint,
    currency text,
    tier text,
    subtype text,
    anonymous boolean NOT NULL DEFAULT false,
    raid_size bigint,
    ticket_delta bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id, event_id),
    FOREIGN KEY(owner_id, viewer_id) REFERENCES viewers(owner_id, id)
);
CREATE INDEX support_events_owner_day ON support_events(owner_id, reporting_date, event_id);
CREATE INDEX support_events_owner_viewer_day ON support_events(owner_id, viewer_id, reporting_date);
CREATE INDEX support_events_retention ON support_events(occurred_at);
CREATE TABLE giveaway_audit_events (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    event_id uuid NOT NULL,
    viewer_id uuid,
    type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    reporting_date date NOT NULL,
    timezone text NOT NULL,
    ticket_delta bigint NOT NULL DEFAULT 0,
    action_id uuid NOT NULL,
    PRIMARY KEY(owner_id, event_id),
    FOREIGN KEY(owner_id, viewer_id) REFERENCES viewers(owner_id, id)
);
CREATE INDEX giveaway_audit_owner_day ON giveaway_audit_events(owner_id, reporting_date, event_id);
CREATE INDEX giveaway_audit_retention ON giveaway_audit_events(occurred_at);
CREATE TABLE viewer_daily_stats (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    reporting_date date NOT NULL,
    timezone text NOT NULL,
    viewer_id uuid NOT NULL,
    messages bigint NOT NULL DEFAULT 0,
    active_windows bigint NOT NULL DEFAULT 0,
    sub_events bigint NOT NULL DEFAULT 0,
    sub_months bigint NOT NULL DEFAULT 0,
    gifted_subs bigint NOT NULL DEFAULT 0,
    bits bigint NOT NULL DEFAULT 0,
    follows bigint NOT NULL DEFAULT 0,
    raids bigint NOT NULL DEFAULT 0,
    raid_viewers bigint NOT NULL DEFAULT 0,
    ticket_delta bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id, reporting_date, viewer_id),
    FOREIGN KEY(owner_id, viewer_id) REFERENCES viewers(owner_id, id)
);
CREATE INDEX viewer_stats_owner_viewer_day ON viewer_daily_stats(owner_id, viewer_id, reporting_date);
CREATE TABLE stream_daily_stats (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    reporting_date date NOT NULL,
    timezone text NOT NULL,
    messages bigint NOT NULL DEFAULT 0,
    active_windows bigint NOT NULL DEFAULT 0,
    sub_events bigint NOT NULL DEFAULT 0,
    sub_months bigint NOT NULL DEFAULT 0,
    gifted_subs bigint NOT NULL DEFAULT 0,
    bits bigint NOT NULL DEFAULT 0,
    follows bigint NOT NULL DEFAULT 0,
    raids bigint NOT NULL DEFAULT 0,
    raid_viewers bigint NOT NULL DEFAULT 0,
    ticket_delta bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id, reporting_date)
);
CREATE TABLE support_currency_daily (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    reporting_date date NOT NULL,
    timezone text NOT NULL,
    subject_key text NOT NULL,
    currency text NOT NULL,
    contribution_type text NOT NULL,
    amount_minor bigint NOT NULL,
    PRIMARY KEY(owner_id, reporting_date, subject_key, currency, contribution_type)
);
