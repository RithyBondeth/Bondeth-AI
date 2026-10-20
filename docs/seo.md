# Search visibility and production launch

## What the application provides

- Unique server-rendered titles, descriptions, canonical URLs and Open Graph/Twitter cards for `/`, `/stt`, `/tts`, `/clone`, `/api`, and `/voice-consent`.
- A public-page-only `/sitemap.xml` and a `/robots.txt` that points to it when indexing is enabled.
- Authored JSON-LD: WebSite and WebApplication on the homepage, page information and breadcrumbs on the other public pages. No fabricated ratings, reviews, prices, or search actions.
- `noindex, nofollow, noarchive, nosnippet` on sign-in, registration, password/email flows, account, API keys, audio library, saved voices, history and individual transcripts. Private URLs and reset/verification tokens are never used in canonical metadata or structured data.
- Localhost deployments are non-indexable. Staging deployments can explicitly disable indexing.

These are search-engine directives, not security controls. Existing backend authentication and authorization still protect private data. Public robots rules deliberately allow crawlers to read the private pages' `noindex` tags.

## Set the canonical production origin before building

For Docker Compose, set these values in the root `.env`:

```dotenv
PUBLIC_APP_URL=https://your-real-domain.example
SEO_INDEXING=true
```

For a standalone frontend deployment, use the frontend environment/build settings instead:

```dotenv
NEXT_PUBLIC_APP_URL=https://your-real-domain.example
SEO_INDEXING=true
```

Replace the example domain with the domain you actually own. The value must be an HTTP(S) origin without a path, credentials, query or fragment; HTTPS is recommended for production. Rebuild the frontend after changing either value: metadata and discovery files are prerendered at build time. Compose passes `PUBLIC_APP_URL` into `NEXT_PUBLIC_APP_URL` as a build argument.

For preview/staging deployments, set `SEO_INDEXING=false` before building. This produces `noindex` page metadata, a crawl-disallow policy, and an empty sitemap. Production must use the real production origin and must not inherit a preview build. If the origin is localhost, indexing stays disabled even if this switch is true.

## Launch verification

1. Check the live site's source, not only the hydrated browser DOM. Confirm each public page has its own title/description and exactly one absolute canonical URL with no tracking parameters.
2. Fetch `/robots.txt` and `/sitemap.xml`. Both must return HTTP 200; the sitemap must contain only the six public canonical URLs on the production domain. Ensure hosting/CDN rules are not adding a conflicting `X-Robots-Tag: noindex`.
3. Confirm sign-in, account, library and transcript pages return `noindex` even when their URL contains a query string. Do not add private content to a sitemap.
4. Open the social image URLs from the page source and verify they return public PNG images. Social card titles and descriptions should match the page, not the generic homepage.
5. Add and verify the production domain in Google Search Console (DNS verification is suitable and does not need a source-code token). Submit `/sitemap.xml`; inspect the homepage and core tool URLs and request indexing as appropriate. Repeat with Bing Webmaster Tools if desired.
6. Use the Rich Results Test and Schema Markup Validator to inspect JSON-LD. Valid schema does not guarantee a rich result; application review/offer fields are intentionally omitted rather than invented.
7. Measure production Core Web Vitals with PageSpeed Insights and Search Console. Local build success and responsive browser tests are not field performance measurements. Investigate actual LCP, INP and CLS data before claiming performance scores.

## Language scope

The current UI switches English/Khmer using a browser preference on the same URLs. English is the server-rendered language. Metadata and JSON-LD describe that default content; the language toggle updates the visible browser title and document language.

No `hreflang` variants are emitted because independent, server-rendered Khmer URLs do not yet exist. Do not point both languages at the same URL or advertise nonexistent `/km` pages. A future locale-routing migration should render translated content and metadata on stable URLs, add reciprocal/self-referencing `hreflang` links, update the sitemap, and preserve existing links and preferences.

## Verification commands

```sh
cd frontend
npm run lint
npm run build
npx playwright test seo.spec.ts localization.spec.ts api-docs.spec.ts
```

To exercise the enabled-indexing branch locally, build with a reserved test origin (never deploy this build):

```sh
NEXT_PUBLIC_APP_URL=https://seo.example.test SEO_INDEXING=true npm run build
npx playwright test seo.spec.ts
```

Also build with `SEO_INDEXING=false` and rerun the SEO tests to verify preview behavior. Restore the normal development build afterwards. On machines without Playwright's bundled Chromium, use `PLAYWRIGHT_CHANNEL=chrome` if Google Chrome is installed.

## References

- [Google Search developer guide](https://developers.google.com/search/docs/fundamentals/get-started-developers)
- [Prevent indexing with noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Multilingual site guidance](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)

SEO foundations make the site easier to discover and interpret; they cannot guarantee crawling, indexing, rankings, or traffic. Search Console verification, production measurements, useful content and promotion require ongoing work outside the codebase.
