/**
 * Resolves a file that ships in `public/` to a URL that works wherever the
 * build is served from.
 *
 * Vite rewrites asset references it can see at build time (imports, and the
 * paths inside `index.html`), but a path written as a plain string in
 * application code is invisible to it and ships unchanged. A leading slash
 * then means "the domain root", which is only correct when the game is served
 * from the root. On GitHub Pages the build lives under `/Permission-ZERO-1.2/`,
 * so `/player-ai-orange.png` asked for `https://host/player-ai-orange.png` and
 * every portrait, stage illustration, target card, and music track 404'd —
 * while the same build looked complete on a local server rooted at `/`.
 *
 * `import.meta.env.BASE_URL` carries whatever `base` the build was made with,
 * so the returned path stays correct at the root and under a subpath.
 */
// Test runners and tooling that load these modules outside a Vite transform
// have no `import.meta.env` at all, so the base is read defensively and falls
// back to the site root — the same value a root-served build would carry.
function buildBase(): string {
  const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
  return env?.BASE_URL ?? '/'
}

export function publicAssetUrl(path: string): string {
  // Leading './' is stripped as well as '/', so passing an already-resolved
  // path back through is harmless — many of these values travel through
  // presentation objects before they reach an <img>.
  return `${buildBase()}${path.replace(/^(?:\.?\/)+/, '')}`
}

/**
 * The same file, resolved to an absolute URL.
 *
 * A relative URL inside a stylesheet resolves against the stylesheet, not the
 * document, so a path handed to CSS — through a custom property that a rule
 * later drops into `url()`, for example — would be looked up under the
 * bundle's `assets/` folder instead of the site root. Resolving against
 * `document.baseURI` here removes the ambiguity for those cases.
 */
export function publicAssetHref(path: string): string {
  const resolved = publicAssetUrl(path)
  if (typeof document === 'undefined') return resolved
  return new URL(resolved, document.baseURI).href
}
