CREATE UNIQUE INDEX viewers_fallback_name ON viewers(owner_id, platform, username)
    WHERE platform_user_id IS NULL;
