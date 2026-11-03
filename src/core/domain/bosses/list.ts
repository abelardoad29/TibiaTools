// Bosses y criaturas raras de aparición aleatoria que vale la pena revisar ("boss checks").
// `race` es el nombre tal como sale en las Kill Statistics de tibia.com (las criaturas comunes van en plural).
// Sin imports: lo usa también scripts/build-boss-stats.ts con Node directo.

export interface BossDef {
  name: string
  race: string
  group: string
}

const g = (group: string, names: string[]): BossDef[] => names.map((name) => ({ name, race: name, group }))

export const BOSSES: BossDef[] = [
  ...g('Archidemonios y raids mayores', ['Ferumbras', 'Ghazbaran', 'Morgaroth', 'Orshabaal', "Gaz'haragoth", 'Morshabaal', 'Devovorga', 'Zulazza the Corruptor']),
  ...g('Señores vampiro', ['Arachir the Ancient One', 'Diblis the Fair', 'Sir Valorcrest', 'The Pale Count', 'Zevelon Duskbringer']),
  ...g('Pits of Inferno', ['Countess Sorrow', 'Dracola', 'Massacre', 'Mr. Punish', 'The Handmaiden', 'The Imperor', 'The Plasmother']),
  ...g('Robo al banco', ['Elvira Hammerthrust', 'Jesse the Wicked', 'Mornenion', 'Robby the Reckless']),
  ...g('The Hive', ['The Hungerer', 'The Manhunter', 'The Mean Masher']),
  ...g('Heart of Destruction', ['Burster', 'Dreadful Disruptor']),
  ...g('Hielo', ['Zushuka', 'Hirintror', 'Ocyakao', 'Yakchal', 'Grand Mother Foulscale']),
  ...g('Rookgaard', ['Apprentice Sheng', 'Munster', 'Teleskor']),
  ...g('Otros', [
    'Arthom the Hunter',
    'Barbaria',
    'Battlemaster Zunzu',
    'Big Boss Trolliver',
    'Captain Jones',
    'Dharalion',
    'Dreadmaw',
    'Fernfang',
    'Feroxa',
    'Flamecaller Zazrak',
    'Fleabringer',
    'Foreman Kneebiter',
    'Furyosa',
    'General Murius',
    'Grandfather Tridian',
    'Gravelord Oshuran',
    'Groam',
    'Grorlam',
    'Hairman the Huge',
    'Hatebreeder',
    'High Templar Cobrass',
    'Horestis',
    'Mahatheb',
    'Man in the Cave',
    'Armenius',
    'Omrafir',
    'Oodok Witchmaster',
    'Rotrender',
    'Rotworm Queen',
    'Rukor Zad',
    'Shlorg',
    'Smuggler Baron Silvertoe',
    'The Abomination',
    'The Big Bad One',
    'The Evil Eye',
    'The Frog Prince',
    'The Old Whopper',
    'The Voice of Ruin',
    'The Welter',
    'Tyrn',
    'Tzumrah the Dazzler',
    'Warlord Ruzad',
    'White Pale',
    'Xenia',
    'Yaga the Crone',
    'Zarabustor',
  ]),
  { name: 'Yeti', race: 'yetis', group: 'Criaturas raras' },
  { name: 'Midnight Panther', race: 'midnight panthers', group: 'Criaturas raras' },
  { name: 'Undead Cavebear', race: 'undead cavebears', group: 'Criaturas raras' },
  { name: 'Draptor', race: 'draptors', group: 'Criaturas raras' },
  { name: 'Dire Penguin', race: 'dire penguins', group: 'Criaturas raras' },
  { name: 'Crustacea Gigantica', race: 'crustaceae giganticae', group: 'Criaturas raras' },
]
