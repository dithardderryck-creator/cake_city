import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'

/**
 * Which backend this frontend talks to.
 *
 * Three sources, first match wins, so the same code runs on a shop till, in
 * staging and in production without being edited:
 *
 *   1. window.__CAKECITY_API_URL__ from /config.js — per deployment
 *   2. VITE_API_URL — baked in at build time
 *   3. '/graphql' — same origin
 *
 * The default assumes the API is deployed alongside the frontend, which is how
 * vercel.json is wired (/graphql rewrites to the serverless function).
 */
function resolveApiUrl() {
  const runtime = typeof window !== 'undefined' ? window.__CAKECITY_API_URL__ : ''
  return runtime || import.meta.env.VITE_API_URL || '/graphql'
}

const API_URL = resolveApiUrl()

const httpLink = createHttpLink({ uri: API_URL })

const authLink = setContext((_, { headers }) => {
  const token = localStorage.getItem('cc_token')
  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
})

const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
})

export default apolloClient
