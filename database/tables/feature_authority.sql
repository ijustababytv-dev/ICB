-- Application namespace: icb. Current definition of feature_authority.
CREATE TABLE feature_authority (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    feature text NOT NULL,
    mode text NOT NULL CHECK(mode IN ('local','migrating','cloud')),
    protocol_version integer NOT NULL DEFAULT 2,
    revision bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(owner_id,feature)
);
