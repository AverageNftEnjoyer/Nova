/** Every secret-bearing field path of IntegrationsConfig ("a[]" = array elements, "*" = every object key). */
export const SECRET_FIELD_PATHS: readonly string[]

/** Deep clone of `config` with each registered secret string replaced by `mapper(value, path)`. */
export function mapSecretFields<T>(config: T, mapper: (value: string, path: string) => string): T

/** Every non-empty registered secret value as `{ path, value }`. */
export function collectSecretValues(config: unknown): { path: string; value: string }[]
