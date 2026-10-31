-- Immutable eligibility and rules for each committed drawing, separate from the editable display history.
CREATE TABLE giveaway_draws (
    owner_id uuid NOT NULL REFERENCES accounts(id),
    id uuid NOT NULL,
    command_id uuid NOT NULL,
    revision bigint NOT NULL,
    prize text NOT NULL,
    rates jsonb NOT NULL,
    eligibility jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(owner_id,id),
    UNIQUE(owner_id,command_id)
);
