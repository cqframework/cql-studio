-- CreateTable
CREATE TABLE "WorkspaceResourceReference" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "displayName" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceResourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceResourceReference_workspaceId_idx" ON "WorkspaceResourceReference"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceResourceReference_createdByUserId_idx" ON "WorkspaceResourceReference"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceResourceReference_workspaceId_resourceType_resourceId_key" ON "WorkspaceResourceReference"("workspaceId", "resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "WorkspaceResourceReference" ADD CONSTRAINT "WorkspaceResourceReference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceResourceReference" ADD CONSTRAINT "WorkspaceResourceReference_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
