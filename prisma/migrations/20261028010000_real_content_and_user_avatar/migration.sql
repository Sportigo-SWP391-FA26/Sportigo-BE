ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;

CREATE TYPE "NewsletterStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED');

CREATE TABLE "LandingHeroSlide" (
  "id" SERIAL NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "subtitle" TEXT,
  "imageUrl" TEXT NOT NULL,
  "sportId" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LandingHeroSlide_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LandingFacility" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LandingFacility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LandingPartner" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "logoUrl" TEXT NOT NULL,
  "websiteUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LandingPartner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteSetting" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "hotline" VARCHAR(40) NOT NULL,
  "openingHours" VARCHAR(120) NOT NULL,
  "location" VARCHAR(160) NOT NULL,
  "brandDescription" TEXT NOT NULL,
  "authPromotionTitle" VARCHAR(200),
  "authPromotionDescription" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsletterSubscriber" (
  "id" SERIAL NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "status" "NewsletterStatus" NOT NULL DEFAULT 'SUBSCRIBED',
  "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
CREATE INDEX "LandingHeroSlide_isActive_sortOrder_idx" ON "LandingHeroSlide"("isActive", "sortOrder");
CREATE INDEX "LandingFacility_isActive_sortOrder_idx" ON "LandingFacility"("isActive", "sortOrder");
CREATE INDEX "LandingPartner_isActive_sortOrder_idx" ON "LandingPartner"("isActive", "sortOrder");

ALTER TABLE "LandingHeroSlide"
  ADD CONSTRAINT "LandingHeroSlide_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
