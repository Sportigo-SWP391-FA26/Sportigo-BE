-- Flow 3: promotion reservations and item-level refunds.
-- This migration only adds/backfills financial references; it does not reset data.

CREATE TYPE "PromotionReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- Existing promotions stay internal until a manager explicitly publishes them.
ALTER TABLE "Promotion" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PromotionReservation" (
  "id" SERIAL NOT NULL,
  "promotionId" INTEGER NOT NULL,
  "memberId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "status" "PromotionReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromotionReservation_orderId_key" ON "PromotionReservation"("orderId");
CREATE INDEX "PromotionReservation_promotionId_status_expiresAt_idx" ON "PromotionReservation"("promotionId", "status", "expiresAt");
CREATE INDEX "PromotionReservation_promotionId_memberId_status_expiresAt_idx" ON "PromotionReservation"("promotionId", "memberId", "status", "expiresAt");

ALTER TABLE "PromotionReservation" ADD CONSTRAINT "PromotionReservation_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionReservation" ADD CONSTRAINT "PromotionReservation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionReservation" ADD CONSTRAINT "PromotionReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAdjustment" ADD COLUMN "orderItemId" INTEGER;
ALTER TABLE "PaymentAdjustment" ADD COLUMN "refundRequestId" INTEGER;
ALTER TABLE "RefundRequest" ADD COLUMN "orderItemId" INTEGER;

-- Existing data was created under the one-item-per-order invariant, so the
-- matching item is deterministic. Keep paymentId nullable for new item-level
-- requests that can be allocated across multiple payments.
UPDATE "RefundRequest" AS rr
SET "orderItemId" = (
  SELECT oi."id"
  FROM "Payment" AS payment
  JOIN "OrderItem" AS oi ON oi."orderId" = payment."orderId"
  WHERE payment."id" = rr."paymentId"
    AND (SELECT COUNT(*) FROM "OrderItem" AS candidate WHERE candidate."orderId" = payment."orderId") = 1
  ORDER BY oi."id"
  LIMIT 1
)
WHERE rr."orderItemId" IS NULL;

UPDATE "PaymentAdjustment" AS adjustment
SET "refundRequestId" = request."id",
    "orderItemId" = request."orderItemId"
FROM "RefundRequest" AS request
WHERE request."adjustmentId" = adjustment."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RefundRequest" WHERE "orderItemId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill RefundRequest.orderItemId: an existing refund has no order item';
  END IF;
END $$;

ALTER TABLE "RefundRequest" ALTER COLUMN "orderItemId" SET NOT NULL;
ALTER TABLE "RefundRequest" ALTER COLUMN "paymentId" DROP NOT NULL;
ALTER TABLE "RefundRequest" DROP CONSTRAINT IF EXISTS "RefundRequest_adjustmentId_fkey";
DROP INDEX IF EXISTS "RefundRequest_adjustmentId_key";
ALTER TABLE "RefundRequest" DROP COLUMN "adjustmentId";

CREATE INDEX "PaymentAdjustment_orderItemId_createdAt_idx" ON "PaymentAdjustment"("orderItemId", "createdAt");
CREATE INDEX "PaymentAdjustment_refundRequestId_idx" ON "PaymentAdjustment"("refundRequestId");
CREATE INDEX "RefundRequest_orderItemId_status_idx" ON "RefundRequest"("orderItemId", "status");

ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
