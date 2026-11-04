CREATE UNIQUE INDEX viewers_platform_id ON viewers(owner_id, platform, platform_user_id)
    WHERE platform_user_id IS NOT NULL;
