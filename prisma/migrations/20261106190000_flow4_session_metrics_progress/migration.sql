-- Flow 4 hardening: every assessment belongs to one completed session and
-- metric values use a sport-owned catalogue. No reset or seed is performed.

-- The four current rows predate their private courses and cannot be linked to
-- a real attendance. Product decision: remove invalid rows and assess again
-- after a real completed session.
DELETE FROM "ProgressAssessment"
WHERE "classSessionId" IS NULL AND "privateCourseAttendanceId" IS NULL;

ALTER TABLE "ProgressAssessment"
  ADD CONSTRAINT "ProgressAssessment_exactly_one_session_check"
  CHECK (("classSessionId" IS NOT NULL)::int + ("privateCourseAttendanceId" IS NOT NULL)::int = 1);

CREATE TYPE "AssessmentMetricDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

CREATE TABLE "AssessmentMetricDefinition" (
  "id" SERIAL NOT NULL,
  "sportId" INTEGER NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "unit" VARCHAR(30) NOT NULL,
  "minValue" DECIMAL(10,2) NOT NULL,
  "maxValue" DECIMAL(10,2) NOT NULL,
  "direction" "AssessmentMetricDirection" NOT NULL DEFAULT 'HIGHER_IS_BETTER',
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssessmentMetricDefinition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssessmentMetricDefinition_range_check" CHECK ("minValue" < "maxValue")
);

CREATE TABLE "AssessmentMetricValue" (
  "id" SERIAL NOT NULL,
  "assessmentId" INTEGER NOT NULL,
  "definitionId" INTEGER NOT NULL,
  "value" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "AssessmentMetricValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessmentMetricDefinition_sportId_code_key" ON "AssessmentMetricDefinition"("sportId", "code");
CREATE INDEX "AssessmentMetricDefinition_sportId_isActive_displayOrder_idx" ON "AssessmentMetricDefinition"("sportId", "isActive", "displayOrder");
CREATE UNIQUE INDEX "AssessmentMetricValue_assessmentId_definitionId_key" ON "AssessmentMetricValue"("assessmentId", "definitionId");
CREATE INDEX "AssessmentMetricValue_definitionId_idx" ON "AssessmentMetricValue"("definitionId");

ALTER TABLE "AssessmentMetricDefinition" ADD CONSTRAINT "AssessmentMetricDefinition_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentMetricValue" ADD CONSTRAINT "AssessmentMetricValue_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "ProgressAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentMetricValue" ADD CONSTRAINT "AssessmentMetricValue_definitionId_fkey"
  FOREIGN KEY ("definitionId") REFERENCES "AssessmentMetricDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "AssessmentMetricDefinition"
  ("sportId", "code", "name", "unit", "minValue", "maxValue", "displayOrder", "updatedAt")
SELECT "id", defaults.code, defaults.name, 'điểm', 0, 100, defaults.position, CURRENT_TIMESTAMP
FROM "Sport"
JOIN (VALUES
  ('Bơi lội', 'swim_technique', 'Kỹ thuật bơi', 1),
  ('Bơi lội', 'endurance', 'Sức bền', 2),
  ('Bơi lội', 'breathing_control', 'Kiểm soát nhịp thở', 3),
  ('Gym', 'exercise_technique', 'Kỹ thuật động tác', 1),
  ('Gym', 'strength', 'Sức mạnh', 2),
  ('Gym', 'endurance', 'Sức bền', 3),
  ('Yoga', 'flexibility', 'Độ linh hoạt', 1),
  ('Yoga', 'pose_control', 'Kiểm soát tư thế', 2),
  ('Yoga', 'breathing_control', 'Kiểm soát nhịp thở', 3),
  ('Cầu lông', 'technique', 'Kỹ thuật', 1),
  ('Cầu lông', 'reflex', 'Phản xạ', 2),
  ('Cầu lông', 'movement', 'Khả năng di chuyển', 3)
) AS defaults(sport_name, code, name, position) ON defaults.sport_name = "Sport"."name";
