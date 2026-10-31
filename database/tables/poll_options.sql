-- Application namespace: icb. Current definition of poll_options.
CREATE TABLE poll_options (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id text NOT NULL,
    label text NOT NULL,
    image text,
    position integer NOT NULL,
    PRIMARY KEY(owner_id,id)
);
