-- Master-only bootstrap; the password is supplied privately to this session.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='icb_migrator') THEN
        CREATE ROLE icb_migrator LOGIN;
    END IF;
    EXECUTE format('ALTER ROLE icb_migrator PASSWORD %L',current_setting('icb.migration_password'));
    EXECUTE format('GRANT icb_migrator TO %I',current_user);
END $$;
