-- FR-66 coach dạy thực tế từng buổi + FR-67 ca làm / chấm công lễ tân (Nguyễn Trường Giang)

-- CreateEnum
CREATE TYPE "StaffShiftStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimeClockAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: coachId NULL = theo coach của lớp
ALTER TABLE "ClassSession" ADD COLUMN     "coachAbsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coachChangeReason" VARCHAR(300),
ADD COLUMN     "coachChangedAt" TIMESTAMP(3),
ADD COLUMN     "coachChangedById" INTEGER,
ADD COLUMN     "coachId" INTEGER,
ADD COLUMN     "replacedCoachId" INTEGER;

-- Backfill: buổi đã diễn ra được chốt coach = coach hiện tại của lớp (theo góp ý: dữ liệu cũ lấy coach của lớp)
UPDATE "ClassSession" cs
SET "coachId" = gc."coachId"
FROM "GroupClass" gc
WHERE cs."classId" = gc."id" AND cs."startsAt" <= CURRENT_TIMESTAMP AND cs."coachId" IS NULL;

-- CreateTable
CREATE TABLE "StaffShift" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "StaffShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" VARCHAR(300),
    "cancelReason" VARCHAR(300),
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffShift_time_check" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "StaffShift_clock_check" CHECK ("clockOutAt" IS NULL OR ("clockInAt" IS NOT NULL AND "clockOutAt" > "clockInAt"))
);

-- CreateTable
CREATE TABLE "TimeClockAdjustment" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "oldClockInAt" TIMESTAMP(3),
    "oldClockOutAt" TIMESTAMP(3),
    "reason" VARCHAR(300) NOT NULL,
    "status" "TimeClockAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClockAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TimeClockAdjustment_value_check" CHECK ("clockInAt" IS NOT NULL OR "clockOutAt" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "StaffShift_staffId_startsAt_idx" ON "StaffShift"("staffId", "startsAt");

-- CreateIndex
CREATE INDEX "StaffShift_startsAt_idx" ON "StaffShift"("startsAt");

-- CreateIndex
CREATE INDEX "TimeClockAdjustment_status_createdAt_idx" ON "TimeClockAdjustment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TimeClockAdjustment_shiftId_status_idx" ON "TimeClockAdjustment"("shiftId", "status");

-- Mỗi ca chỉ có tối đa 1 yêu cầu sửa đang chờ duyệt
CREATE UNIQUE INDEX "TimeClockAdjustment_one_pending_per_shift" ON "TimeClockAdjustment"("shiftId") WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "ClassSession_coachId_startsAt_idx" ON "ClassSession"("coachId", "startsAt");

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_replacedCoachId_fkey" FOREIGN KEY ("replacedCoachId") REFERENCES "Coach"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_coachChangedById_fkey" FOREIGN KEY ("coachChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockAdjustment" ADD CONSTRAINT "TimeClockAdjustment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "StaffShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockAdjustment" ADD CONSTRAINT "TimeClockAdjustment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockAdjustment" ADD CONSTRAINT "TimeClockAdjustment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
