import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

export type Role = 'owner' | 'editor' | 'viewer';
export interface User { id: string; name: string; email: string; avatar: string }
export interface Membership {
  id: string; workspaceId: string; userId: string; role: Role;
  type: 'private' | 'group'; name: string;
}
export interface IntegrationContext {
  req: IncomingMessage; res: ServerResponse; url: URL;
  body: Record<string, unknown>; db: DatabaseSync; user: User | null;
  env: NodeJS.ProcessEnv;
  json: (status: number, data: unknown) => void;
  requireUser: () => User;
  requireWorkspace: (id: string, write?: boolean) => Membership;
  createGoogleSession: (profile: { sub: string; email: string; name: string; emailVerified: boolean }) => User;
  broadcast: (workspaceId: string, event: Record<string, unknown>) => void;
  readAttachment: (id: string) => { id: string; name: string; mime: string; size: number; workspaceId: string; bytes: Buffer };
}
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
