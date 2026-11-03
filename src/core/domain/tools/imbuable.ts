// Qué imbuements acepta un item. Fuente: TibiaWiki EN (seed/imbuable_items.json): cada item tiene sus slots
// (`imbueslots`), su tipo (`primarytype`) y vocación; cada imbuement lista los tipos de item que admite
// (campo `slots` de "Powerful X"). Las excepciones que el wiki solo menciona en notas (p. ej. Falcon Coif
// con Epiphany) no se deducen: la interfaz permite mostrar todos los imbuements para esos casos.

export interface ImbuableInfo {
  slots: number
  /** primarytype del wiki: "Helmets", "Sword Weapons", "Distance Weapons", … */
  type: string | null
  /** vocrequired del wiki, p. ej. "sorcerers and druids"; null = cualquier vocación. */
  vocations: string | null
}

const TYPE_KEYS: Record<string, string[]> = {
  'Club Weapons': ['clubs'],
  'Sword Weapons': ['swords'],
  'Axe Weapons': ['axes'],
  'Distance Weapons': ['bows', 'crossbows'],
  'Fist Fighting Weapons': ['fists'],
  Wands: ['wands'],
  Rods: ['rods'],
  Helmets: ['helmets'],
  Armors: ['armors'],
  Shields: ['shields'],
  Spellbooks: ['spellbooks'],
  Boots: ['boots'],
  Containers: ['containers'],
}

/** Palabras con que los imbuements nombran los tipos de item que admiten. */
export function slotKeys(item: ImbuableInfo): string[] {
  const keys = [...(item.type ? (TYPE_KEYS[item.type] ?? [item.type.toLowerCase()]) : [])]
  if (item.type === 'Helmets' && item.vocations) {
    const v = item.vocations.toLowerCase()
    if (v.includes('sorcerer')) keys.push('helmets (sorcerer)')
    if (v.includes('druid')) keys.push('helmets (druid)')
  }
  return keys
}

/** Imbuements que el item admite según el wiki (sin excepciones de notas). */
export function allowedImbuements(item: ImbuableInfo, slotTypes: Readonly<Record<string, readonly string[]>>): string[] {
  const keys = new Set(slotKeys(item))
  return Object.entries(slotTypes)
    .filter(([, types]) => types.some((t) => keys.has(t)))
    .map(([name]) => name)
}

/** Un item no puede llevar dos veces el mismo imbuement. Devuelve los repetidos. */
export function duplicateImbuements(slots: readonly ({ imbuement: string } | null)[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const s of slots) {
    if (!s) continue
    if (seen.has(s.imbuement)) dup.add(s.imbuement)
    seen.add(s.imbuement)
  }
  return [...dup]
}
