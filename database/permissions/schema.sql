-- Master-only namespace security; table privileges remain in their own files.
REVOKE CREATE ON SCHEMA public FROM PUBLIC,icb_migrator,icb_service;
REVOKE ALL ON SCHEMA icb FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA icb TO icb_migrator;
GRANT USAGE ON SCHEMA icb TO icb_service;
DO $$ BEGIN
    EXECUTE format('ALTER DATABASE %I SET search_path=icb',current_database());
    EXECUTE format('ALTER ROLE icb_migrator IN DATABASE %I SET search_path=icb',current_database());
    EXECUTE format('ALTER ROLE icb_service IN DATABASE %I SET search_path=icb',current_database());
END $$;
