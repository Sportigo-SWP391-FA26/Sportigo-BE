-- Cấu hình số ca tối thiểu của trung tâm (bản ghi duy nhất id = 1)
CREATE TABLE "CenterSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minimumShifts" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterSetting_pkey" PRIMARY KEY ("id")
);

-- Ngưỡng điểm đạt theo môn; NULL nghĩa là chưa đặt ngưỡng
ALTER TABLE "Sport" ADD COLUMN "passingScore" DECIMAL(5,2);
