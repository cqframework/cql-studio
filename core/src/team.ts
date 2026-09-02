// Author: Preston Lee

export type TeamMemberRole = 'ADMIN' | 'MEMBER';

export interface Team {
  id: string;
  name: string;
  slug: string;
  createdByUserId: string;
  createdAt: string;
  myRole?: TeamMemberRole;
}

export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  role: TeamMemberRole;
  createdAt: string;
  updatedAt: string;
}
