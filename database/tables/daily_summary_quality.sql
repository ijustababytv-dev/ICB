-- Current definition of daily_summary_quality; apply live changes through a new migration.
CREATE TABLE daily_summary_quality (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    reporting_date date NOT NULL,
    partial boolean NOT NULL,
    details jsonb NOT NULL,
    PRIMARY KEY(owner_id,reporting_date)
);
