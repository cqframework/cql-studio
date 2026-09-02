// Author: Preston Lee

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface SessionResponse {
  enabled: boolean;
  user?: AuthUser;
}
