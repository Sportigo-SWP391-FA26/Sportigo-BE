ALTER TYPE "PaymentChannel" ADD VALUE IF NOT EXISTS 'WALLET';

CREATE TYPE "WalletTransactionType" AS ENUM ('REFUND_CREDIT', 'ORDER_DEBIT', 'ORDER_DEBIT_REVERSAL');

ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_paymentId_fkey";
DROP INDEX IF EXISTS "Invoice_paymentId_key";
ALTER TABLE "Invoice" RENAME COLUMN "paymentId" TO "orderId";
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefundRequest" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "RefundRequest" ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE TABLE "PromotionUsage" (
  "id" SERIAL NOT NULL,
  "promotionId" INTEGER NOT NULL,
  "memberId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromotionUsage_orderId_key" ON "PromotionUsage"("orderId");
CREATE INDEX "PromotionUsage_promotionId_memberId_idx" ON "PromotionUsage"("promotionId", "memberId");
ALTER TABLE "PromotionUsage" ADD CONSTRAINT "PromotionUsage_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionUsage" ADD CONSTRAINT "PromotionUsage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionUsage" ADD CONSTRAINT "PromotionUsage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Wallet" (
  "id" SERIAL NOT NULL,
  "memberId" INTEGER NOT NULL,
  "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Wallet_memberId_key" ON "Wallet"("memberId");
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WalletTransaction" (
  "id" SERIAL NOT NULL,
  "walletId" INTEGER NOT NULL,
  "createdById" INTEGER,
  "type" "WalletTransactionType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balanceBefore" DECIMAL(12,2) NOT NULL,
  "balanceAfter" DECIMAL(12,2) NOT NULL,
  "referenceType" VARCHAR(60) NOT NULL,
  "referenceId" VARCHAR(100) NOT NULL,
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
