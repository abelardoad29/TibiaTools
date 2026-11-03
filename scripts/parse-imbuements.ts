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

// La página es de TibiaWiki BR: la descripción viene en portugués. El efecto se guarda en inglés, con los
// nombres de tibiawiki-sql (TibiaWiki EN, parsers/imbuement.py). Un imbuement nuevo sin traducción detiene el script.
const EFFECT_EN: Record<string, string> = {
  Bash: 'Club Fighting',
  Punch: 'Fist Fighting',
  Chop: 'Axe Fighting',
  Slash: 'Sword Fighting',
  Precision: 'Distance Fighting',
  Blockade: 'Shielding',
  Epiphany: 'Magic Level',
  Scorch: 'Fire Damage',
  Venom: 'Earth Damage',
  Frost: 'Ice Damage',
  Electrify: 'Energy Damage',
  Reap: 'Death Damage',
  Vampirism: 'Life Leech',
  Void: 'Mana Leech',
  Strike: 'Critical Hit',
  'Lich Shroud': 'Death Protection',
  'Snake Skin': 'Earth Protection',
  'Quara Scale': 'Ice Protection',
  'Dragon Hide': 'Fire Protection',
  'Cloud Fabric': 'Energy Protection',
  'Demon Presence': 'Holy Protection',
  Swiftness: 'Speed',
  Featherweight: 'Capacity',
  Vibrancy: 'Paralysis Removal',
}

// Cada bloque es "Nombre (descripción en portugués)" seguido de tres pares cantidad/material.
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
  const effect = EFFECT_EN[head[1]!]
  if (!effect) throw new Error(`Falta el efecto en inglés de "${head[1]}" (descripción PT: ${head[2]}) en EFFECT_EN`)
  imbuements.push({ name: head[1]!, effect, materials })
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
      notes:
        'Tarifas: noticia oficial de Tibia del 12-06-2025 (100 % de éxito). Duración de 20 h: TibiaWiki BR. Gold Tokens por paquete (2/4/6) y costo por hora (total/20): NabBot. Efectos en inglés: tibiawiki-sql (TibiaWiki EN).',
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
