-- Target schema: icb (enforced by the schema creation tools).
-- Current definition of stream_daily_stats; apply live changes through a new migration.
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
    unknown_award_events bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id, reporting_date)
);
