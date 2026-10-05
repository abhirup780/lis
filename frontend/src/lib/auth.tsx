import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [hasToken, setHasToken] = useState(() => Boolean(getToken()))

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<User>('/auth/me'),
    enabled: hasToken,
    retry: false,
    staleTime: Infinity,
  })

  const logout = useCallback(() => {
    setToken(null)
    setHasToken(false)
    queryClient.clear()
  }, [queryClient])

  useEffect(() => setUnauthorizedHandler(logout), [logout])

  const login = useCallback(
    async (username: string, password: string) => {
      const form = new URLSearchParams({ username, password })
      const { access_token } = await api<{ access_token: string }>('/auth/login', { method: 'POST', form })
      setToken(access_token)
      setHasToken(true)
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    [queryClient],
  )

  const user = hasToken ? (me.data ?? null) : null
  const value: AuthState = {
    user,
    loading: hasToken && me.isLoading,
    login,
    logout,
    can: (permission) => Boolean(user?.permissions.includes(permission)),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
