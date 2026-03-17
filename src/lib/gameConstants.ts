/** Available character avatars */
export interface CharacterDef {
  id: string;
  label: string;
  image: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'saylor', label: 'Michael Saylor', image: 'https://blossom.ditto.pub/b25f1aee36f027a21a22a3847560a3a94806139bae88d137a9e5f8e4975f4535.png' },
  { id: 'dorsey', label: 'Jack Dorsey', image: 'https://blossom.primal.net/3a097fc231b288a6a808069aca47478c8fde0f8b0fe392cfe5e7c190cb4126ad.png' },
  { id: 'mow', label: 'Samson Mow', image: 'https://blossom.primal.net/2935eaf91220854c6fef928f88fe749dba5a5ae6574ac6c322817a885162f120.png' },
  { id: 'saifedean', label: 'Saifedean Ammous', image: 'https://blossom.primal.net/86f879c50e217870621bb65b5b92a5262f206c225cce9753c27e8a7d3a60d837.png' },
];

/** Nostr event kinds for the SatMiner game */
export const GAME_KINDS = {
  /** Addressable event: Game lobby room */
  LOBBY: 35303,
  /** Regular event: Player game actions (moves, swings) */
  ACTION: 1159,
  /** Regular event: Game result / win claim */
  RESULT: 7107,
} as const;

/** Minimum bet in satoshis */
export const MIN_BET_SATS = 10;

/** Maximum players per game */
export const MAX_PLAYERS = 8;

/** Action types */
export const ACTION_TYPES = {
  MOVE: 'move',
  SWING: 'swing',
  JOIN: 'join',
  READY: 'ready',
  /**
   * Full player state snapshot (position + mined cells).
   * Replaces per-move events for remote player synchronisation.
   * Published on the same kind (ACTION) with the same #d filter.
   */
  STATE: 'state',
} as const;

/**
 * How often (ms) each client broadcasts its full state to the relay.
 * Even if individual publishes drop, the next broadcast re-syncs everyone.
 */
export const STATE_BROADCAST_INTERVAL = 500;

/** Game balance constants */
export const HARDROCK_PROBABILITY = 0.3;
export const HARDROCK_HEALTH = 3;
export const BITCOIN_DEPTH_RATIO = 0.6;
export const BITCOIN_EDGE_BUFFER = 2;
export const SWING_ANIMATION_FRAMES = 8;
