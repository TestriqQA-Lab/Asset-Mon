-- Idempotent post-migration script. Postgres let each query opt into
-- case-insensitivity (`mode: 'insensitive'` → ILIKE); MySQL has no per-query
-- equivalent and Prisma's MySQL connector rejects `mode` outright. So the seven
-- former `mode: 'insensitive'` call sites are replaced by making the columns they
-- search case-insensitive here. The database-wide default stays case-sensitive
-- (utf8mb4_0900_as_cs) so exact matches and system identifiers are unaffected.
--
-- COLLATION CHOICE — utf8mb4_general_ci
-- Verified on MySQL 8.4.11: `'José' = 'Jose' COLLATE utf8mb4_general_ci` → 1.
-- general_ci is case-insensitive AND accent-insensitive — it folds accents exactly
-- like utf8mb4_0900_ai_ci. An earlier plan revision chose it believing it was
-- accent-sensitive, and rejected 0900_ai_ci on that basis; that premise was wrong,
-- so both options behave identically here.
--
-- This is not only about search. Collation governs UNIQUE enforcement, and three
-- of the columns below carry unique constraints — Tenant.slug, User.email
-- (@@unique([tenantId, email])) and Asset.assetTag (@@unique([tenantId, assetTag])).
-- Under accent folding a single tenant cannot hold both `CAFÉ-01` and `CAFE-01`
-- as asset tags. Note this also applies during data consolidation: Postgres allowed
-- both rows, MySQL rejects the second, and consolidate-data.ts loads with
-- `skipDuplicates: true`, which drops it silently. The §8.3 row-count parity check
-- is what catches that.
--
-- If accent-sensitivity turns out to be wanted, the collation is utf8mb4_0900_as_ci
-- (case-insensitive, accent-SENSITIVE; MySQL 8.0.1+, absent on MariaDB). Deferred
-- until the production database is provisioned and its engine and version are
-- confirmed — this is a ten-line ALTER and cheap to revisit while tables are small.
--
-- CAVEAT: these columns end up in a different collation from their table default.
-- MySQL raises error 1267 when two *columns* of differing collation are compared.
-- Prisma generates no such comparison today (column-vs-literal always resolves to
-- the column's collation), but a hand-written JOIN across, say, User.email and
-- TenantUser.email would need an explicit COLLATE clause.

-- Tenant Search
ALTER TABLE `Tenant` MODIFY COLUMN `name` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `Tenant` MODIFY COLUMN `slug` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;

-- User Search
ALTER TABLE `User` MODIFY COLUMN `firstName` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `User` MODIFY COLUMN `lastName` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `User` MODIFY COLUMN `email` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;

-- Asset Search
ALTER TABLE `Asset` MODIFY COLUMN `name` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `Asset` MODIFY COLUMN `assetTag` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `Asset` MODIFY COLUMN `serialNumber` VARCHAR(191) COLLATE utf8mb4_general_ci;
ALTER TABLE `Asset` MODIFY COLUMN `notes` VARCHAR(191) COLLATE utf8mb4_general_ci;

-- Service Ticket Search
ALTER TABLE `ServiceTicket` MODIFY COLUMN `title` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `ServiceTicket` MODIFY COLUMN `ticketNumber` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;

-- Audit Search
ALTER TABLE `PlatformAuditLog` MODIFY COLUMN `action` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
