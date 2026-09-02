-- DropForeignKey
ALTER TABLE "WorkspaceShareLink" DROP CONSTRAINT "WorkspaceShareLink_createdByUserId_fkey";
-- DropForeignKey
ALTER TABLE "WorkspaceShareLink" DROP CONSTRAINT "WorkspaceShareLink_workspaceId_fkey";
-- AlterTable
ALTER TABLE "WorkspaceAccessGrant" DROP COLUMN "isGuest";
-- DropTable
DROP TABLE "WorkspaceShareLink";
