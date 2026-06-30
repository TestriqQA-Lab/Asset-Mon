-- Sticky invite-disable: distinguish a deliberately-disabled link from "never created".
ALTER TABLE "Tenant" ADD COLUMN "inviteDisabled" BOOLEAN NOT NULL DEFAULT false;
