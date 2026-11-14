export const SCENE = {
  boot: 'Boot',
  login: 'Login',
  menu: 'MainMenu',
  inventory: 'Inventory',
  blueprints: 'Blueprints',
  craft: 'Craft',
  characters: 'Characters',
  opponent: 'Opponent',
  rivals: 'Rivals',
  battle: 'Battle',
  uiKit: 'UiKit',
  models: 'Models',
  debug: 'Debug',
} as const;

export type SceneKey = (typeof SCENE)[keyof typeof SCENE];

/** Параметры, с которыми открывается сцена крафта. */
export interface CraftSceneData {
  blueprintId?: string;
  /** Изменить готового персонажа: тот же вид сборки, модель уже собрана его кубами. */
  editCharUid?: string;
}

/** Параметры окна «Персонажи»: открыть сразу этого персонажа (после крафта). */
export interface CharactersSceneData {
  charUid?: string;
}

/** «Новый противник»: боец игрока; противник берётся из серии (arenaRun.opp). */
export interface OpponentSceneData {
  charUid: string;
  /** Только если серии нет (запасной путь). */
  oppSeed?: number;
  except?: string;
}

/** Бой: боец, противник (по seed) и seed боя. */
export interface BattleSceneData {
  /** Боец серии. Противник и зерно боя — в состоянии (arenaRun), их выдаёт сервер. */
  charUid: string;
}
