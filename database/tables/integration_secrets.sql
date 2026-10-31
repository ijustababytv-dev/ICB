-- Application namespace: icb. Current definition of integration_secrets.
CREATE TABLE integration_secrets (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    kind text NOT NULL,
    secret_arn text NOT NULL,
    credential_version uuid NOT NULL,
    PRIMARY KEY(owner_id,kind)
);
