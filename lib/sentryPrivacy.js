// What Sentry may collect, shared by the browser, server and edge configs.
//
// Privacy: never send user-identifiable data, cookies, headers, query strings
// or request bodies. Customer names, addresses and quote contents must not
// leave the app.
//
// Every key is spelled out ON PURPOSE. In Sentry 10, passing a `dataCollection`
// object makes any key left out fall back to Sentry's most permissive default
// (user info, cookies, all headers, query strings, stack-frame variables) and
// ignores sendDefaultPii entirely. So never shorten this to only the keys that
// matter today. lib/sentryScrub.js strips access tokens on top of this.
//
// Session Replay is not used: no config adds replayIntegration, and the
// Next.js SDK doesn't add it by default. Keep it that way unless privacy is
// reviewed first -- it records what's on screen.
export const SENTRY_PRIVACY = {
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    queryParams: false,
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
  },
};
