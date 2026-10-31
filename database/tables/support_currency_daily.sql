-- Current definition of support_currency_daily; apply live changes through a new migration.
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
