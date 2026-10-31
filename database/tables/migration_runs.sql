-- Current definition of migration_runs; apply live changes through a new migration.
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
