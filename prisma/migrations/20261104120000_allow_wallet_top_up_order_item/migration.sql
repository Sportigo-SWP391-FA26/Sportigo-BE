ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_exactly_one_service_check";

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_exactly_one_service_check"
CHECK (
  ("itemType" = 'WALLET_TOP_UP' AND num_nonnulls("classRegistrationId", "privateEnrollmentId") = 0)
  OR
  ("itemType" <> 'WALLET_TOP_UP' AND num_nonnulls("classRegistrationId", "privateEnrollmentId") = 1)
);
