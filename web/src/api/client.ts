import { useUi } from '@/store/ui'

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'

export class ApiError extends Error {
  constructor(message: string, public status: number, public offline?: boolean) {
    super(message)
  }
}

/** fetch JSON from the backend; mirrors the `offline` flag of every response into the UI store (D4). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, init)
  } catch (e) {
    if (init?.signal?.aborted) throw e                 // cancelled by the caller: not an outage
    useUi.getState().setApiReachable(false)
    throw new ApiError('API unreachable', 0)
  }
  useUi.getState().setApiReachable(true)
  const body = await res.json().catch(() => ({}))
  if (typeof body?.offline === 'boolean') useUi.getState().setOffline(body.offline)
  if (!res.ok) throw new ApiError(body?.detail ?? `HTTP ${res.status}`, res.status, body?.offline)
  return body as T
}
