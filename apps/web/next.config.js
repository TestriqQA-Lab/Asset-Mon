/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@assetmon/shared'],
  // Emit a self-contained server under .next/standalone, with only the modules the
  // app actually reaches. The host is Hostinger's shared plan, where an install of
  // the full dependency tree is slow and the app is killed if it has not called
  // listen() within three seconds — a bundled server starts well inside that.
  //
  // NEXT_PUBLIC_* values are compiled into the bundle at build time, so this build
  // must run with the production API and site URLs set. apps/web/.env.local holds
  // localhost values for development; a shell variable overrides it, which is why
  // the deploy script sets them explicitly rather than relying on that file's absence.
  output: 'standalone',
};
module.exports = nextConfig;
