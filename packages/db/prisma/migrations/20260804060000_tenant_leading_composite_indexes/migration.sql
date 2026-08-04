-- Index the shared tables for how they are actually queried.
--
-- Under database-per-tenant, `WHERE status = ?` hit a table containing one tenant's
-- rows, so a single-column index was the whole story. Under shared tables every query
-- the extension issues is `WHERE tenantId = ? AND ...`, and MySQL uses one index per
-- table access — so a lone `status` index makes the engine scan every tenant's rows
-- with that status and filter afterwards. These composites put tenantId first so the
-- index seek lands inside one tenant's slice.
--
-- The only indexes dropped are the standalone `_tenantId_idx` ones, now redundant
-- because a (tenantId, X) composite serves the tenantId prefix. Single-column indexes
-- are deliberately KEPT: MySQL requires an index leading with each foreign-key column
-- (error 1553 on drop), and several were serving exactly that. Some are now redundant
-- with a composite and could be pruned later against real query stats — not guessed at.
--
-- Data-safe: index-only changes, no table or column is altered.

-- DropIndex
DROP INDEX `ApiKey_tenantId_idx` ON `ApiKey`;

-- DropIndex
DROP INDEX `Asset_tenantId_idx` ON `Asset`;

-- DropIndex
DROP INDEX `AssetAttachment_tenantId_idx` ON `AssetAttachment`;

-- DropIndex
DROP INDEX `AssetRequest_tenantId_idx` ON `AssetRequest`;

-- DropIndex
DROP INDEX `AssetRequestItem_tenantId_idx` ON `AssetRequestItem`;

-- DropIndex
DROP INDEX `AssetStatusDef_tenantId_idx` ON `AssetStatusDef`;

-- DropIndex
DROP INDEX `Assignment_tenantId_idx` ON `Assignment`;

-- DropIndex
DROP INDEX `AuditLog_tenantId_idx` ON `AuditLog`;

-- DropIndex
DROP INDEX `AuditScan_tenantId_idx` ON `AuditScan`;

-- DropIndex
DROP INDEX `AuditSession_tenantId_idx` ON `AuditSession`;

-- DropIndex
DROP INDEX `Category_tenantId_idx` ON `Category`;

-- DropIndex
DROP INDEX `Department_tenantId_idx` ON `Department`;

-- DropIndex
DROP INDEX `EmailLog_tenantId_idx` ON `EmailLog`;

-- DropIndex
DROP INDEX `Location_tenantId_idx` ON `Location`;

-- DropIndex
DROP INDEX `MaintenanceSchedule_tenantId_idx` ON `MaintenanceSchedule`;

-- DropIndex
DROP INDEX `Notification_tenantId_idx` ON `Notification`;

-- DropIndex
DROP INDEX `PurchaseOrder_tenantId_idx` ON `PurchaseOrder`;

-- DropIndex
DROP INDEX `PurchaseOrderItem_tenantId_idx` ON `PurchaseOrderItem`;

-- DropIndex
DROP INDEX `PurchaseRequest_tenantId_idx` ON `PurchaseRequest`;

-- DropIndex
DROP INDEX `PurchaseRequestItem_tenantId_idx` ON `PurchaseRequestItem`;

-- DropIndex
DROP INDEX `RefreshTokenJti_tenantId_idx` ON `RefreshTokenJti`;

-- DropIndex
DROP INDEX `Reservation_tenantId_idx` ON `Reservation`;

-- DropIndex
DROP INDEX `SavedView_tenantId_idx` ON `SavedView`;

-- DropIndex
DROP INDEX `ServiceTicket_tenantId_idx` ON `ServiceTicket`;

-- DropIndex
DROP INDEX `Software_tenantId_idx` ON `Software`;

-- DropIndex
DROP INDEX `SoftwareAssignment_tenantId_idx` ON `SoftwareAssignment`;

-- DropIndex
DROP INDEX `SoftwareLicense_tenantId_idx` ON `SoftwareLicense`;

-- DropIndex
DROP INDEX `TenantBackupCode_tenantId_idx` ON `TenantBackupCode`;

-- DropIndex
DROP INDEX `TenantMfaPending_tenantId_idx` ON `TenantMfaPending`;

-- DropIndex
DROP INDEX `User_tenantId_idx` ON `User`;

-- DropIndex
DROP INDEX `Vendor_tenantId_idx` ON `Vendor`;

-- DropIndex
DROP INDEX `Webhook_tenantId_idx` ON `Webhook`;

-- DropIndex
DROP INDEX `WebhookDelivery_tenantId_idx` ON `WebhookDelivery`;

-- CreateIndex
CREATE INDEX `ApiKey_tenantId_revokedAt_idx` ON `ApiKey`(`tenantId`, `revokedAt`);

-- CreateIndex
CREATE INDEX `Asset_tenantId_status_idx` ON `Asset`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `Asset_tenantId_categoryId_idx` ON `Asset`(`tenantId`, `categoryId`);

-- CreateIndex
CREATE INDEX `Asset_tenantId_locationId_idx` ON `Asset`(`tenantId`, `locationId`);

-- CreateIndex
CREATE INDEX `Asset_tenantId_parentId_idx` ON `Asset`(`tenantId`, `parentId`);

-- CreateIndex
CREATE INDEX `AssetAttachment_tenantId_assetId_idx` ON `AssetAttachment`(`tenantId`, `assetId`);

-- CreateIndex
CREATE INDEX `AssetRequest_tenantId_status_idx` ON `AssetRequest`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `AssetRequest_tenantId_requestedById_idx` ON `AssetRequest`(`tenantId`, `requestedById`);

-- CreateIndex
CREATE INDEX `AssetRequest_tenantId_assignedToId_idx` ON `AssetRequest`(`tenantId`, `assignedToId`);

-- CreateIndex
CREATE INDEX `AssetRequestItem_tenantId_requestId_idx` ON `AssetRequestItem`(`tenantId`, `requestId`);

-- CreateIndex
CREATE INDEX `AssetRequestItem_tenantId_assetId_idx` ON `AssetRequestItem`(`tenantId`, `assetId`);

-- CreateIndex
CREATE INDEX `Assignment_tenantId_assetId_idx` ON `Assignment`(`tenantId`, `assetId`);

-- CreateIndex
CREATE INDEX `Assignment_tenantId_userId_returnedAt_idx` ON `Assignment`(`tenantId`, `userId`, `returnedAt`);

-- CreateIndex
CREATE INDEX `AuditLog_tenantId_seq_idx` ON `AuditLog`(`tenantId`, `seq`);

-- CreateIndex
CREATE INDEX `AuditLog_tenantId_createdAt_idx` ON `AuditLog`(`tenantId`, `createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_tenantId_assetId_idx` ON `AuditLog`(`tenantId`, `assetId`);

-- CreateIndex
CREATE INDEX `AuditSession_tenantId_status_idx` ON `AuditSession`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `EmailLog_tenantId_createdAt_idx` ON `EmailLog`(`tenantId`, `createdAt`);

-- CreateIndex
CREATE INDEX `MaintenanceSchedule_tenantId_assetId_idx` ON `MaintenanceSchedule`(`tenantId`, `assetId`);

-- CreateIndex
CREATE INDEX `MaintenanceSchedule_tenantId_active_nextDueAt_idx` ON `MaintenanceSchedule`(`tenantId`, `active`, `nextDueAt`);

-- CreateIndex
CREATE INDEX `Notification_tenantId_userId_readAt_idx` ON `Notification`(`tenantId`, `userId`, `readAt`);

-- CreateIndex
CREATE INDEX `Notification_tenantId_createdAt_idx` ON `Notification`(`tenantId`, `createdAt`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_tenantId_status_idx` ON `PurchaseOrder`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `PurchaseOrderItem_tenantId_poId_idx` ON `PurchaseOrderItem`(`tenantId`, `poId`);

-- CreateIndex
CREATE INDEX `PurchaseRequest_tenantId_status_idx` ON `PurchaseRequest`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `PurchaseRequestItem_tenantId_prId_idx` ON `PurchaseRequestItem`(`tenantId`, `prId`);

-- CreateIndex
CREATE INDEX `RefreshTokenJti_tenantId_userId_idx` ON `RefreshTokenJti`(`tenantId`, `userId`);

-- CreateIndex
CREATE INDEX `Reservation_tenantId_assetId_startAt_idx` ON `Reservation`(`tenantId`, `assetId`, `startAt`);

-- CreateIndex
CREATE INDEX `Reservation_tenantId_status_idx` ON `Reservation`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `SavedView_tenantId_ownerId_idx` ON `SavedView`(`tenantId`, `ownerId`);

-- CreateIndex
CREATE INDEX `ServiceTicket_tenantId_status_idx` ON `ServiceTicket`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `ServiceTicket_tenantId_assignedToId_idx` ON `ServiceTicket`(`tenantId`, `assignedToId`);

-- CreateIndex
CREATE INDEX `ServiceTicket_tenantId_assetId_idx` ON `ServiceTicket`(`tenantId`, `assetId`);

-- CreateIndex
CREATE INDEX `SoftwareAssignment_tenantId_licenseId_returnedAt_idx` ON `SoftwareAssignment`(`tenantId`, `licenseId`, `returnedAt`);

-- CreateIndex
CREATE INDEX `SoftwareLicense_tenantId_softwareId_idx` ON `SoftwareLicense`(`tenantId`, `softwareId`);

-- CreateIndex
CREATE INDEX `SoftwareLicense_tenantId_expiresAt_idx` ON `SoftwareLicense`(`tenantId`, `expiresAt`);

-- CreateIndex
CREATE INDEX `TenantMfaPending_tenantId_userId_idx` ON `TenantMfaPending`(`tenantId`, `userId`);

-- CreateIndex
CREATE INDEX `User_tenantId_role_idx` ON `User`(`tenantId`, `role`);

-- CreateIndex
CREATE INDEX `Webhook_tenantId_active_idx` ON `Webhook`(`tenantId`, `active`);

-- CreateIndex
CREATE INDEX `WebhookDelivery_tenantId_webhookId_createdAt_idx` ON `WebhookDelivery`(`tenantId`, `webhookId`, `createdAt`);

