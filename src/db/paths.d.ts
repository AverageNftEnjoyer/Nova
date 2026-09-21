export const DB_FILENAME: "nova.db"
export function resolveWorkspaceRoot(startDir?: string): string
export function resolveDataDir(): string
export function restrictDirToCurrentUser(dir: string): boolean
export function resolveUserContextRoot(): string
