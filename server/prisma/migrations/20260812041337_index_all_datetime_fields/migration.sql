-- CreateIndex
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");

-- CreateIndex
CREATE INDEX "Session_updatedAt_idx" ON "Session"("updatedAt");

-- CreateIndex
CREATE INDEX "SharedEnvironment_createdAt_idx" ON "SharedEnvironment"("createdAt");

-- CreateIndex
CREATE INDEX "SharedEnvironment_updatedAt_idx" ON "SharedEnvironment"("updatedAt");

-- CreateIndex
CREATE INDEX "Team_createdAt_idx" ON "Team"("createdAt");

-- CreateIndex
CREATE INDEX "Team_updatedAt_idx" ON "Team"("updatedAt");

-- CreateIndex
CREATE INDEX "TeamMembership_createdAt_idx" ON "TeamMembership"("createdAt");

-- CreateIndex
CREATE INDEX "TeamMembership_updatedAt_idx" ON "TeamMembership"("updatedAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");

-- CreateIndex
CREATE INDEX "User_lastLoginAt_idx" ON "User"("lastLoginAt");

-- CreateIndex
CREATE INDEX "Workspace_createdAt_idx" ON "Workspace"("createdAt");

-- CreateIndex
CREATE INDEX "Workspace_updatedAt_idx" ON "Workspace"("updatedAt");

-- CreateIndex
CREATE INDEX "WorkspaceAccessGrant_createdAt_idx" ON "WorkspaceAccessGrant"("createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceAccessGrant_updatedAt_idx" ON "WorkspaceAccessGrant"("updatedAt");

-- CreateIndex
CREATE INDEX "WorkspaceActivity_updatedAt_idx" ON "WorkspaceActivity"("updatedAt");

-- CreateIndex
CREATE INDEX "WorkspaceResourceReference_createdAt_idx" ON "WorkspaceResourceReference"("createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceResourceReference_updatedAt_idx" ON "WorkspaceResourceReference"("updatedAt");

-- RenameIndex
ALTER INDEX "WorkspaceResourceReference_workspaceId_resourceType_resourceId_" RENAME TO "WorkspaceResourceReference_workspaceId_resourceType_resourc_key";
