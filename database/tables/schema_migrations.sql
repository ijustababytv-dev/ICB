-- Tracks applied changes and an explicit baseline when creating an empty schema.
CREATE TABLE schema_migrations (
    version text PRIMARY KEY,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);
