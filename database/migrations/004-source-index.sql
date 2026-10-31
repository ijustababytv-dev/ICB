-- Permanent source receipts remain authoritative after event retention. This
-- additional index also guards retained support rows against accidental duplicates.
CREATE UNIQUE INDEX support_events_source_identity
    ON support_events(owner_id,platform,source_event_id,type)
    WHERE source_event_id IS NOT NULL;
