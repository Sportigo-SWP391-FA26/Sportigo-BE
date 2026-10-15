CREATE UNIQUE INDEX "Payment_one_pending_online_per_order"
ON "Payment" ("orderId")
WHERE "status" = 'PENDING' AND "channel" = 'ONLINE';
