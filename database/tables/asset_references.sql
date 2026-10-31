-- Application namespace: icb. Artwork bytes remain ordinary local files.
CREATE TABLE asset_references (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    relative_path text NOT NULL,
    modified_at bigint NOT NULL,
    bytes bigint NOT NULL CHECK(bytes>=0),
    PRIMARY KEY(owner_id,relative_path)
);
