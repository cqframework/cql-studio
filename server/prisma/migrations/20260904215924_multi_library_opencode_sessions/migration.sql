-- DropIndex
DROP INDEX "OpenCodeSession_userId_activeLibraryId_idx";

-- AlterTable
ALTER TABLE "OpenCodeSession" ALTER COLUMN "activeLibraryId" DROP NOT NULL,
ALTER COLUMN "activeFile" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "autoApplyCodeEdits" SET DEFAULT true,
ALTER COLUMN "enableAiCodePrediction" SET DEFAULT true;
