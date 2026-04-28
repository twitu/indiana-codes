import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://twitu.github.io',
  base: '/indiana-codes',

  integrations: [
    starlight({
      title: 'Read the codebase like a book. Argue with every chapter.',
      description: 'Code Archaeology — read a codebase like a book. Chapter by chapter, with interactive Q&A.',
      customCss: ['./src/styles/dig.css'],
      pagefind: false,
      expressiveCode: {
        // Muted, near-monochrome themes that blend with the parchment palette
        // instead of fighting it like the default VSCode-derived themes.
        themes: ['vitesse-light', 'vitesse-dark'],
        styleOverrides: {
          borderRadius: '2px',
          borderColor: 'var(--sl-color-hairline)',
          codeFontFamily: 'var(--sl-font-mono)',
          codeFontSize: '0.95rem',
          codeLineHeight: '1.55',
          frames: {
            shadowColor: 'transparent',
          },
        },
      },
      components: {
        // Override: default to LIGHT theme when OS has no color-scheme preference.
        ThemeProvider: './src/components/ThemeProvider.astro',
        // Two-line site title: "Code Archaeology" eyebrow + tagline.
        SiteTitle: './src/components/SiteTitle.astro',
        // Adds an Install CTA to the header before the social icons.
        SocialIcons: './src/components/SocialIcons.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/twitu/indiana-codes',
        },
      ],
      sidebar: [
        { label: 'Home', link: '/' },
        { label: 'Install', link: '/install/' },
        { label: 'Other agents', link: '/other-agents/' },
        {
          label: 'The books',
          items: [
            { label: 'All books', link: '/books/' },
            {
              label: 'vLLM',
              collapsed: false,
              items: [
                { label: 'Project History', link: '/books/vllm/' },
                { label: 'Architecture Insights', link: '/books/vllm/insights/' },
                {
                  label: 'Chapters',
                  collapsed: false,
                  items: [
                    { label: '010 · PagedAttention prototype',     link: '/books/vllm/chapters/chapter-010-pagedattention-prototype/' },
                    { label: '020 · Launch & ecosystem',           link: '/books/vllm/chapters/chapter-020-launch-and-ecosystem/' },
                    { label: '030 · Production hardening',         link: '/books/vllm/chapters/chapter-030-production-hardening/' },
                    { label: '040 · The performance push',         link: '/books/vllm/chapters/chapter-040-the-performance-push/' },
                    { label: '050 · V1 engine rewrite',            link: '/books/vllm/chapters/chapter-050-v1-engine-rewrite/' },
                    { label: '060 · V0 sunset, distributed era',   link: '/books/vllm/chapters/chapter-060-v0-sunset-distributed-serving/' },
                    { label: '070 · Multimodal & MoE refactor',    link: '/books/vllm/chapters/chapter-070-multimodal-and-moe-refactor/' },
                    { label: '080 · vLLM IR & the modern era',     link: '/books/vllm/chapters/chapter-080-vllm-ir-and-modern-era/' },
                  ],
                },
              ],
            },
            {
              label: 'NautilusTrader',
              collapsed: false,
              items: [
                { label: 'Project History', link: '/books/nautilus_trader/' },
                { label: 'Architecture Insights', link: '/books/nautilus_trader/insights/' },
                {
                  label: 'Chapters',
                  collapsed: true,
                  items: [
                    { label: '010 · Genesis (Cython FX prototype)',          link: '/books/nautilus_trader/chapters/chapter-010-genesis-cython-fx-prototype/' },
                    { label: '020 · Going public (open-source cutover)',     link: '/books/nautilus_trader/chapters/chapter-020-going-public-open-source/' },
                    { label: '030 · First tagged releases',                  link: '/books/nautilus_trader/chapters/chapter-030-first-tagged-releases/' },
                    { label: '040 · Identity crisis (InstrumentId)',         link: '/books/nautilus_trader/chapters/chapter-040-identity-crisis-instrumentid/' },
                    { label: '050 · MessageBus, Cache, Parquet',             link: '/books/nautilus_trader/chapters/chapter-050-messagebus-cache-parquet/' },
                    { label: '060 · Adapter pluralism, msgspec',             link: '/books/nautilus_trader/chapters/chapter-060-adapter-pluralism-msgspec/' },
                    { label: '070 · The Rust beachhead',                     link: '/books/nautilus_trader/chapters/chapter-070-rust-beachhead/' },
                    { label: '080 · The PyO3 migration',                     link: '/books/nautilus_trader/chapters/chapter-080-pyo3-migration/' },
                    { label: '090 · Adapter boom',                           link: '/books/nautilus_trader/chapters/chapter-090-adapter-boom/' },
                    { label: '100 · The engine port to Rust',                link: '/books/nautilus_trader/chapters/chapter-100-engine-port-rust/' },
                    { label: '110 · High-precision (128-bit) value types',   link: '/books/nautilus_trader/chapters/chapter-110-high-precision-mode/' },
                    { label: '120 · uv, mark prices, OwnOrderBook',          link: '/books/nautilus_trader/chapters/chapter-120-uv-markprice-ownbook/' },
                    { label: '130 · Hardening, blockchain, Hyperliquid',     link: '/books/nautilus_trader/chapters/chapter-130-hardening-blockchain-hyperliquid/' },
                    { label: '140 · Crash-only, multi-account, Kraken/AX',   link: '/books/nautilus_trader/chapters/chapter-140-crash-only-multi-account/' },
                    { label: '150 · Toward 2.0 (bon, v2 LiveNode, DST)',     link: '/books/nautilus_trader/chapters/chapter-150-toward-2-0-bon-dst/' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  ],
});
