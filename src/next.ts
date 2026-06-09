/**
 * next.ts — Next.js config helper.
 *
 * webpack does not treat `.wasm` as an asset by default, so the standard build
 * variant needs a one-line rule. `withOpenSlide` injects it (and chains any existing
 * `webpack` function), turning the manual recipe into:
 *
 * ```js
 * // next.config.js
 * const { withOpenSlide } = require('@computationalpathologygroup/openslide-js/next');
 * module.exports = withOpenSlide({ /* your config *\/ });
 * ```
 *
 * Note: you still need the COOP/COEP headers (SharedArrayBuffer is required). See
 * INTEGRATION.md. If you use the `/single` variant, you do NOT need this helper — the
 * `.wasm` is inlined there.
 *
 * Typed structurally so the package does not depend on `next` at build time.
 */
interface WebpackModule {
  rules?: unknown[];
}
interface WebpackConfig {
  module?: WebpackModule;
}
export interface NextConfig {
  webpack?: (config: WebpackConfig, context: unknown) => WebpackConfig;
  [key: string]: unknown;
}

export function withOpenSlide(nextConfig: NextConfig = {}): NextConfig {
  return {
    ...nextConfig,
    webpack(config: WebpackConfig, context: unknown): WebpackConfig {
      config.module ??= {};
      config.module.rules ??= [];
      config.module.rules.push({ test: /\.wasm$/, type: 'asset/resource' });
      // Preserve a user-supplied webpack() so we compose instead of clobbering it.
      return typeof nextConfig.webpack === 'function'
        ? nextConfig.webpack(config, context)
        : config;
    },
  };
}
