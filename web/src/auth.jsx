import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useApolloClient, gql } from '@apollo/client'

const AuthContext = createContext(null)

const LOGIN_MUTATION = gql`
  mutation Login($id: ID!, $pin: String!) {
    login(id: $id, pin: $pin) {
      token
      mtumiaji { id jina jukumu }
    }
  }
`

const ME_QUERY = gql`
  query Me { me { id jina jukumu } }
`

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const client = useApolloClient()

  useEffect(() => {
    const token = localStorage.getItem('cc_token')
    if (!token) { setLoading(false); return }
    client.query({ query: ME_QUERY, fetchPolicy: 'network-only' })
      .then(({ data }) => { setUser(data.me); setLoading(false) })
      .catch(() => { localStorage.removeItem('cc_token'); setLoading(false) })
  }, [client])

  const login = useCallback(async (id, pin) => {
    const { data } = await client.mutate({ mutation: LOGIN_MUTATION, variables: { id, pin } })
    const { token, mtumiaji } = data.login
    localStorage.setItem('cc_token', token)
    setUser(mtumiaji)
    return mtumiaji
  }, [client])

  const logout = useCallback(() => {
    localStorage.removeItem('cc_token')
    setUser(null)
    client.resetStore()
  }, [client])

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}