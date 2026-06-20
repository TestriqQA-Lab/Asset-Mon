SELECT name FROM "_assetmon_migrations" ORDER BY name DESC LIMIT 5;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='User' AND column_name IN ('tokenVersion','failedLoginCount','lockedUntil','passwordChangedAt') ORDER BY column_name;
SELECT table_name FROM information_schema.tables WHERE table_name IN ('RefreshTokenJti','IdempotencyKey');
