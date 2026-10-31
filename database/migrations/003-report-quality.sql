CREATE TABLE daily_summary_quality (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    reporting_date date NOT NULL,
    partial boolean NOT NULL,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,reporting_date)
);
ALTER TABLE support_events ALTER COLUMN ticket_delta DROP NOT NULL;
ALTER TABLE giveaway_audit_events ALTER COLUMN ticket_delta DROP NOT NULL;
ALTER TABLE viewer_daily_stats ADD COLUMN unknown_award_events bigint NOT NULL DEFAULT 0;
ALTER TABLE stream_daily_stats ADD COLUMN unknown_award_events bigint NOT NULL DEFAULT 0;
