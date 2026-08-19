// Assembles a self-contained, static-hosting-ready copy of the landing page, demo,
// and docs pages, plus the distribution module they load — everything needed to
// serve the site, with none of the repo-only files (source, tests, internal ADRs)
// that don't belong on a public web server. Run via `npm run build:site`.

import { existsSync, mkdirSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'site')
const distModule = join(root, 'dist', 'query-shaper.js')
const localChatModule = join(root, 'node_modules', '@internetarchive', 'local-chat', 'dist', 'local-chat.js')

if (!existsSync(distModule)) {
  console.error(
    `Missing ${distModule} — run \`npm run build\` first (or use \`npm run build:site\`, which does this for you).`,
  )
  process.exit(1)
}

if (!existsSync(localChatModule)) {
  console.error(`Missing ${localChatModule} — run \`npm install\` first.`)
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// The one shared asset every page references by a relative path (./logo.svg from
// the root, ../logo.svg from demo/docs) — copying it to the same relative position
// keeps every existing reference working with no rewriting needed.
cpSync(join(root, 'logo.svg'), join(outDir, 'logo.svg'))

// logo.png isn't linked from any page, but it's copied alongside logo.svg so it's
// still available at a known path for anyone who needs the raster version directly.
cpSync(join(root, 'logo.png'), join(outDir, 'logo.png'))

// The social-preview banner every page's og:image/twitter:image points at by
// absolute URL (https://internetarchive.github.io/query-shaper/banner.png) — it
// has to actually exist at the site root once deployed.
cpSync(join(root, 'banner.png'), join(outDir, 'banner.png'))

// The built ESM module, placed at the site root so demo/docs's rewritten script tag
// (../query-shaper.js, see below) and any future top-level page can reach it the
// same way.
cpSync(distModule, join(outDir, 'query-shaper.js'))

// docs/ additionally loads local-chat's own module (a devDependency, never a runtime
// dependency of query-shaper itself) -- placed at the site root the same way, so its
// rewritten script tag (../local-chat.js, see below) can reach it too.
cpSync(localChatModule, join(outDir, 'local-chat.js'))

// The landing page doesn't load the module at all (its mock search box is
// decorative), so it's copied verbatim.
cpSync(join(root, 'index.html'), join(outDir, 'index.html'))

// demo/ and docs/ each load the module via a dev-only path (../src/index.ts) that
// only Vite's dev server knows how to serve — rewritten to the built module instead.
// docs/ also holds adr/ and agents/ (internal, maintainer-only), deliberately not
// copied.
for (const page of ['demo', 'docs']) {
  let html = readFileSync(join(root, page, 'index.html'), 'utf8')
  const rewritten = html.replace('src="../src/index.ts"', 'src="../query-shaper.js"')
  if (rewritten === html) {
    console.error(`Expected to rewrite a script src in ${page}/index.html but found nothing to replace.`)
    process.exit(1)
  }
  html = rewritten

  // docs/ also loads local-chat's dev-only node_modules path -- rewritten to the
  // site-relative copy above the same way.
  if (page === 'docs') {
    const rewrittenLocalChat = html.replace(
      'src="../node_modules/@internetarchive/local-chat/dist/local-chat.js"',
      'src="../local-chat.js"',
    )
    if (rewrittenLocalChat === html) {
      console.error(`Expected to rewrite local-chat's script src in ${page}/index.html but found nothing to replace.`)
      process.exit(1)
    }
    html = rewrittenLocalChat
  }

  mkdirSync(join(outDir, page), { recursive: true })
  writeFileSync(join(outDir, page, 'index.html'), html)
}

console.log(`Wrote a self-contained site to ${outDir}:`)
console.log('  index.html')
console.log('  logo.svg')
console.log('  logo.png')
console.log('  banner.png')
console.log('  query-shaper.js')
console.log('  local-chat.js')
console.log('  demo/index.html')
console.log('  docs/index.html')
console.log('\nCopy the contents of site/ to any static web server.')
