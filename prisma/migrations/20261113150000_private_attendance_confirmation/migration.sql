-- Buổi 1-1 do Coach ghi nhận phải được hội viên xác nhận trước khi trừ buổi
CREATE TYPE "PrivateAttendanceStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'DISPUTED', 'REJECTED');

ALTER TABLE "PrivateCourseAttendance"
  ADD COLUMN "status" "PrivateAttendanceStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "disputeReason" VARCHAR(500),
  ADD COLUMN "resolvedById" INTEGER,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolutionNote" VARCHAR(500);

-- Các buổi ghi nhận trước đây đã trừ vào khóa học nên coi như đã xác nhận
UPDATE "PrivateCourseAttendance" SET "status" = 'CONFIRMED', "confirmedAt" = "completedAt";

CREATE INDEX "PrivateCourseAttendance_status_completedAt_idx" ON "PrivateCourseAttendance"("status", "completedAt");

ALTER TABLE "PrivateCourseAttendance" ADD CONSTRAINT "PrivateCourseAttendance_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
