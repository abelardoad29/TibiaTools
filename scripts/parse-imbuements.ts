// Genera seed/imbuements.json desde una copia guardada de https://www.tibiawiki.com.br/wiki/Imbuements
// (HTML de la página, o el JSON de api.php?action=parse&prop=text). La wiki rechaza clientes que no
// son navegadores, así que la página se guarda a mano desde el navegador y se pasa como argumento.
// Uso: node scripts/parse-imbuements.ts <archivo>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = process.argv[2]
if (!file) throw new Error('Uso: node scripts/parse-imbuements.ts <pagina-guardada.html|json>')

const raw = readFileSync(file, 'utf8')
const html = raw.trimStart().startsWith('{') ? (JSON.parse(raw) as { parse: { text: { '*': string } } }).parse.text['*'] : raw
const lines = html
  .replace(/<[^>]+>/g, '\n')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

const seedDir = join(import.meta.dirname, '..', 'seed')
const catalog = JSON.parse(readFileSync(join(seedDir, 'items.json'), 'utf8')) as { items: { name: string; wikiName: string | null }[] }
const known = new Set(catalog.items.flatMap((i) => [i.name.toLowerCase(), (i.wikiName ?? '').toLowerCase()]))

// Cada bloque es "Nombre (descripción)" seguido de tres pares cantidad/material.
const imbuements: { name: string; effect: string; materials: { qty: number; item: string }[] }[] = []
for (let i = 0; i < lines.length; i++) {
  const head = /^([A-Z][A-Za-z' ]+) \((.+)\)$/.exec(lines[i]!)
  if (!head) continue
  const materials: { qty: number; item: string }[] = []
  let j = i + 1
  while (materials.length < 3 && j + 1 < lines.length && /^\d+$/.test(lines[j]!)) {
    materials.push({ qty: Number(lines[j]), item: lines[j + 1]!.replace(/ \(Item\)$/, '') })
    j += 2
  }
  if (materials.length !== 3) continue
  imbuements.push({ name: head[1]!, effect: head[2]!, materials })
  i = j - 1
}

const unknown = imbuements.flatMap((imb) => imb.materials.map((m) => m.item)).filter((n) => !known.has(n.toLowerCase()))
if (unknown.length) console.warn('Materiales que no están en seed/items.json:', unknown)

writeFileSync(
  join(seedDir, 'imbuements.json'),
  JSON.stringify(
    {
      source: 'https://www.tibiawiki.com.br/wiki/Imbuements',
      parsedAt: new Date().toISOString(),
      // Basic usa el material 1, Intricate 1+2 y Powerful 1+2+3 (acumulativo).
      // Tarifas del santuario: misma página ("Custo de 7 500 / 60 000 / 250 000 gps") y noticia oficial del 12-06-2025.
      tiers: [
        { tier: 'Basic', materials: 1, shrineFeeGp: 7_500 },
        { tier: 'Intricate', materials: 2, shrineFeeGp: 60_000 },
        { tier: 'Powerful', materials: 3, shrineFeeGp: 250_000 },
      ],
      // Según la página, Yana cambia Gold Tokens por materiales solo de estos tres.
      tokenTradeable: ['Strike', 'Vampirism', 'Void'],
      // Paquete de materiales de cada tier en Gold Tokens (NabBot / TibiaWiki) y duración de 20 h.
      tokensPerTier: { Basic: 2, Intricate: 4, Powerful: 6 },
      durationHours: 20,
      imbuements,
    },
    null,
    1,
  ) + '\n',
  'utf8',
)
console.log(`seed/imbuements.json: ${imbuements.length} imbuements`)
