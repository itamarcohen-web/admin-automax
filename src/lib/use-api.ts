'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiRequestError, callApi } from './api'

interface State<T> { doneKey: string; data: T | null; error: ApiRequestError | null }

/**
 * Loads one admin-api action. Re-runs when action/params change (params must be JSON-serialisable and kept small: search text,
 * filters, limit/offset). While a newer request is running the previous data stays visible. Pass action = null to skip.
 */
export function useApi<T>(action: string | null, params: Record<string, unknown> = {}) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<State<T>>({ doneKey: '', data: null, error: null })
  const key = action ? `${JSON.stringify([action, params])}#${nonce}` : ''

  useEffect(() => {
    if (!key) return
    const ctrl = new AbortController()
    const [a, p] = JSON.parse(key.slice(0, key.lastIndexOf('#'))) as [string, Record<string, unknown>]
    callApi<T>(a, p, ctrl.signal)
      .then((data) => setState({ doneKey: key, data, error: null }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setState((s) => ({ doneKey: key, data: s.data, error: e instanceof ApiRequestError ? e : new ApiRequestError(0, 'error', 'Unable to load') }))
      })
    return () => ctrl.abort()
  }, [key])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data: state.data, error: key && state.doneKey === key ? state.error : null, loading: !!key && state.doneKey !== key, reload }
}
