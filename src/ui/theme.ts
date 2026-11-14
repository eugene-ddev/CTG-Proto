export const GAME_W = 1280;
export const GAME_H = 720;

/** Цвета сняты со скринов Unity-клиента. */
export const COLOR = {
  bg: 0x2b2c30,
  bgTop: 0x1d1e22,
  grid: 0xb4b4b4,

  title: '#f2b312', // «НОВЫЙ ПРОТИВНИК»
  ink: '#4a2a12', // тёмно-коричневый текст на пергаменте
  inkQuiet: '#8a6a48',
  light: '#e6e2d8', // светлый текст на тёмном фоне
  lightQuiet: '#a9a7a2',
  win: '#3fa535',
  lose: '#b5302c',
  pause: '#1e7be0',

  slotDark: 0x3c3c3e,
  slotDarkBorder: 0x4c4c4f,
  highlight: 0xf2b312,

  // полоски ресурсов (экран паузы)
  hp: 0xc80a0a,
  stamina: 0x00cc14,
  mana: 0x1478c8,
} as const;

/** Цвета блоков по стате — как BlockTypeColor в клиенте. */
export const STAT_COLOR = {
  Armor: 0x3a3a3a,
  Strength: 0xd01c1c,
  Dexterity: 0xf2c014,
  Intelligence: 0x1e74d0,
  Stamina: 0x22d022,
  Luck: 0xf07818,
} as const;

export const DEPTH = {
  ui: 10,
  modal: 500,
  tooltip: 1000,
} as const;
