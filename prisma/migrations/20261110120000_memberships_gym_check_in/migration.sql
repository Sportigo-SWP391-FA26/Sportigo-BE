-- Gói phòng tập theo tháng, check-in tại quầy, khuyến mãi phạm vi membership
ALTER TYPE "OrderItemType" ADD VALUE 'MEMBERSHIP';
ALTER TYPE "PromoScope" ADD VALUE 'MEMBERSHIP';

CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'CANCELLED', 'REFUNDED');
CREATE TYPE "CheckInMethod" AS ENUM ('QR', 'MANUAL');

CREATE TABLE "MembershipPlan" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "durationMonths" INTEGER NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "description" TEXT,
  "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MembershipPlan_values_check" CHECK ("durationMonths" > 0 AND "price" > 0)
);

CREATE TABLE "MemberSubscription" (
  "id" SERIAL NOT NULL,
  "memberId" INTEGER NOT NULL,
  "planId" INTEGER NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "startDate" DATE,
  "endDate" DATE,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymCheckIn" (
  "id" SERIAL NOT NULL,
  "memberId" INTEGER NOT NULL,
  "subscriptionId" INTEGER NOT NULL,
  "checkedInById" INTEGER NOT NULL,
  "method" "CheckInMethod" NOT NULL,
  "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GymCheckIn_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderItem" ADD COLUMN "memberSubscriptionId" INTEGER;

CREATE INDEX "MembershipPlan_status_durationMonths_idx" ON "MembershipPlan"("status", "durationMonths");
CREATE INDEX "MemberSubscription_memberId_status_endDate_idx" ON "MemberSubscription"("memberId", "status", "endDate");
CREATE INDEX "GymCheckIn_memberId_checkedInAt_idx" ON "GymCheckIn"("memberId", "checkedInAt");
CREATE INDEX "GymCheckIn_checkedInAt_idx" ON "GymCheckIn"("checkedInAt");
CREATE UNIQUE INDEX "OrderItem_memberSubscriptionId_key" ON "OrderItem"("memberSubscriptionId");

ALTER TABLE "MemberSubscription" ADD CONSTRAINT "MemberSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberSubscription" ADD CONSTRAINT "MemberSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GymCheckIn" ADD CONSTRAINT "GymCheckIn_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GymCheckIn" ADD CONSTRAINT "GymCheckIn_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "MemberSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GymCheckIn" ADD CONSTRAINT "GymCheckIn_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_memberSubscriptionId_fkey" FOREIGN KEY ("memberSubscriptionId") REFERENCES "MemberSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rút gọn mã hội viên cũ: SG + 6 ký tự, bỏ các ký tự dễ nhầm 0, 1, I, L, O
DO $$
DECLARE
  target RECORD;
  candidate TEXT;
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
BEGIN
  FOR target IN SELECT "userId" FROM "Member" WHERE "memberCode" !~ '^SG[2-9A-HJKMNP-Z]{6}$' LOOP
    LOOP
      candidate := 'SG';
      FOR i IN 1..6 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Member" WHERE "memberCode" = candidate);
    END LOOP;
    UPDATE "Member" SET "memberCode" = candidate WHERE "userId" = target."userId";
  END LOOP;
END $$;
