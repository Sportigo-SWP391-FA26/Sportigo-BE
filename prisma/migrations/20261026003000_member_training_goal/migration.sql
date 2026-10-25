-- FR-11: mục tiêu tập luyện do Member tự khai báo, Coach phụ trách được xem.
ALTER TABLE "Member"
ADD COLUMN "trainingGoal" VARCHAR(500);
