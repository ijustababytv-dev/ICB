-- Application namespace: icb. Current definition of owner_settings.
CREATE TABLE owner_settings (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),
    PRIMARY KEY(owner_id,feature)
);
