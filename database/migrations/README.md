# Incremental changes only

Table definitions live in `../tables/`, one file per table. Independent indexes
live in `../indexes/`. Do not place grouped initial table definitions here.

This folder is for later, numbered upgrade scripts such as
`006-add-account-preference.sql`. Applied scripts are immutable and checksum-checked.
Update the corresponding object definition at the same time. Add the migration's
version and SHA-256 to `schema.json` once the canonical definitions include it;
fresh builds then baseline that version while existing databases still apply it.
Keep those later upgrade scripts here so older databases can advance safely.

The original four grouped initial scripts are represented by their original
checksums in `../schema.json`. Their complete original contents remain in Git
history at commit `220aa40` and a private pre-reorganization backup. Existing
databases retain their original ledger rows. A partially applied legacy schema
must finish using that original release before switching to this layout.

`005-icb-schema.sql` moves all 19 existing tables and their indexes from `public`
to `icb`, including the migration ledger. Schema creation itself lives separately
in `../schemas/icb.sql`. Fresh builds use that schema and baseline version 005;
upgrades move the existing objects in a single transaction without rebuilding them.

Version 006 adds cloud feature objects through `../upgrades/006-feature-core.json`.
The upgrade runner installs its ordered per-object files inside the migration's
transaction before applying its SQL delta. The version checksum binds both the
delta and the object manifest; versions 001–005 retain their original checksums.

Each manifest pins the SHA-256 of its original object SQL. Run
`python cloud-server/tools/build-database.py` from the project root before a
release. It retains the pinned sources under ignored `dist/database-upgrades/`
and creates a separate administrative ZIP. Retain that ZIP in the private release
bucket. It never belongs in the Lambda runtime package. If a later canonical
definition changes, restore the old administrative bundle when upgrading an old
database; never rewrite a released manifest or covered checksum. New ALTERs and
new object installs require a new numbered version.
