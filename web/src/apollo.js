import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'

const API_URL = import.meta.env.VITE_API_URL || '/graphql'

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

export default new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
})