-- Add category column to Post table
ALTER TABLE "Post" ADD COLUMN "category" TEXT;

-- Drop old vertical index and create new one with category
DROP INDEX IF EXISTS "Post_vertical_createdAt_id_idx";
CREATE INDEX "Post_vertical_category_createdAt_id_idx" ON "Post"("vertical", "category", "createdAt" DESC, "id");

-- Create OpportunityInsight table
CREATE TABLE "OpportunityInsight" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "category" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityInsight_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on key
CREATE UNIQUE INDEX "OpportunityInsight_key_key" ON "OpportunityInsight"("key");

-- Create unique constraint on postId
CREATE UNIQUE INDEX "OpportunityInsight_postId_key" ON "OpportunityInsight"("postId");

-- Create indexes for OpportunityInsight
CREATE INDEX "OpportunityInsight_vertical_category_region_idx" ON "OpportunityInsight"("vertical", "category", "region");
CREATE INDEX "OpportunityInsight_score_idx" ON "OpportunityInsight"("score" DESC);
CREATE INDEX "OpportunityInsight_createdAt_idx" ON "OpportunityInsight"("createdAt" DESC);
