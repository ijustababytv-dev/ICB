-- Application namespace: icb. Current definition of todos.
CREATE TABLE todos (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    list text NOT NULL CHECK(list IN ('daily','weekly')),
    id text NOT NULL,
    text text NOT NULL,
    kind text NOT NULL CHECK(kind IN ('check','goal')),
    done boolean NOT NULL DEFAULT false,
    current bigint NOT NULL DEFAULT 0 CHECK(current>=0),
    target bigint NOT NULL DEFAULT 1 CHECK(target>0),
    position integer NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY(owner_id,list,id)
);
