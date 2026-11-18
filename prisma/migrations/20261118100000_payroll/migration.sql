-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "PayrollItemKind" AS ENUM ('ALLOWANCE', 'DEDUCTION');

-- CreateTable
CREATE TABLE "PayrollCompensation" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "baseSalary" DECIMAL(14,0) NOT NULL,
    "effectiveFromMonth" VARCHAR(7) NOT NULL,
    "effectiveToMonth" VARCHAR(7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRecurringItem" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "PayrollItemKind" NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "effectiveFromMonth" VARCHAR(7) NOT NULL,
    "effectiveToMonth" VARCHAR(7),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRecurringItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" SERIAL NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "staffName" VARCHAR(100) NOT NULL,
    "staffCode" VARCHAR(30),
    "baseSalary" DECIMAL(14,0) NOT NULL,
    "scheduledUnits" INTEGER NOT NULL,
    "absentUnits" INTEGER NOT NULL,
    "absenceDeduction" DECIMAL(14,0) NOT NULL,
    "makeupCredit" DECIMAL(14,0) NOT NULL,
    "allowanceTotal" DECIMAL(14,0) NOT NULL,
    "deductionTotal" DECIMAL(14,0) NOT NULL,
    "netAmount" DECIMAL(14,0) NOT NULL,
    "lineItems" JSONB NOT NULL,
    "workEvidence" JSONB NOT NULL,
    "reviewIssues" JSONB NOT NULL,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollMakeupCredit" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "sourceKind" VARCHAR(20) NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,

    CONSTRAINT "PayrollMakeupCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollCompensation_staffId_effectiveToMonth_idx" ON "PayrollCompensation"("staffId", "effectiveToMonth");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCompensation_staffId_effectiveFromMonth_key" ON "PayrollCompensation"("staffId", "effectiveFromMonth");

-- CreateIndex
CREATE INDEX "PayrollRecurringItem_staffId_effectiveFromMonth_effectiveTo_idx" ON "PayrollRecurringItem"("staffId", "effectiveFromMonth", "effectiveToMonth");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_month_key" ON "PayrollPeriod"("month");

-- CreateIndex
CREATE INDEX "PayrollEntry_staffId_periodId_idx" ON "PayrollEntry"("staffId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_periodId_staffId_key" ON "PayrollEntry"("periodId", "staffId");

-- CreateIndex
CREATE INDEX "PayrollMakeupCredit_staffId_idx" ON "PayrollMakeupCredit"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollMakeupCredit_sourceKind_sourceId_key" ON "PayrollMakeupCredit"("sourceKind", "sourceId");

-- AddForeignKey
ALTER TABLE "PayrollCompensation" ADD CONSTRAINT "PayrollCompensation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecurringItem" ADD CONSTRAINT "PayrollRecurringItem_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollMakeupCredit" ADD CONSTRAINT "PayrollMakeupCredit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollMakeupCredit" ADD CONSTRAINT "PayrollMakeupCredit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
