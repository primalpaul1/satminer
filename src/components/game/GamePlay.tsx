import { useState, useEffect, useCallback, useRef } from 'react';
import { GameCanvas, addMiningParticles } from './GameCanvas';
import { GameControls } from './GameControls';
import { PlayerList } from './PlayerList';
import {
  createGameState,
  createGrid,
  addPlayer,
  movePlayer,
  swingAxe,
  applyGravity,
  applyStatePatch,
  type GameState,
  type PlayerStatePatch,
  type CellType,
  GRID_WIDTH,
  GRID_HEIGHT,
} from '@/lib/gameEngine';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishState, useClaimWin, useUpdateGameStatus } from '@/hooks/useGameLobby';
import { useHousePayout } from '@/hooks/useHousePayout';
import { useGamePlayers } from '@/hooks/useGamePlayers';
import type { GameLobbyData } from '@/hooks/useGameLobby';
import { useNostr } from '@nostrify/react';
import { GAME_KINDS, STATE_BROADCAST_INTERVAL, SWING_ANIMATION_FRAMES } from '@/lib/gameConstants';
import { Zap, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { GameOverOverlay } from './GameOverOverlay';
import { playMineSound } from '@/lib/sounds';

interface GamePlayProps {
  lobby: GameLobbyData;
  characterId: string;
}

// Minimum ms between state broadcasts while the player is moving.
// We broadcast on every action, but cap it so a held key doesn't spam the relay.
const BROADCAST_THROTTLE = 150;

// Max event-IDs to keep in the dedup set before pruning.
const MAX_PROCESSED_IDS = 500;

/**
 * Build the compact minedCells list for a state broadcast.
 * We compare the current grid against the original generated grid and emit
 * only the cells that have changed (been hit or destroyed).
 */
function buildMinedCells(
  currentGrid: GameState['grid'],
  originalGrid: GameState['grid'],
): PlayerStatePatch['minedCells'] {
  const cells: PlayerStatePatch['minedCells'] = [];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const orig = originalGrid[y][x];
      const cur = currentGrid[y][x];
      // Only include cells that differ from the original generated state
      if (cur.health !== orig.health || cur.type !== orig.type) {
        cells.push({ x, y, health: cur.health, type: cur.type as CellType });
      }
    }
  }
  return cells;
}

export function GamePlay({ lobby, characterId }: GamePlayProps) {
  const { user } = useCurrentUser();
  const { publishState } = usePublishState();
  const { claimWin } = useClaimWin();
  const { updateStatus } = useUpdateGameStatus();
  const { payWinner, isPaying: isPayingOut, payoutComplete } = useHousePayout();
  const { players: allPlayers } = useGamePlayers(lobby);
  const { nostr } = useNostr();
  const navigate = useNavigate();

  // The original grid is deterministic from the seed — we use it to compute diffs.
  const originalGridRef = useRef<GameState['grid']>(createGrid(lobby.seed).grid);

  const [gameState, setGameState] = useState<GameState>(() => {
    const state = createGameState(lobby.gameId, lobby.seed);
    let s = state;
    lobby.players.forEach((pubkey, index) => {
      // Pass our own characterId for our pubkey, default for others
      const charId = (user && pubkey === user.pubkey) ? characterId : 'saylor';
      s = addPlayer(s, pubkey, index, charId);
    });
    s = { ...s, started: true };
    return s;
  });

  // When allPlayers updates (from zap receipts), add any missing players
  useEffect(() => {
    setGameState(prev => {
      let state = prev;
      let changed = false;
      allPlayers.forEach((pubkey, index) => {
        if (!state.players.has(pubkey)) {
          state = addPlayer(state, pubkey, index);
          changed = true;
        }
      });
      return changed ? state : prev;
    });
  }, [allPlayers]);

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const winClaimedRef = useRef(false);
  const payoutFiredRef = useRef(false);
  const lastBroadcastTimeRef = useRef(0);
  const processedIdsRef = useRef(new Set<string>());

  // Watermark: only fetch events newer than what we've already seen
  const lastSeenTimestampRef = useRef(Math.floor(Date.now() / 1000));
  // In-flight guard: never start a new poll while one is still running
  const isPollingRef = useRef(false);

  // --- Broadcast helpers ---

  /**
   * Build and publish a state snapshot of the local player.
   * Called after every local action AND periodically as a heartbeat.
   */
  const broadcastState = useCallback((state: GameState, foundBitcoin: boolean) => {
    if (!user) return;
    const player = state.players.get(user.pubkey);
    if (!player) return;

    const patch: PlayerStatePatch = {
      type: 'state',
      x: player.x,
      y: player.y,
      direction: player.direction,
      isSwinging: player.isSwinging,
      foundBitcoin,
      characterId,
      minedCells: buildMinedCells(state.grid, originalGridRef.current),
    };

    publishState(lobby.gameId, patch).catch(() => {
      // Retry once after a short delay on transient relay failure
      setTimeout(() => publishState(lobby.gameId, patch).catch(console.error), 600);
    });
  }, [user, lobby.gameId, publishState]);

  // Periodic heartbeat broadcast so remote players stay in sync even if
  // individual publishes are dropped. Fires every STATE_BROADCAST_INTERVAL ms.
  useEffect(() => {
    if (!user || gameState.winner) return;

    const interval = setInterval(() => {
      broadcastState(gameStateRef.current, false);
    }, STATE_BROADCAST_INTERVAL);

    return () => clearInterval(interval);
  }, [user, gameState.winner, broadcastState]);

  // --- Remote state polling ---

  useEffect(() => {
    if (!user || gameState.winner) return;

    const poll = async () => {
      if (isPollingRef.current) return; // don't overlap
      isPollingRef.current = true;

      try {
        const since = lastSeenTimestampRef.current;

        const events = await nostr.query(
          [{
            kinds: [GAME_KINDS.ACTION],
            '#d': [lobby.gameId],
            since: Math.max(0, since - 5), // 5s clock-skew buffer
            limit: 100,
          }],
          { signal: AbortSignal.timeout(4000) },
        );

        // Advance the timestamp watermark
        if (events.length > 0) {
          const newestTs = Math.max(...events.map((e: NostrEvent) => e.created_at));
          if (newestTs > lastSeenTimestampRef.current) {
            lastSeenTimestampRef.current = newestTs;
          }
        }

        // Apply remote state patches
        events.forEach((event: NostrEvent) => {
          // Skip our own events
          if (event.pubkey === user.pubkey) return;
          // Skip already-processed events
          if (processedIdsRef.current.has(event.id)) return;
          processedIdsRef.current.add(event.id);

          // Prune the dedup set — keep the newest entries
          if (processedIdsRef.current.size > MAX_PROCESSED_IDS) {
            const all = Array.from(processedIdsRef.current);
            processedIdsRef.current = new Set(all.slice(all.length - 400));
          }

          try {
            const patch = JSON.parse(event.content) as PlayerStatePatch;
            if (patch.type !== 'state') return; // ignore any legacy action events

            const senderPubkey = event.pubkey;
            const playerIndex = lobby.players.indexOf(senderPubkey);
            if (playerIndex < 0) return; // unknown player, skip

            setGameState(prev => {
              const next = applyStatePatch(prev, senderPubkey, patch, playerIndex);

              // Trigger mining particles if cells were destroyed
              if (patch.minedCells.length > 0) {
                for (const cell of patch.minedCells) {
                  if (cell.type === 'empty') {
                    // Check if this cell was not already empty in our local grid
                    if (prev.grid[cell.y]?.[cell.x]?.type !== 'empty') {
                      const isBitcoin = cell.x === prev.bitcoinX && cell.y === prev.bitcoinY;
                      addMiningParticles(cell.x, cell.y, true, isBitcoin);
                    }
                  }
                }
              }

              return next;
            });
          } catch (err) {
            console.warn('Malformed game event, skipping:', event.id, err);
          }
        });
      } catch (err) {
        console.warn('State poll query failed, retrying next tick:', err);
      } finally {
        isPollingRef.current = false;
      }
    };

    const interval = setInterval(poll, 800);
    poll(); // immediate first poll

    return () => clearInterval(interval);
  }, [nostr, lobby.gameId, user, lobby.players, gameState.winner]);

  // --- Swing animation ticker ---
  useEffect(() => {
    const interval = setInterval(() => {
      setGameState(prev => {
        let changed = false;
        const newPlayers = new Map(prev.players);
        prev.players.forEach((player, key) => {
          if (player.isSwinging) {
            changed = true;
            if (player.swingFrame >= SWING_ANIMATION_FRAMES) {
              newPlayers.set(key, { ...player, isSwinging: false, swingFrame: 0 });
            } else {
              newPlayers.set(key, { ...player, swingFrame: player.swingFrame + 1 });
            }
          }
        });
        if (!changed) return prev;
        return { ...prev, players: newPlayers };
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // --- Win handling ---

  // Winner's browser: claim win + pay
  useEffect(() => {
    if (gameState.winner && gameState.winner === user?.pubkey && !winClaimedRef.current) {
      winClaimedRef.current = true;
      payoutFiredRef.current = true;

      (async () => {
        try {
          await claimWin(lobby.gameId, lobby.hostPubkey);
        } catch (err) { console.error('claimWin failed:', err); }
        try {
          await updateStatus(lobby, 'finished');
        } catch (err) { console.error('updateStatus failed:', err); }
        try {
          await payWinner(user.pubkey, lobby);
        } catch (err) { console.error('payWinner failed:', err); }
      })();
    }
  // Stable deps only — avoid re-running when payWinner/claimWin refs change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.winner, user?.pubkey, lobby.gameId]);

  // Host fallback: watch for a RESULT event if the winner's browser drops
  const isHost = user?.pubkey === lobby.hostPubkey;
  useEffect(() => {
    if (!isHost || gameState.winner) return;

    const interval = setInterval(async () => {
      if (payoutFiredRef.current) return;
      try {
        const results = await nostr.query(
          [{ kinds: [GAME_KINDS.RESULT], '#d': [lobby.gameId], limit: 5 }],
          { signal: AbortSignal.timeout(4000) },
        );
        if (results.length > 0 && !payoutFiredRef.current) {
          payoutFiredRef.current = true;
          const winnerPubkey = results[0].pubkey;
          setGameState(prev => ({ ...prev, winner: winnerPubkey }));
          try {
            await updateStatus(lobby, 'finished');
          } catch (err) { console.error('host updateStatus failed:', err); }
          try {
            await payWinner(winnerPubkey, lobby);
          } catch (err) { console.error('host payWinner fallback failed:', err); }
        }
      } catch {
        // query failed, retry next tick
      }
    }, 2000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, gameState.winner, nostr, lobby.gameId]);

  // --- Local input handlers ---

  const handleMove = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (!user || gameStateRef.current.winner) return;

    const now = Date.now();
    if (now - lastBroadcastTimeRef.current < BROADCAST_THROTTLE) return;
    lastBroadcastTimeRef.current = now;

    let newState: GameState;
    setGameState(prev => {
      let state = movePlayer(prev, user.pubkey, direction);
      if (direction === 'left' || direction === 'right') {
        state = applyGravity(state, user.pubkey);
      }
      newState = state;
      return state;
    });

    // Broadcast after the next microtask so newState is assigned
    setTimeout(() => broadcastState(newState ?? gameStateRef.current, false), 0);
  }, [user, broadcastState]);

  const handleSwing = useCallback(() => {
    if (!user || gameStateRef.current.winner) return;

    const now = Date.now();
    if (now - lastBroadcastTimeRef.current < BROADCAST_THROTTLE) return;
    lastBroadcastTimeRef.current = now;

    let foundBitcoin = false;
    let newState: GameState;

    setGameState(prev => {
      const result = swingAxe(prev, user.pubkey);
      if (result.hitCell) {
        addMiningParticles(result.hitCell.x, result.hitCell.y, result.destroyed, result.foundBitcoin);
        playMineSound(result.destroyed);
      }
      foundBitcoin = result.foundBitcoin;
      newState = result.state;
      return result.state;
    });

    setTimeout(() => broadcastState(newState ?? gameStateRef.current, foundBitcoin), 0);
  }, [user, broadcastState]);

  // --- Keyboard controls ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W':
          e.preventDefault(); handleMove('up'); break;
        case 'ArrowDown': case 's': case 'S':
          e.preventDefault(); handleMove('down'); break;
        case 'ArrowLeft': case 'a': case 'A':
          e.preventDefault(); handleMove('left'); break;
        case 'ArrowRight': case 'd': case 'D':
          e.preventDefault(); handleMove('right'); break;
        case ' ':
          e.preventDefault(); handleSwing(); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleMove, handleSwing]);

  const totalPot = lobby.betAmount * allPlayers.length;
  const isWinner = gameState.winner === user?.pubkey;
  const isLoser = gameState.winner !== null && gameState.winner !== user?.pubkey;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* Game area */}
      <div className="flex-1 flex flex-col items-center gap-3">
        {/* Status bar */}
        <div className="w-full max-w-[800px] flex items-center justify-between px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="text-stone-400 hover:text-stone-200"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="text-xs font-mono">Leave</span>
          </Button>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-amber-400">
              <Zap className="w-4 h-4 fill-current" />
              <span className="text-sm font-mono font-bold">{totalPot} sats</span>
            </div>
            <div className="text-xs font-mono text-stone-500">
              {gameState.winner ? 'GAME OVER' : 'MINING...'}
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative rounded-xl overflow-hidden border-2 border-stone-700/50 shadow-2xl shadow-black/50">
          <GameCanvas gameState={gameState} currentPubkey={user?.pubkey} />

          {/* Winner/Loser overlay */}
          {gameState.winner && (
            <GameOverOverlay
              isWinner={isWinner}
              isLoser={isLoser}
              totalPot={totalPot}
              isPayingOut={isPayingOut}
              payoutComplete={payoutComplete}
              onBack={() => navigate('/')}
            />
          )}
        </div>

        {/* Mobile controls */}
        <div className="lg:hidden">
          <GameControls onMove={handleMove} onSwing={handleSwing} disabled={!!gameState.winner} />
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-56 space-y-4">
        <PlayerList
          players={allPlayers}
          hostPubkey={lobby.hostPubkey}
          currentPubkey={user?.pubkey}
          winner={gameState.winner}
        />

        <div className="hidden lg:block">
          <GameControls onMove={handleMove} onSwing={handleSwing} disabled={!!gameState.winner} />
        </div>

        <div className="bg-stone-900/50 border border-stone-700/30 rounded-lg p-3 space-y-2">
          <h3 className="text-xs font-mono text-stone-500 uppercase tracking-wider">
            How to Play
          </h3>
          <ul className="text-xs text-stone-400 space-y-1 font-mono">
            <li>⬆⬇⬅➡ Move your miner</li>
            <li>⎵ Swing your pickaxe</li>
            <li>🪨 Break rocks to dig deeper</li>
            <li>₿ Find the hidden Bitcoin!</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
