-- Run as the RDS master only. Supply role passwords through private session settings.
-- Never store operational passwords in this file or a Terraform state/plan.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='icb_migrator') THEN
        CREATE ROLE icb_migrator LOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='icb_service') THEN
        CREATE ROLE icb_service LOGIN;
    END IF;
    EXECUTE format('ALTER ROLE icb_migrator PASSWORD %L',current_setting('icb.migration_password'));
    EXECUTE format('ALTER ROLE icb_service PASSWORD %L',current_setting('icb.service_password'));
    EXECUTE format('GRANT icb_migrator TO %I',current_user);
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO icb_migrator;
GRANT USAGE ON SCHEMA public TO icb_service;
