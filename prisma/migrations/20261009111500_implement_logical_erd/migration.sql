-- CreateEnum
CREATE TYPE "CoachStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CART', 'PENDING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "OrderItemType" AS ENUM ('GROUP_CLASS', 'PRIVATE_COURSE');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "PromoScope" AS ENUM ('ALL', 'GROUP_CLASS', 'PRIVATE_COURSE');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('ONLINE', 'COUNTER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('REFUND', 'SURCHARGE', 'DISCOUNT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClassStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "ClassStatus" ADD VALUE 'COMPLETED';

-- Replace the enum instead of adding and immediately using new values in the
-- same transaction (PostgreSQL rejects that pattern).
ALTER TYPE "RegistrationStatus" RENAME TO "RegistrationStatus_old";
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'REFUNDED');
ALTER TABLE "ClassRegistration" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ClassRegistration" ALTER COLUMN "status" TYPE "RegistrationStatus"
USING ("status"::text::"RegistrationStatus");
DROP TYPE "RegistrationStatus_old";

-- DropForeignKey
ALTER TABLE "Class" DROP CONSTRAINT "Class_sportId_fkey";

-- DropForeignKey
ALTER TABLE "ClassRegistration" DROP CONSTRAINT "ClassRegistration_classId_fkey";

-- DropForeignKey
ALTER TABLE "ClassRegistration" DROP CONSTRAINT "ClassRegistration_memberId_fkey";

-- DropForeignKey
ALTER TABLE "ClassSession" DROP CONSTRAINT "ClassSession_classId_fkey";

-- DropForeignKey
ALTER TABLE "MemberSubscription" DROP CONSTRAINT "MemberSubscription_memberId_fkey";

-- DropForeignKey
ALTER TABLE "MemberSubscription" DROP CONSTRAINT "MemberSubscription_packageId_fkey";

-- DropForeignKey
ALTER TABLE "PackageSport" DROP CONSTRAINT "PackageSport_packageId_fkey";

-- DropForeignKey
ALTER TABLE "PackageSport" DROP CONSTRAINT "PackageSport_sportId_fkey";

-- AlterTable
ALTER TABLE "ClassRegistration" ADD COLUMN     "price" DECIMAL(12,2) NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "note" TEXT,
ALTER COLUMN "roomId" SET NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED';

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "name" SET DATA TYPE VARCHAR(40);

-- AlterTable
ALTER TABLE "Sport" ALTER COLUMN "name" SET DATA TYPE VARCHAR(100);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "phone" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "displayName" SET DATA TYPE VARCHAR(100);

-- DropTable
DROP TABLE "Class";

-- DropTable
DROP TABLE "MemberSubscription";

-- DropTable
DROP TABLE "MembershipPackage";

-- DropTable
DROP TABLE "PackageSport";

-- DropEnum
DROP TYPE "PackageStatus";

-- DropEnum
DROP TYPE "SubscriptionStatus";

-- CreateTable
CREATE TABLE "Member" (
    "userId" INTEGER NOT NULL,
    "memberCode" VARCHAR(30) NOT NULL,
    "dateOfBirth" DATE,
    "gender" VARCHAR(20),
    "emergencyContact" VARCHAR(100),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Coach" (
    "userId" INTEGER NOT NULL,
    "coachCode" VARCHAR(30) NOT NULL,
    "bio" TEXT,
    "status" "CoachStatus" NOT NULL DEFAULT 'ACTIVE',
    "hiredAt" DATE,

    CONSTRAINT "Coach_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "content" TEXT NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(80) NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupClass" (
    "id" SERIAL NOT NULL,
    "sportId" INTEGER NOT NULL,
    "coachId" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "capacity" INTEGER NOT NULL,
    "tuitionFee" DECIMAL(12,2) NOT NULL,
    "registrationOpenAt" TIMESTAMP(3) NOT NULL,
    "registrationCloseAt" TIMESTAMP(3) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ClassStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "location" VARCHAR(160),
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleChange" (
    "id" SERIAL NOT NULL,
    "classSessionId" INTEGER NOT NULL,
    "changedById" INTEGER NOT NULL,
    "oldStartsAt" TIMESTAMP(3) NOT NULL,
    "newStartsAt" TIMESTAMP(3) NOT NULL,
    "oldRoomId" INTEGER,
    "newRoomId" INTEGER,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassWaitlist" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offeredAt" TIMESTAMP(3),
    "offerExpiresAt" TIMESTAMP(3),

    CONSTRAINT "ClassWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAttendance" (
    "id" SERIAL NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "classSessionId" INTEGER NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateCourse" (
    "id" SERIAL NOT NULL,
    "sportId" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "totalSessions" INTEGER NOT NULL,
    "sessionDurationMinutes" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachPrivateCourse" (
    "coachId" INTEGER NOT NULL,
    "privateCourseId" INTEGER NOT NULL,
    "customPrice" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CoachPrivateCourse_pkey" PRIMARY KEY ("coachId","privateCourseId")
);

-- CreateTable
CREATE TABLE "CoachAvailability" (
    "id" SERIAL NOT NULL,
    "coachId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "CoachAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateCourseEnrollment" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "privateCourseId" INTEGER NOT NULL,
    "coachId" INTEGER NOT NULL,
    "purchasedSessions" INTEGER NOT NULL,
    "remainingSessions" INTEGER NOT NULL,
    "purchasedPrice" DECIMAL(12,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateCourseEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateCourseSchedule" (
    "id" SERIAL NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "PrivateCourseSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" SERIAL NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestAssignment" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "assignedToId" INTEGER NOT NULL,
    "assignedById" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,

    CONSTRAINT "RequestAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrder" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "promotionId" INTEGER,
    "orderNumber" VARCHAR(40) NOT NULL,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "finalAmount" DECIMAL(12,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CART',
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "classRegistrationId" INTEGER,
    "privateEnrollmentId" INTEGER,
    "itemType" "OrderItemType" NOT NULL,
    "itemNameSnapshot" VARCHAR(200) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "finalAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "maxDiscount" DECIMAL(12,2),
    "minOrderAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "applicableType" "PromoScope" NOT NULL DEFAULT 'ALL',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "totalUsageLimit" INTEGER,
    "perMemberLimit" INTEGER,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isOnline" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "paymentMethodId" INTEGER NOT NULL,
    "collectedById" INTEGER,
    "reference" VARCHAR(80) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineTransaction" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "providerTransactionId" VARCHAR(120),
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OnlineTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "invoiceNumber" VARCHAR(50) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAdjustment" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "reviewedById" INTEGER,
    "adjustmentId" INTEGER,
    "requestedAmount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlan" (
    "id" SERIAL NOT NULL,
    "sportId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "level" VARCHAR(40) NOT NULL,
    "description" TEXT,
    "durationWeeks" INTEGER,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlanItem" (
    "id" SERIAL NOT NULL,
    "workoutPlanId" INTEGER NOT NULL,
    "weekNumber" INTEGER,
    "sessionNumber" INTEGER,
    "itemOrder" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "content" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "sets" INTEGER,
    "repetitions" INTEGER,

    CONSTRAINT "WorkoutPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanPrivateEnrollment" (
    "id" SERIAL NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "workoutPlanId" INTEGER NOT NULL,
    "assignedById" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PlanAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "PlanPrivateEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressAssessment" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "coachId" INTEGER NOT NULL,
    "classRegistrationId" INTEGER,
    "privateEnrollmentId" INTEGER,
    "assessmentDate" DATE NOT NULL,
    "score" DECIMAL(5,2),
    "metrics" JSONB,
    "coachComment" TEXT NOT NULL,
    "recommendation" TEXT,
    "nextAssessmentDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_memberCode_key" ON "Member"("memberCode");

-- CreateIndex
CREATE UNIQUE INDEX "Coach_coachCode_key" ON "Coach"("coachCode");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupClass_sportId_coachId_status_idx" ON "GroupClass"("sportId", "coachId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE INDEX "ClassWaitlist_classId_status_joinedAt_idx" ON "ClassWaitlist"("classId", "status", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassWaitlist_memberId_classId_key" ON "ClassWaitlist"("memberId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAttendance_registrationId_classSessionId_key" ON "SessionAttendance"("registrationId", "classSessionId");

-- CreateIndex
CREATE INDEX "PrivateCourse_sportId_status_idx" ON "PrivateCourse"("sportId", "status");

-- CreateIndex
CREATE INDEX "CoachAvailability_coachId_dayOfWeek_effectiveFrom_idx" ON "CoachAvailability"("coachId", "dayOfWeek", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PrivateCourseEnrollment_memberId_status_expiryDate_idx" ON "PrivateCourseEnrollment"("memberId", "status", "expiryDate");

-- CreateIndex
CREATE INDEX "PrivateCourseEnrollment_coachId_status_idx" ON "PrivateCourseEnrollment"("coachId", "status");

-- CreateIndex
CREATE INDEX "PrivateCourseSchedule_roomId_dayOfWeek_startTime_endTime_idx" ON "PrivateCourseSchedule"("roomId", "dayOfWeek", "startTime", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateCourseSchedule_enrollmentId_dayOfWeek_startTime_key" ON "PrivateCourseSchedule"("enrollmentId", "dayOfWeek", "startTime");

-- CreateIndex
CREATE INDEX "SupportRequest_requesterId_status_idx" ON "SupportRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "SupportMessage_requestId_sentAt_idx" ON "SupportMessage"("requestId", "sentAt");

-- CreateIndex
CREATE INDEX "RequestAssignment_requestId_status_idx" ON "RequestAssignment"("requestId", "status");

-- CreateIndex
CREATE INDEX "RequestAssignment_assignedToId_status_idx" ON "RequestAssignment"("assignedToId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_orderNumber_key" ON "ServiceOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "ServiceOrder_memberId_status_createdAt_idx" ON "ServiceOrder"("memberId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_classRegistrationId_key" ON "OrderItem"("classRegistrationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_privateEnrollmentId_key" ON "OrderItem"("privateEnrollmentId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_code_key" ON "PaymentMethod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineTransaction_paymentId_key" ON "OnlineTransaction"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineTransaction_providerTransactionId_key" ON "OnlineTransaction"("providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paymentId_key" ON "Invoice"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "PaymentAdjustment_paymentId_createdAt_idx" ON "PaymentAdjustment"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_adjustmentId_key" ON "RefundRequest"("adjustmentId");

-- CreateIndex
CREATE INDEX "RefundRequest_paymentId_status_idx" ON "RefundRequest"("paymentId", "status");

-- CreateIndex
CREATE INDEX "RefundRequest_memberId_status_idx" ON "RefundRequest"("memberId", "status");

-- CreateIndex
CREATE INDEX "WorkoutPlan_sportId_status_idx" ON "WorkoutPlan"("sportId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutPlanItem_workoutPlanId_weekNumber_sessionNumber_item_key" ON "WorkoutPlanItem"("workoutPlanId", "weekNumber", "sessionNumber", "itemOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPrivateEnrollment_enrollmentId_workoutPlanId_key" ON "PlanPrivateEnrollment"("enrollmentId", "workoutPlanId");

-- CreateIndex
CREATE INDEX "ProgressAssessment_memberId_assessmentDate_idx" ON "ProgressAssessment"("memberId", "assessmentDate");

-- CreateIndex
CREATE INDEX "ProgressAssessment_coachId_assessmentDate_idx" ON "ProgressAssessment"("coachId", "assessmentDate");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coach" ADD CONSTRAINT "Coach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupClass" ADD CONSTRAINT "GroupClass_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupClass" ADD CONSTRAINT "GroupClass_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "GroupClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleChange" ADD CONSTRAINT "ScheduleChange_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleChange" ADD CONSTRAINT "ScheduleChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleChange" ADD CONSTRAINT "ScheduleChange_oldRoomId_fkey" FOREIGN KEY ("oldRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleChange" ADD CONSTRAINT "ScheduleChange_newRoomId_fkey" FOREIGN KEY ("newRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRegistration" ADD CONSTRAINT "ClassRegistration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRegistration" ADD CONSTRAINT "ClassRegistration_classId_fkey" FOREIGN KEY ("classId") REFERENCES "GroupClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassWaitlist" ADD CONSTRAINT "ClassWaitlist_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassWaitlist" ADD CONSTRAINT "ClassWaitlist_classId_fkey" FOREIGN KEY ("classId") REFERENCES "GroupClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ClassRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateCourse" ADD CONSTRAINT "PrivateCourse_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachPrivateCourse" ADD CONSTRAINT "CoachPrivateCourse_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachPrivateCourse" ADD CONSTRAINT "CoachPrivateCourse_privateCourseId_fkey" FOREIGN KEY ("privateCourseId") REFERENCES "PrivateCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAvailability" ADD CONSTRAINT "CoachAvailability_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateCourseEnrollment" ADD CONSTRAINT "PrivateCourseEnrollment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateCourseEnrollment" ADD CONSTRAINT "PrivateCourseEnrollment_privateCourseId_fkey" FOREIGN KEY ("privateCourseId") REFERENCES "PrivateCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateCourseEnrollment" ADD CONSTRAINT "PrivateCourseEnrollment_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateCourseSchedule" ADD CONSTRAINT "PrivateCourseSchedule_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "PrivateCourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateCourseSchedule" ADD CONSTRAINT "PrivateCourseSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAssignment" ADD CONSTRAINT "RequestAssignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAssignment" ADD CONSTRAINT "RequestAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAssignment" ADD CONSTRAINT "RequestAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_classRegistrationId_fkey" FOREIGN KEY ("classRegistrationId") REFERENCES "ClassRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_privateEnrollmentId_fkey" FOREIGN KEY ("privateEnrollmentId") REFERENCES "PrivateCourseEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineTransaction" ADD CONSTRAINT "OnlineTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "PaymentAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Coach"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlanItem" ADD CONSTRAINT "WorkoutPlanItem_workoutPlanId_fkey" FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanPrivateEnrollment" ADD CONSTRAINT "PlanPrivateEnrollment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "PrivateCourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanPrivateEnrollment" ADD CONSTRAINT "PlanPrivateEnrollment_workoutPlanId_fkey" FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanPrivateEnrollment" ADD CONSTRAINT "PlanPrivateEnrollment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Coach"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressAssessment" ADD CONSTRAINT "ProgressAssessment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressAssessment" ADD CONSTRAINT "ProgressAssessment_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressAssessment" ADD CONSTRAINT "ProgressAssessment_classRegistrationId_fkey" FOREIGN KEY ("classRegistrationId") REFERENCES "ClassRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressAssessment" ADD CONSTRAINT "ProgressAssessment_privateEnrollmentId_fkey" FOREIGN KEY ("privateEnrollmentId") REFERENCES "PrivateCourseEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Business invariants from the ERD.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_exactly_one_service_check"
CHECK (num_nonnulls("classRegistrationId", "privateEnrollmentId") = 1);

ALTER TABLE "ProgressAssessment" ADD CONSTRAINT "ProgressAssessment_exactly_one_context_check"
CHECK (num_nonnulls("classRegistrationId", "privateEnrollmentId") = 1);

ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_time_range_check"
CHECK ("endsAt" > "startsAt");

ALTER TABLE "PrivateCourseSchedule" ADD CONSTRAINT "PrivateCourseSchedule_time_range_check"
CHECK ("endTime" > "startTime" AND "effectiveTo" >= "effectiveFrom" AND "dayOfWeek" BETWEEN 0 AND 6);

ALTER TABLE "GroupClass" ADD CONSTRAINT "GroupClass_registration_window_check"
CHECK ("registrationCloseAt" >= "registrationOpenAt" AND "endDate" >= "startDate" AND "capacity" > 0);
