/*
  Warnings:

  - You are about to drop the column `category` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the `OpportunityInsight` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "Post_vertical_category_createdAt_id_idx";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "category";

-- DropTable
DROP TABLE "OpportunityInsight";

-- CreateIndex
CREATE INDEX "Post_vertical_createdAt_id_idx" ON "Post"("vertical", "createdAt" DESC, "id");
