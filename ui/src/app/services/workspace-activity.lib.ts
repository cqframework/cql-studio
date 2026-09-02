// Author: Preston Lee

export const WORKSPACE_ACTIVITY_VERB_LABELS: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'workspace.updated': 'updated the workspace',
  'grant.upserted': 'added or updated an access grant',
  'grant.updated': 'updated an access grant',
  'grant.removed': 'removed an access grant',
  'share_link.created': 'created a share link',
  'share_link.redeemed': 'redeemed a share link',
  'environment.shared': 'shared an environment',
  'environment.updated': 'updated an environment',
  'environment.removed': 'removed an environment',
  'resource.added': 'added a resource reference',
  'resource.removed': 'removed a resource reference',
};

export function workspaceActivityVerbLabel(verb: string): string {
  return WORKSPACE_ACTIVITY_VERB_LABELS[verb] || verb;
}
