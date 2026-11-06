CREATE TYPE "WaitlistInvitationStatus" AS ENUM (
    'OFFERED',
    'ACCEPTED',
    'DECLINED',
    'EXPIRED',
    'PAYMENT_FAILED',
    'PAYMENT_EXPIRED',
    'FULFILLED'
);

CREATE TABLE "ClassWaitlistInvitation" (
    "id" SERIAL NOT NULL,
    "waitlistId" INTEGER NOT NULL,
    "status" "WaitlistInvitationStatus" NOT NULL DEFAULT 'OFFERED',
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "orderId" INTEGER,
    "failureReason" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassWaitlistInvitation_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ClassWaitlistInvitation" (
    "waitlistId",
    "status",
    "offeredAt",
    "expiresAt",
    "orderId",
    "respondedAt",
    "updatedAt"
)
SELECT
    waitlist."id",
    CASE
        WHEN waitlist."status" = 'OFFERED' THEN 'OFFERED'::"WaitlistInvitationStatus"
        WHEN waitlist."status" = 'ACCEPTED' THEN 'ACCEPTED'::"WaitlistInvitationStatus"
        ELSE 'EXPIRED'::"WaitlistInvitationStatus"
    END,
    waitlist."offeredAt",
    waitlist."offerExpiresAt",
    CASE
        WHEN waitlist."status" = 'ACCEPTED' THEN (
            SELECT item."orderId"
            FROM "ClassRegistration" registration
            JOIN "OrderItem" item ON item."classRegistrationId" = registration."id"
            WHERE registration."memberId" = waitlist."memberId"
              AND registration."classId" = waitlist."classId"
            ORDER BY registration."registeredAt" DESC
            LIMIT 1
        )
        ELSE NULL
    END,
    CASE WHEN waitlist."status" = 'OFFERED' THEN NULL ELSE waitlist."offeredAt" END,
    CURRENT_TIMESTAMP
FROM "ClassWaitlist" waitlist
WHERE waitlist."status" IN ('OFFERED', 'ACCEPTED', 'EXPIRED')
  AND waitlist."offeredAt" IS NOT NULL
  AND waitlist."offerExpiresAt" IS NOT NULL;

CREATE UNIQUE INDEX "ClassWaitlistInvitation_orderId_key"
    ON "ClassWaitlistInvitation"("orderId");
CREATE INDEX "ClassWaitlistInvitation_waitlistId_createdAt_idx"
    ON "ClassWaitlistInvitation"("waitlistId", "createdAt");
CREATE INDEX "ClassWaitlistInvitation_status_expiresAt_idx"
    ON "ClassWaitlistInvitation"("status", "expiresAt");

ALTER TABLE "ClassWaitlistInvitation"
    ADD CONSTRAINT "ClassWaitlistInvitation_waitlistId_fkey"
    FOREIGN KEY ("waitlistId") REFERENCES "ClassWaitlist"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassWaitlistInvitation"
    ADD CONSTRAINT "ClassWaitlistInvitation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "OrderItem_classRegistrationId_key";
