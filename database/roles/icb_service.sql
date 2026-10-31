-- Master-only bootstrap; the limited service password never appears in source.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='icb_service') THEN
        CREATE ROLE icb_service LOGIN;
    END IF;
    EXECUTE format('ALTER ROLE icb_service PASSWORD %L',current_setting('icb.service_password'));
END $$;
