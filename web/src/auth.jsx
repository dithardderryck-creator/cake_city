import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useApolloClient, gql } from '@apollo/client'

const AuthContext = createContext(null)

const LOGIN_MUTATION = gql`
  mutation Login($id: ID!, $pin: String!, $kifaa: String) {
    login(id: $id, pin: $pin, kifaa: $kifaa) {
      token
      mtumiaji { id jina jukumu }
      kifaa { id alama jina }
    }
  }
`

// BR-26: the till claims its prefix once, here, and the claim rides in the token
// from then on. Remembered so a shop types it on the first login of a device and
// never again — but it stays editable, because a till can be re-registered with a
// new prefix and the next login should pick that up.
const KIFAA_KEY = 'cc_kifaa'

export function savedKifaa() {
  return localStorage.getItem(KIFAA_KEY) || ''
}

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

  const login = useCallback(async (id, pin, kifaa) => {
    const alama = (kifaa || '').trim().toUpperCase()
    const { data } = await client.mutate({
      mutation: LOGIN_MUTATION,
      variables: { id, pin, kifaa: alama || null },
    })
    const { token, mtumiaji, kifaa: till } = data.login
    localStorage.setItem('cc_token', token)
    // Only remember a prefix the server actually accepted. Storing a rejected one
    // would silently prefill the wrong till on every later login.
    if (till?.alama) localStorage.setItem(KIFAA_KEY, till.alama)
    else localStorage.removeItem(KIFAA_KEY)
    setUser(mtumiaji)
    return { ...mtumiaji, kifaa: till || null }
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