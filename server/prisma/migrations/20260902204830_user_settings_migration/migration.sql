/*
  Warnings:

  - You are about to drop the column `config` on the `SharedEnvironment` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "EndpointRole" AS ENUM ('EVALUATION', 'DATA', 'TERMINOLOGY', 'CONTENT');

-- AlterTable
ALTER TABLE "SharedEnvironment" DROP COLUMN "config",
ADD COLUMN     "contentEndpointAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "dataEndpointAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "evaluationServerAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "terminologyEndpointAddress" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allowAiWriteOperations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoApplyCodeEdits" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultTestResultsIndexUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "developer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enableAiAssistant" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "experimental" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fhirPackageRegistryBaseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ollamaBaseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ollamaModel" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "planActSeparateModels" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireDiffPreview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "runnerApiBaseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "runnerFhirBaseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "searxngBaseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "themePreferred" TEXT NOT NULL DEFAULT 'automatic',
ADD COLUMN     "useMCPTools" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "validateSchema" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vsacApiPassword" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "vsacApiUsername" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "vsacFhirBaseUrl" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SharedEnvironmentHttpHeader" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "environmentId" UUID NOT NULL,
    "endpointRole" "EndpointRole" NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedEnvironmentHttpHeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEnvironment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "evaluationServerAddress" TEXT NOT NULL DEFAULT '',
    "dataEndpointAddress" TEXT NOT NULL DEFAULT '',
    "terminologyEndpointAddress" TEXT NOT NULL DEFAULT '',
    "contentEndpointAddress" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEnvironmentHttpHeader" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "environmentId" UUID NOT NULL,
    "endpointRole" "EndpointRole" NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEnvironmentHttpHeader_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedEnvironmentHttpHeader_environmentId_endpointRole_idx" ON "SharedEnvironmentHttpHeader"("environmentId", "endpointRole");

-- CreateIndex
CREATE INDEX "SharedEnvironmentHttpHeader_createdAt_idx" ON "SharedEnvironmentHttpHeader"("createdAt");

-- CreateIndex
CREATE INDEX "SharedEnvironmentHttpHeader_updatedAt_idx" ON "SharedEnvironmentHttpHeader"("updatedAt");

-- CreateIndex
CREATE INDEX "UserEnvironment_userId_idx" ON "UserEnvironment"("userId");

-- CreateIndex
CREATE INDEX "UserEnvironment_createdAt_idx" ON "UserEnvironment"("createdAt");

-- CreateIndex
CREATE INDEX "UserEnvironment_updatedAt_idx" ON "UserEnvironment"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserEnvironment_userId_name_key" ON "UserEnvironment"("userId", "name");

-- CreateIndex
CREATE INDEX "UserEnvironmentHttpHeader_environmentId_endpointRole_idx" ON "UserEnvironmentHttpHeader"("environmentId", "endpointRole");

-- CreateIndex
CREATE INDEX "UserEnvironmentHttpHeader_createdAt_idx" ON "UserEnvironmentHttpHeader"("createdAt");

-- CreateIndex
CREATE INDEX "UserEnvironmentHttpHeader_updatedAt_idx" ON "UserEnvironmentHttpHeader"("updatedAt");

-- AddForeignKey
ALTER TABLE "SharedEnvironmentHttpHeader" ADD CONSTRAINT "SharedEnvironmentHttpHeader_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "SharedEnvironment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEnvironment" ADD CONSTRAINT "UserEnvironment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEnvironmentHttpHeader" ADD CONSTRAINT "UserEnvironmentHttpHeader_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "UserEnvironment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
