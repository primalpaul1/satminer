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
        if (val < 0.3) {
          row.push({ type: 'hard_rock', health: 3, revealed: false });
        } else {
          row.push({ type: 'rock', health: 1, revealed: false });
        }
      }
    }
    grid.push(row);
  }

  // Place bitcoin in the bottom third of the grid, away from edges
  const minY = Math.floor(GRID_HEIGHT * 0.6);
  const maxY = GRID_HEIGHT - 2;
  const minX = 2;
  const maxX = GRID_WIDTH - 3;

  const bitcoinX = minX + Math.floor(rng() * (maxX - minX + 1));
  const bitcoinY = minY + Math.floor(rng() * (maxY - minY + 1));

  // Set the bitcoin cell
  grid[bitcoinY][bitcoinX] = { type: 'bitcoin', health: 1, revealed: false };

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

export function addPlayer(state: GameState, pubkey: string, playerIndex: number): GameState {
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

  // Mine the cell
  const newGrid = state.grid.map(row => row.map(c => ({ ...c })));
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
