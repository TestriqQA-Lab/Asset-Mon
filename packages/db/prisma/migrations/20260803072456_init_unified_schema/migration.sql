-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `dbName` VARCHAR(191) NOT NULL,
    `status` ENUM('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DELETED') NOT NULL DEFAULT 'PROVISIONING',
    `plan` VARCHAR(191) NOT NULL DEFAULT 'starter',
    `settings` JSON NOT NULL,
    `subscriptionStatus` VARCHAR(191) NOT NULL DEFAULT 'trialing',
    `trialEndsAt` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `razorpayCustomerId` VARCHAR(191) NULL,
    `razorpaySubscriptionId` VARCHAR(191) NULL,
    `razorpayPlanId` VARCHAR(191) NULL,
    `inviteToken` VARCHAR(191) NULL,
    `inviteDisabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tenant_slug_key`(`slug`),
    UNIQUE INDEX `Tenant_dbName_key`(`dbName`),
    UNIQUE INDEX `Tenant_inviteToken_key`(`inviteToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `TenantUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TenantUser_email_idx`(`email`),
    UNIQUE INDEX `TenantUser_email_tenantId_key`(`email`, `tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'SUPPORT') NOT NULL DEFAULT 'SUPPORT',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `totpSecret` VARCHAR(191) NULL,
    `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `passwordChangedAt` DATETIME(3) NULL,
    `primaryEmailVerifiedAt` DATETIME(3) NULL,
    `recoveryEmail` VARCHAR(191) NULL,
    `recoveryEmailVerifiedAt` DATETIME(3) NULL,
    `backupCodesGeneratedAt` DATETIME(3) NULL,
    `mfaEnrolledAt` DATETIME(3) NULL,
    `lastTotpStep` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlatformUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `actorEmail` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `metadata` JSON NOT NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `prevHash` VARCHAR(191) NULL,
    `entryHash` VARCHAR(191) NULL,
    `seq` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformAuditLog_createdAt_idx`(`createdAt`),
    INDEX `PlatformAuditLog_actorId_idx`(`actorId`),
    INDEX `PlatformAuditLog_action_idx`(`action`),
    INDEX `PlatformAuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `PlatformAuditLog_seq_idx`(`seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformAuditCounter` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'platform',
    `lastSeq` INTEGER NOT NULL DEFAULT 0,
    `lastHash` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformRefreshTokenJti` (
    `jti` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL DEFAULT 'refresh',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformRefreshTokenJti_expiresAt_idx`(`expiresAt`),
    INDEX `PlatformRefreshTokenJti_userId_idx`(`userId`),
    PRIMARY KEY (`jti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformMfaPending` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `nonce` VARCHAR(191) NOT NULL,
    `stage` ENUM('EMAIL', 'TOTP') NOT NULL,
    `pwdAtSnapshot` DATETIME(3) NULL,
    `tvSnapshot` INTEGER NOT NULL,
    `emailOtpHash` VARCHAR(191) NULL,
    `emailTarget` VARCHAR(191) NULL,
    `emailExpiresAt` DATETIME(3) NULL,
    `emailLastSentAt` DATETIME(3) NULL,
    `emailSendCount` INTEGER NOT NULL DEFAULT 0,
    `emailCodeAttempts` INTEGER NOT NULL DEFAULT 0,
    `chainAttempts` INTEGER NOT NULL DEFAULT 0,
    `backupCodeUsed` BOOLEAN NOT NULL DEFAULT false,
    `consumedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlatformMfaPending_nonce_key`(`nonce`),
    INDEX `PlatformMfaPending_userId_idx`(`userId`),
    INDEX `PlatformMfaPending_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformBackupCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `pepperVersion` INTEGER NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `usedFor` ENUM('EMAIL', 'TOTP') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlatformBackupCode_userId_codeHash_key`(`userId`, `codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformOperatorEmailLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `toEmail` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NULL,
    `sent` BOOLEAN NOT NULL DEFAULT false,
    `error` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformOperatorEmailLog_createdAt_idx`(`createdAt`),
    INDEX `PlatformOperatorEmailLog_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PlatformMfaResetRequest` (
    `id` VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `approverId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `incidentRef` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformMfaResetRequest_targetId_idx`(`targetId`),
    INDEX `PlatformMfaResetRequest_status_idx`(`status`),
    INDEX `PlatformMfaResetRequest_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `SupportRequest` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `createdByEmail` VARCHAR(191) NOT NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `platformUnreadAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tenantUnreadAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SupportRequest_tenantId_idx`(`tenantId`),
    INDEX `SupportRequest_status_idx`(`status`),
    INDEX `SupportRequest_lastMessageAt_idx`(`lastMessageAt`),
    INDEX `SupportRequest_platformUnreadAt_idx`(`platformUnreadAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `SupportMessage` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `authorType` ENUM('TENANT', 'PLATFORM') NOT NULL,
    `authorEmail` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupportMessage_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'info',
    `audienceType` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `audiencePlans` JSON NOT NULL,
    `audienceTenantIds` JSON NOT NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdById` VARCHAR(191) NOT NULL,
    `createdByEmail` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_active_idx`(`active`),
    INDEX `Announcement_startsAt_idx`(`startsAt`),
    INDEX `Announcement_endsAt_idx`(`endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `User` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'ASSET_MANAGER', 'EMPLOYEE') NOT NULL DEFAULT 'EMPLOYEE',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `totpSecret` VARCHAR(191) NULL,
    `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `passwordChangedAt` DATETIME(3) NULL,
    `scopedDepartmentId` VARCHAR(191) NULL,
    `departmentId` VARCHAR(191) NULL,
    `mfaMethod` ENUM('NONE', 'EMAIL', 'EMAIL_TOTP') NOT NULL DEFAULT 'NONE',
    `mfaEnabledAt` DATETIME(3) NULL,
    `recoveryEmail` VARCHAR(191) NULL,
    `recoveryEmailVerifiedAt` DATETIME(3) NULL,
    `lastTotpStep` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `User_role_idx`(`role`),
    INDEX `User_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `User_tenantId_email_key`(`tenantId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Department` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `costCenter` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Department_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Department_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Location` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('BUILDING', 'FLOOR', 'ROOM', 'DESK') NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Location_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Location_tenantId_name_parentId_key`(`tenantId`, `name`, `parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Category` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `customFields` JSON NOT NULL,
    `type` ENUM('ASSET', 'ACCESSORY', 'LICENSE') NOT NULL DEFAULT 'ASSET',
    `imageUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Category_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Category_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Vendor` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Vendor_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Vendor_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Asset` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `assetTag` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `serialNumber` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'AVAILABLE', 'ASSIGNED', 'OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED') NOT NULL DEFAULT 'AVAILABLE',
    `categoryId` VARCHAR(191) NULL,
    `locationId` VARCHAR(191) NULL,
    `departmentId` VARCHAR(191) NULL,
    `vendorId` VARCHAR(191) NULL,
    `purchaseDate` DATETIME(3) NULL,
    `purchaseCost` DECIMAL(12, 2) NULL,
    `warrantyEnd` DATETIME(3) NULL,
    `purchaseOrderId` VARCHAR(191) NULL,
    `depreciationMethod` ENUM('NONE', 'STRAIGHT_LINE', 'DECLINING_BALANCE') NOT NULL DEFAULT 'NONE',
    `salvageValue` DECIMAL(12, 2) NULL,
    `usefulLifeMonths` INTEGER NULL,
    `depreciationStart` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `orderNumber` VARCHAR(191) NULL,
    `requestable` BOOLEAN NOT NULL DEFAULT false,
    `customFields` JSON NOT NULL,
    `photoUrl` VARCHAR(191) NULL,
    `parentId` VARCHAR(191) NULL,
    `statusDefId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Asset_status_idx`(`status`),
    INDEX `Asset_categoryId_idx`(`categoryId`),
    INDEX `Asset_locationId_idx`(`locationId`),
    INDEX `Asset_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Asset_tenantId_assetTag_key`(`tenantId`, `assetTag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Assignment` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `checkedOutAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `returnedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `Assignment_assetId_idx`(`assetId`),
    INDEX `Assignment_userId_idx`(`userId`),
    INDEX `Assignment_returnedAt_idx`(`returnedAt`),
    INDEX `Assignment_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `MaintenanceSchedule` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `intervalDays` INTEGER NOT NULL,
    `nextDueAt` DATETIME(3) NOT NULL,
    `lastRunAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MaintenanceSchedule_assetId_idx`(`assetId`),
    INDEX `MaintenanceSchedule_nextDueAt_idx`(`nextDueAt`),
    INDEX `MaintenanceSchedule_active_idx`(`active`),
    INDEX `MaintenanceSchedule_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `ServiceTicket` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `ticketNumber` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `openedById` VARCHAR(191) NULL,
    `assignedToId` VARCHAR(191) NULL,
    `vendorId` VARCHAR(191) NULL,
    `cost` DECIMAL(12, 2) NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `resolution` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServiceTicket_assetId_idx`(`assetId`),
    INDEX `ServiceTicket_status_idx`(`status`),
    INDEX `ServiceTicket_assignedToId_idx`(`assignedToId`),
    INDEX `ServiceTicket_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `ServiceTicket_tenantId_ticketNumber_key`(`tenantId`, `ticketNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PurchaseRequest` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `justification` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `requestedById` VARCHAR(191) NOT NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `departmentId` VARCHAR(191) NULL,
    `totalEstimate` DECIMAL(12, 2) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PurchaseRequest_status_idx`(`status`),
    INDEX `PurchaseRequest_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `PurchaseRequest_tenantId_number_key`(`tenantId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PurchaseRequestItem` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `prId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPriceEstimate` DECIMAL(12, 2) NULL,

    INDEX `PurchaseRequestItem_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PurchaseOrder` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `poNumber` VARCHAR(191) NOT NULL,
    `prId` VARCHAR(191) NULL,
    `vendorId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `orderedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PurchaseOrder_status_idx`(`status`),
    INDEX `PurchaseOrder_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `PurchaseOrder_tenantId_poNumber_key`(`tenantId`, `poNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `PurchaseOrderItem` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `poId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitCost` DECIMAL(12, 2) NOT NULL,
    `receivedQty` INTEGER NOT NULL DEFAULT 0,

    INDEX `PurchaseOrderItem_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Software` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `publisher` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Software_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `Software_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `SoftwareLicense` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `softwareId` VARCHAR(191) NOT NULL,
    `licenseKey` VARCHAR(191) NULL,
    `type` ENUM('PERPETUAL', 'SUBSCRIPTION', 'TRIAL', 'OPEN_SOURCE') NOT NULL DEFAULT 'SUBSCRIPTION',
    `seats` INTEGER NOT NULL DEFAULT 1,
    `purchaseDate` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `cost` DECIMAL(12, 2) NULL,
    `vendorId` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SoftwareLicense_softwareId_idx`(`softwareId`),
    INDEX `SoftwareLicense_expiresAt_idx`(`expiresAt`),
    INDEX `SoftwareLicense_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `SoftwareAssignment` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `licenseId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `assetId` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `returnedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `SoftwareAssignment_licenseId_idx`(`licenseId`),
    INDEX `SoftwareAssignment_userId_idx`(`userId`),
    INDEX `SoftwareAssignment_assetId_idx`(`assetId`),
    INDEX `SoftwareAssignment_returnedAt_idx`(`returnedAt`),
    INDEX `SoftwareAssignment_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Reservation` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `status` ENUM('REQUESTED', 'CONFIRMED', 'CHECKED_OUT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Reservation_assetId_startAt_idx`(`assetId`, `startAt`),
    INDEX `Reservation_userId_idx`(`userId`),
    INDEX `Reservation_status_idx`(`status`),
    INDEX `Reservation_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AuditSession` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `scope` JSON NULL,
    `scheduledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `status` ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
    `startedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AuditSession_status_idx`(`status`),
    INDEX `AuditSession_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AuditScan` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NULL,
    `rawTag` VARCHAR(191) NULL,
    `scannedById` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditScan_sessionId_idx`(`sessionId`),
    INDEX `AuditScan_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `AuditScan_tenantId_sessionId_assetId_key`(`tenantId`, `sessionId`, `assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AssetAttachment` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssetAttachment_assetId_idx`(`assetId`),
    INDEX `AssetAttachment_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AssetStatusDef` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT 'gray',
    `mapsTo` ENUM('PENDING', 'AVAILABLE', 'ASSIGNED', 'OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED') NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssetStatusDef_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `AssetStatusDef_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `SavedView` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `filters` JSON NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `isShared` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SavedView_ownerId_idx`(`ownerId`),
    INDEX `SavedView_kind_idx`(`kind`),
    INDEX `SavedView_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `ApiKey` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL DEFAULT 'read_write',
    `role` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `createdById` VARCHAR(191) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ApiKey_revokedAt_idx`(`revokedAt`),
    INDEX `ApiKey_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `ApiKey_tenantId_hash_key`(`tenantId`, `hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Webhook` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `events` JSON NOT NULL,
    `secret` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Webhook_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `WebhookDelivery` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `webhookId` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` INTEGER NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(191) NULL,
    `succeededAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebhookDelivery_webhookId_createdAt_idx`(`webhookId`, `createdAt`),
    INDEX `WebhookDelivery_succeededAt_idx`(`succeededAt`),
    INDEX `WebhookDelivery_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `EmailLog` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `toEmail` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `sent` BOOLEAN NOT NULL DEFAULT false,
    `error` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailLog_createdAt_idx`(`createdAt`),
    INDEX `EmailLog_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AuditLog` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` JSON NULL,
    `performedById` VARCHAR(191) NULL,
    `prevHash` VARCHAR(191) NULL,
    `entryHash` VARCHAR(191) NULL,
    `hashVersion` INTEGER NOT NULL DEFAULT 1,
    `seq` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_assetId_idx`(`assetId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_seq_idx`(`seq`),
    INDEX `AuditLog_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AuditCounter` (
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `lastSeq` INTEGER NOT NULL DEFAULT 0,
    `lastHash` VARCHAR(191) NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `Notification` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NULL,
    `href` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `Notification_createdAt_idx`(`createdAt`),
    INDEX `Notification_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `RefreshTokenJti` (
    `tenantId` VARCHAR(191) NOT NULL,
    `jti` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL DEFAULT 'refresh',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RefreshTokenJti_expiresAt_idx`(`expiresAt`),
    INDEX `RefreshTokenJti_userId_idx`(`userId`),
    INDEX `RefreshTokenJti_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`jti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `IdempotencyKey` (
    `tenantId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`tenantId`, `scope`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `TenantMfaPending` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `nonce` VARCHAR(191) NOT NULL,
    `stage` ENUM('EMAIL', 'TOTP') NOT NULL,
    `pwdAtSnapshot` DATETIME(3) NULL,
    `tvSnapshot` INTEGER NOT NULL,
    `emailOtpHash` VARCHAR(191) NULL,
    `emailTarget` VARCHAR(191) NULL,
    `emailExpiresAt` DATETIME(3) NULL,
    `emailLastSentAt` DATETIME(3) NULL,
    `emailSendCount` INTEGER NOT NULL DEFAULT 0,
    `emailCodeAttempts` INTEGER NOT NULL DEFAULT 0,
    `chainAttempts` INTEGER NOT NULL DEFAULT 0,
    `backupCodeUsed` BOOLEAN NOT NULL DEFAULT false,
    `consumedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TenantMfaPending_userId_idx`(`userId`),
    INDEX `TenantMfaPending_expiresAt_idx`(`expiresAt`),
    INDEX `TenantMfaPending_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `TenantMfaPending_tenantId_nonce_key`(`tenantId`, `nonce`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `TenantBackupCode` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `pepperVersion` INTEGER NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `usedFor` ENUM('EMAIL', 'TOTP') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TenantBackupCode_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `TenantBackupCode_tenantId_userId_codeHash_key`(`tenantId`, `userId`, `codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AssetRequest` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `urgency` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('PENDING', 'APPROVED', 'DECLINED', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `assignedToId` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `declineReason` VARCHAR(191) NULL,
    `escalatedToAdmin` BOOLEAN NOT NULL DEFAULT false,
    `escalationNote` VARCHAR(191) NULL,
    `fulfilledAssetId` VARCHAR(191) NULL,
    `fulfilledAt` DATETIME(3) NULL,
    `mode` ENUM('CATEGORY', 'SPECIFIC') NOT NULL DEFAULT 'CATEGORY',
    `neededBy` DATETIME(3) NULL,
    `isTemporary` BOOLEAN NOT NULL DEFAULT false,
    `returnBy` DATETIME(3) NULL,
    `managerNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssetRequest_requestedById_idx`(`requestedById`),
    INDEX `AssetRequest_status_idx`(`status`),
    INDEX `AssetRequest_assignedToId_idx`(`assignedToId`),
    INDEX `AssetRequest_categoryId_idx`(`categoryId`),
    INDEX `AssetRequest_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `AssetRequest_tenantId_number_key`(`tenantId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- CreateTable
CREATE TABLE `AssetRequestItem` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'DECLINED', 'FULFILLED') NOT NULL DEFAULT 'REQUESTED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssetRequestItem_requestId_idx`(`requestId`),
    INDEX `AssetRequestItem_assetId_idx`(`assetId`),
    INDEX `AssetRequestItem_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

-- AddForeignKey
ALTER TABLE `TenantUser` ADD CONSTRAINT `TenantUser_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformMfaPending` ADD CONSTRAINT `PlatformMfaPending_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `PlatformUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformBackupCode` ADD CONSTRAINT `PlatformBackupCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `PlatformUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportRequest` ADD CONSTRAINT `SupportRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportMessage` ADD CONSTRAINT `SupportMessage_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `SupportRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_scopedDepartmentId_fkey` FOREIGN KEY (`scopedDepartmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Location` ADD CONSTRAINT `Location_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_statusDefId_fkey` FOREIGN KEY (`statusDefId`) REFERENCES `AssetStatusDef`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceSchedule` ADD CONSTRAINT `MaintenanceSchedule_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_openedById_fkey` FOREIGN KEY (`openedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceTicket` ADD CONSTRAINT `ServiceTicket_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequestItem` ADD CONSTRAINT `PurchaseRequestItem_prId_fkey` FOREIGN KEY (`prId`) REFERENCES `PurchaseRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequestItem` ADD CONSTRAINT `PurchaseRequestItem_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_prId_fkey` FOREIGN KEY (`prId`) REFERENCES `PurchaseRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SoftwareLicense` ADD CONSTRAINT `SoftwareLicense_softwareId_fkey` FOREIGN KEY (`softwareId`) REFERENCES `Software`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SoftwareLicense` ADD CONSTRAINT `SoftwareLicense_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SoftwareAssignment` ADD CONSTRAINT `SoftwareAssignment_licenseId_fkey` FOREIGN KEY (`licenseId`) REFERENCES `SoftwareLicense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SoftwareAssignment` ADD CONSTRAINT `SoftwareAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SoftwareAssignment` ADD CONSTRAINT `SoftwareAssignment_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditSession` ADD CONSTRAINT `AuditSession_startedById_fkey` FOREIGN KEY (`startedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditScan` ADD CONSTRAINT `AuditScan_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `AuditSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditScan` ADD CONSTRAINT `AuditScan_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditScan` ADD CONSTRAINT `AuditScan_scannedById_fkey` FOREIGN KEY (`scannedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAttachment` ADD CONSTRAINT `AssetAttachment_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAttachment` ADD CONSTRAINT `AssetAttachment_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SavedView` ADD CONSTRAINT `SavedView_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookDelivery` ADD CONSTRAINT `WebhookDelivery_webhookId_fkey` FOREIGN KEY (`webhookId`) REFERENCES `Webhook`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantMfaPending` ADD CONSTRAINT `TenantMfaPending_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantBackupCode` ADD CONSTRAINT `TenantBackupCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetRequest` ADD CONSTRAINT `AssetRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetRequest` ADD CONSTRAINT `AssetRequest_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetRequest` ADD CONSTRAINT `AssetRequest_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetRequest` ADD CONSTRAINT `AssetRequest_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetRequest` ADD CONSTRAINT `AssetRequest_fulfilledAssetId_fkey` FOREIGN KEY (`fulfilledAssetId`) REFERENCES `Asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetRequestItem` ADD CONSTRAINT `AssetRequestItem_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `AssetRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetRequestItem` ADD CONSTRAINT `AssetRequestItem_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual additions to enforce utf8mb4_general_ci on specific searchable columns
-- Option A: Database default is utf8mb4_0900_as_cs (case-sensitive)
ALTER TABLE `Tenant` MODIFY COLUMN `name` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `Tenant` MODIFY COLUMN `slug` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;

ALTER TABLE `User` MODIFY COLUMN `firstName` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `User` MODIFY COLUMN `lastName` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `User` MODIFY COLUMN `email` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;

ALTER TABLE `Asset` MODIFY COLUMN `name` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `Asset` MODIFY COLUMN `assetTag` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `Asset` MODIFY COLUMN `serialNumber` VARCHAR(191) COLLATE utf8mb4_general_ci;
ALTER TABLE `Asset` MODIFY COLUMN `notes` VARCHAR(191) COLLATE utf8mb4_general_ci;

ALTER TABLE `ServiceTicket` MODIFY COLUMN `title` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
ALTER TABLE `ServiceTicket` MODIFY COLUMN `ticketNumber` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;

ALTER TABLE `PlatformAuditLog` MODIFY COLUMN `action` VARCHAR(191) COLLATE utf8mb4_general_ci NOT NULL;
