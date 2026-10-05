const TOKEN_KEY = 'lis.token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage unavailable (private mode); the session then lasts until reload.
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((d) => {
          const loc = Array.isArray(d.loc) ? d.loc.filter((p: unknown) => p !== 'body').join('.') : ''
          return loc ? `${loc}: ${d.msg}` : d.msg
        })
        .join('; ')
    }
  }
  return fallback
}

type Query = Record<string, string | number | boolean | null | undefined>

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; form?: URLSearchParams } = {},
): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin)
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (options.form) {
    body = options.form
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const res = await fetch(url, { method: options.method ?? (body ? 'POST' : 'GET'), headers, body })
  if (res.status === 401 && token) {
    setToken(null)
    onUnauthorized()
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, `Request failed (${res.status})`))
  return data as T
}
