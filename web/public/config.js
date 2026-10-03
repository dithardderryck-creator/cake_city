// Which backend this build talks to.
//
// Resolved in this order, first match wins:
//
//   1. window.__CAKECITY_API_URL__ below — set per deployment, no rebuild needed
//   2. VITE_API_URL — baked in at build time from the environment
//   3. '/graphql' — same origin, which is right when the API ships in the same
//      deployment as this frontend
//
// The runtime file exists so one built bundle can be pointed at different
// servers. A till on the shop LAN, a staging box and the public deployment can
// each be handed a different address without rebuilding, which is what lets
// several front ends run against one backend.
//
// On Vercel this file is rewritten on every build, so prefer VITE_API_URL there
// and set it per environment. It pays off on self-hosted static deployments,
// where you can edit this file and reload.
//
// Set to '' to fall back to same-origin /graphql. Set to a full URL to point at
// another host, e.g. 'https://api.example.com/graphql'. That host must list this
// frontend's origin in the API's CORS_ORIGINS, otherwise the browser blocks it.
window.__CAKECITY_API_URL__ = ''
