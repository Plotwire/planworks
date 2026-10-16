// Names this build for the service worker (public/sw.js): a new deploy
// installs a new worker, which drops the previous build's cached pages.
// Vercel sets VERCEL_GIT_COMMIT_SHA; a local build uses the time.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`).slice(0, 24);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // The service worker itself must never be cached by the browser, or a new
  // deploy's worker would be missed.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] }];
  },
  // ESLint isn't configured yet; setting it up is a separate cleanup, so we
  // don't let it block Vercel builds for now. Revisit when we add tooling.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Type errors now FAIL the build instead of shipping silently. The project
  // type-checks clean today, so this is a pure safety net: a future change that
  // breaks types gets caught here rather than reaching users.
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;


// Injected content via Sentry wizard below

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "plotwire-uk-ltd",
  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
