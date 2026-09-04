-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiProvider" TEXT NOT NULL DEFAULT 'ollama',
ADD COLUMN     "compatibleProviderBaseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "compatibleProviderModel" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "compatibleProviderName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "enableAiCodePrediction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openaiModel" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "OpenCodeSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "openCodeSessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "activeLibraryId" TEXT NOT NULL,
    "activeFile" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reasoningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "runnerCreatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "workspaceOrigin" JSONB,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenCodeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenCodeSession_userId_updatedAt_idx" ON "OpenCodeSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "OpenCodeSession_userId_activeLibraryId_idx" ON "OpenCodeSession"("userId", "activeLibraryId");

-- CreateIndex
CREATE INDEX "OpenCodeSession_expiresAt_idx" ON "OpenCodeSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "OpenCodeSession" ADD CONSTRAINT "OpenCodeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
