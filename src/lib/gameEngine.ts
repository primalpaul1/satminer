/**
 * SatMiner Game Engine
 * 
 * The game grid is a 2D array of cells. Each cell can be:
 * - empty (air/already mined)
 * - rock (needs to be mined)
 * - hard_rock (takes 2 hits)
 * - bitcoin (hidden treasure - the goal!)
 * - bedrock (unbreakable border)
 * 
 * The bitcoin location is deterministically generated from the game seed,
 * so all players have the same hidden bitcoin position.
 */

import { HARDROCK_PROBABILITY, HARDROCK_HEALTH, BITCOIN_DEPTH_RATIO, BITCOIN_EDGE_BUFFER, CHARACTERS } from './gameConstants';

const VALID_CHARACTER_IDS = new Set(CHARACTERS.map(c => c.id));

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 14;
export const CELL_SIZE = 40; // pixels

export type CellType = 'empty' | 'rock' | 'hard_rock' | 'bitcoin' | 'bedrock' | 'surface';

export interface Cell {
  type: CellType;
  health: number; // hits remaining before breaking
  revealed: boolean; // has been mined
}

export interface PlayerState {
  x: number;
  y: number;
  direction: 'left' | 'right' | 'up' | 'down';
  isSwinging: boolean;
  swingFrame: number;
  pubkey: string;
  color: string;
  characterId: string;
}

export interface GameState {
  grid: Cell[][];
  players: Map<string, PlayerState>;
  bitcoinX: number;
  bitcoinY: number;
  winner: string | null;
  gameId: string;
  seed: string;
  started: boolean;
}

// Seeded PRNG (simple mulberry32)
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

const PLAYER_COLORS = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export function getPlayerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

/** Check that a cell at (targetX, targetY) is reachable from the surface via mineable cells. */
function isReachable(grid: Cell[][], targetX: number, targetY: number): boolean {
  const visited = new Set<string>();
  const queue: [number, number][] = [];

  // Start from all surface cells (row 0 and 1)
  for (let x = 0; x < GRID_WIDTH; x++) {
    if (grid[1][x].type === 'surface') {
      queue.push([x, 1]);
      visited.add(`${x},1`);
    }
  }

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    if (cx === targetX && cy === targetY) return true;

    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const cell = grid[ny][nx];
      // Can traverse empty, surface, rock, hard_rock, and bitcoin — NOT bedrock
      if (cell.type !== 'bedrock') {
        queue.push([nx, ny]);
      }
    }
  }

  return false;
}

export function createGrid(seed: string): { grid: Cell[][]; bitcoinX: number; bitcoinY: number } {
  const rng = mulberry32(hashString(seed));
  const grid: Cell[][] = [];

  // Generate grid
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      // Top 2 rows are surface/air
      if (y < 2) {
        row.push({ type: 'surface', health: 0, revealed: true });
      }
      // Border is bedrock
      else if (x === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1) {
        row.push({ type: 'bedrock', health: Infinity, revealed: true });
      }
      // Underground: mix of rock and hard rock
      else {
        const val = rng();
        if (val < HARDROCK_PROBABILITY) {
          row.push({ type: 'hard_rock', health: HARDROCK_HEALTH, revealed: false });
        } else {
          row.push({ type: 'rock', health: 1, revealed: false });
        }
      }
    }
    grid.push(row);
  }

  // Place bitcoin in the bottom portion of the grid, away from edges
  const minY = Math.floor(GRID_HEIGHT * BITCOIN_DEPTH_RATIO);
  const maxY = GRID_HEIGHT - 2;
  const minX = BITCOIN_EDGE_BUFFER;
  const maxX = GRID_WIDTH - BITCOIN_EDGE_BUFFER - 1;

  let bitcoinX = minX + Math.floor(rng() * (maxX - minX + 1));
  let bitcoinY = minY + Math.floor(rng() * (maxY - minY + 1));

  // Set the bitcoin cell
  grid[bitcoinY][bitcoinX] = { type: 'bitcoin', health: 1, revealed: false };

  // Verify bitcoin is reachable; if not, find the nearest reachable cell in the valid range
  if (!isReachable(grid, bitcoinX, bitcoinY)) {
    grid[bitcoinY][bitcoinX] = { type: 'rock', health: 1, revealed: false };
    let placed = false;
    for (let y = minY; y <= maxY && !placed; y++) {
      for (let x = minX; x <= maxX && !placed; x++) {
        if (grid[y][x].type !== 'bedrock' && isReachable(grid, x, y)) {
          bitcoinX = x;
          bitcoinY = y;
          grid[y][x] = { type: 'bitcoin', health: 1, revealed: false };
          placed = true;
        }
      }
    }
  }

  return { grid, bitcoinX, bitcoinY };
}

export function createGameState(gameId: string, seed: string): GameState {
  const { grid, bitcoinX, bitcoinY } = createGrid(seed);

  return {
    grid,
    players: new Map(),
    bitcoinX,
    bitcoinY,
    winner: null,
    gameId,
    seed,
    started: false,
  };
}

export function addPlayer(state: GameState, pubkey: string, playerIndex: number, characterId = 'saylor'): GameState {
  if (state.players.has(pubkey)) return state;

  // Spread players across the top surface
  const spacing = Math.floor(GRID_WIDTH / (state.players.size + 2));
  const x = Math.max(1, Math.min(GRID_WIDTH - 2, spacing * (playerIndex + 1)));

  const player: PlayerState = {
    x,
    y: 1, // surface row
    direction: 'down',
    isSwinging: false,
    swingFrame: 0,
    pubkey,
    color: getPlayerColor(playerIndex),
    characterId,
  };

  const newPlayers = new Map(state.players);
  newPlayers.set(pubkey, player);

  return { ...state, players: newPlayers };
}

export function canMoveTo(grid: Cell[][], x: number, y: number): boolean {
  if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return false;
  const cell = grid[y][x];
  return cell.type === 'empty' || cell.type === 'surface';
}

export function movePlayer(state: GameState, pubkey: string, direction: 'left' | 'right' | 'up' | 'down'): GameState {
  const player = state.players.get(pubkey);
  if (!player || state.winner) return state;

  let newX = player.x;
  let newY = player.y;

  switch (direction) {
    case 'left': newX--; break;
    case 'right': newX++; break;
    case 'up': newY--; break;
    case 'down': newY++; break;
  }

  const newPlayers = new Map(state.players);

  if (canMoveTo(state.grid, newX, newY)) {
    // Apply gravity: if moving left/right and there's empty below, fall
    newPlayers.set(pubkey, { ...player, x: newX, y: newY, direction });
  } else {
    // Just change direction even if can't move
    newPlayers.set(pubkey, { ...player, direction });
  }

  return { ...state, players: newPlayers };
}

export interface SwingResult {
  state: GameState;
  hitCell: { x: number; y: number } | null;
  destroyed: boolean;
  foundBitcoin: boolean;
}

export function swingAxe(state: GameState, pubkey: string): SwingResult {
  const player = state.players.get(pubkey);
  if (!player || state.winner) {
    return { state, hitCell: null, destroyed: false, foundBitcoin: false };
  }

  // Determine target cell based on direction
  let targetX = player.x;
  let targetY = player.y;

  switch (player.direction) {
    case 'left': targetX--; break;
    case 'right': targetX++; break;
    case 'up': targetY--; break;
    case 'down': targetY++; break;
  }

  // Check bounds
  if (targetX < 0 || targetX >= GRID_WIDTH || targetY < 0 || targetY >= GRID_HEIGHT) {
    return { state, hitCell: null, destroyed: false, foundBitcoin: false };
  }

  const cell = state.grid[targetY][targetX];

  // Can't mine bedrock, empty, or surface
  if (cell.type === 'bedrock' || cell.type === 'empty' || cell.type === 'surface') {
    const newPlayers = new Map(state.players);
    newPlayers.set(pubkey, { ...player, isSwinging: true, swingFrame: 0 });
    return { state: { ...state, players: newPlayers }, hitCell: { x: targetX, y: targetY }, destroyed: false, foundBitcoin: false };
  }

  // Mine the cell — only copy the affected row
  const newGrid = state.grid.map((row, y) =>
    y === targetY ? row.map(c => ({ ...c })) : row,
  );
  newGrid[targetY][targetX].health -= 1;

  let destroyed = false;
  let foundBitcoin = false;

  if (newGrid[targetY][targetX].health <= 0) {
    destroyed = true;

    if (cell.type === 'bitcoin') {
      foundBitcoin = true;
      newGrid[targetY][targetX] = { type: 'empty', health: 0, revealed: true };

      const newPlayers = new Map(state.players);
      newPlayers.set(pubkey, { ...player, isSwinging: true, swingFrame: 0 });

      return {
        state: { ...state, grid: newGrid, players: newPlayers, winner: pubkey },
        hitCell: { x: targetX, y: targetY },
        destroyed: true,
        foundBitcoin: true,
      };
    }

    newGrid[targetY][targetX] = { type: 'empty', health: 0, revealed: true };
  }

  const newPlayers = new Map(state.players);
  newPlayers.set(pubkey, { ...player, isSwinging: true, swingFrame: 0 });

  return {
    state: { ...state, grid: newGrid, players: newPlayers },
    hitCell: { x: targetX, y: targetY },
    destroyed,
    foundBitcoin,
  };
}

/**
 * A compact snapshot of one player's state, broadcast over the network.
 * Instead of sending "I moved left", we send "I am at (5,8) facing left,
 * and these cells are now empty/damaged on my grid."
 */
export interface PlayerStatePatch {
  type: 'state';
  /** Player position */
  x: number;
  y: number;
  direction: 'left' | 'right' | 'up' | 'down';
  isSwinging: boolean;
  /** Whether this player found the bitcoin (wins the game) */
  foundBitcoin: boolean;
  /** Character avatar ID */
  characterId?: string;
  /**
   * Every grid cell that differs from the original generated grid.
   * Only cells that have been hit or destroyed need to be listed.
   * health=0 means the cell is empty.
   */
  minedCells: Array<{ x: number; y: number; health: number; type: CellType }>;
}

/**
 * Merge a remote player's state snapshot into our local game state.
 *
 * Rules:
 * - Player position is set directly (authoritative from their browser).
 * - Grid cells merge using "most destroyed wins":
 *     if the incoming health is lower than ours, we accept it.
 *     if the incoming type is 'empty', we always accept it.
 * - If foundBitcoin is true, we set the winner.
 */
export function applyStatePatch(
  state: GameState,
  pubkey: string,
  patch: PlayerStatePatch,
  playerIndex: number,
): GameState {
  if (state.winner) return state; // game already over, no more updates

  // --- Update player position ---
  let player = state.players.get(pubkey);
  const validCharId = patch.characterId && VALID_CHARACTER_IDS.has(patch.characterId)
    ? patch.characterId
    : undefined;

  if (!player) {
    // Player not yet in local state — initialise them
    player = {
      x: patch.x,
      y: patch.y,
      direction: patch.direction,
      isSwinging: patch.isSwinging,
      swingFrame: 0,
      pubkey,
      color: getPlayerColor(playerIndex),
      characterId: validCharId || 'saylor',
    };
  } else {
    player = {
      ...player,
      x: patch.x,
      y: patch.y,
      direction: patch.direction,
      isSwinging: patch.isSwinging,
      characterId: validCharId || player.characterId,
    };
  }

  const newPlayers = new Map(state.players);
  newPlayers.set(pubkey, player);

  // --- Merge mined cells into local grid ---
  // Only copy the grid if there are actually cells to merge
  let newGrid = state.grid;
  let gridChanged = false;

  for (const cell of patch.minedCells) {
    const { x, y, health, type } = cell;
    // Bounds check
    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

    const local = newGrid[y][x];

    // Accept if: incoming is more destroyed (lower health) OR incoming is empty
    const shouldApply = type === 'empty' || health < local.health;

    if (shouldApply && (local.health !== health || local.type !== type)) {
      if (!gridChanged) {
        // Shallow-copy the grid rows lazily (only copy what we need)
        newGrid = state.grid.map(row => row.slice());
        gridChanged = true;
      }
      newGrid[y][x] = { ...local, health, type, revealed: health <= 0 };
    }
  }

  const newState: GameState = {
    ...state,
    grid: newGrid,
    players: newPlayers,
    winner: patch.foundBitcoin ? pubkey : state.winner,
  };

  return newState;
}

/** Apply gravity to a player - they fall if there's empty space below */
export function applyGravity(state: GameState, pubkey: string): GameState {
  const player = state.players.get(pubkey);
  if (!player) return state;

  let newY = player.y;
  
  // Fall until we hit something solid
  while (newY + 1 < GRID_HEIGHT && canMoveTo(state.grid, player.x, newY + 1)) {
    newY++;
  }

  if (newY !== player.y) {
    const newPlayers = new Map(state.players);
    newPlayers.set(pubkey, { ...player, y: newY });
    return { ...state, players: newPlayers };
  }

  return state;
}
