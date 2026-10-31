-- Public schema access, separate from table privileges and role creation.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO icb_migrator;
GRANT USAGE ON SCHEMA public TO icb_service;
