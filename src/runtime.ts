/** Build-time isolation: local preview never creates a server session or collaboration socket. */
export const isLocalMode = import.meta.env.VITE_LOCAL_MODE === 'true';
/** Preserve canonical preference paths while resolving deployed static assets under Vite's base URL. */
export function publicAsset(rootPath: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${rootPath.replace(/^\/+/, '')}`;
}
