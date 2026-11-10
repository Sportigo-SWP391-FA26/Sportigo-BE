-- Tách khỏi migration thêm enum: PostgreSQL không dùng được giá trị enum mới trong cùng transaction
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_exactly_one_service_check";

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_exactly_one_service_check"
CHECK (
  ("itemType" = 'WALLET_TOP_UP' AND num_nonnulls("classRegistrationId", "privateEnrollmentId", "memberSubscriptionId") = 0)
  OR
  ("itemType" = 'MEMBERSHIP' AND "memberSubscriptionId" IS NOT NULL AND num_nonnulls("classRegistrationId", "privateEnrollmentId") = 0)
  OR
  ("itemType" NOT IN ('WALLET_TOP_UP', 'MEMBERSHIP') AND "memberSubscriptionId" IS NULL AND num_nonnulls("classRegistrationId", "privateEnrollmentId") = 1)
);
