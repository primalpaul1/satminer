import { useState, useEffect, useCallback, useRef } from 'react';
import { GameCanvas, addMiningParticles } from './GameCanvas';
import { GameControls } from './GameControls';
import { PlayerList } from './PlayerList';
import {
  createGameState,
  addPlayer,
  movePlayer,
  swingAxe,
  applyGravity,
  type GameState,
} from '@/lib/gameEngine';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishAction, useClaimWin, useUpdateGameStatus } from '@/hooks/useGameLobby';
import { useHousePayout } from '@/hooks/useHousePayout';
import { useGamePlayers } from '@/hooks/useGamePlayers';
import type { GameLobbyData } from '@/hooks/useGameLobby';
import { useNostr } from '@nostrify/react';
import { GAME_KINDS } from '@/lib/gameConstants';
import { Trophy, Zap, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';

interface GamePlayProps {
  lobby: GameLobbyData;
}

// How often we attempt to publish a player's action (ms).
// Lowered to 150ms — fast enough for responsiveness but gentle on relay rate limits.
const ACTION_THROTTLE = 150;

// How many of my own recent action event-IDs to keep in the dedup set.
// Older ones are pruned to avoid unbounded memory growth.
const MAX_PROCESSED_IDS = 500;

export function GamePlay({ lobby }: GamePlayProps) {
  const { user } = useCurrentUser();
  const { publishAction } = usePublishAction();
  const { claimWin } = useClaimWin();
  const { updateStatus } = useUpdateGameStatus();
  const { payWinner, isPaying: isPayingOut, payoutComplete } = useHousePayout();
  const { players: allPlayers } = useGamePlayers(lobby);
  const { nostr } = useNostr();
  const navigate = useNavigate();

  const [gameState, setGameState] = useState<GameState>(() => {
    const state = createGameState(lobby.gameId, lobby.seed);
    let s = state;
    // Use lobby.players for initial state (from the lobby event p-tags)
    lobby.players.forEach((pubkey, index) => {
      s = addPlayer(s, pubkey, index);
    });
    s = { ...s, started: true };
    return s;
  });

  // When allPlayers updates (from zap receipts), add any missing players to the game
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
  const lastActionTimeRef = useRef(0);
  const processedActionsRef = useRef(new Set<string>());

  // Track the timestamp of the newest action we've seen so far.
  // Polling uses this as a `since` filter so we only fetch genuinely new events,
  // avoiding re-scanning the full history on every tick.
  const lastSeenTimestampRef = useRef(Math.floor(Date.now() / 1000));

  // Whether a relay query is currently in-flight.
  // Prevents overlapping polls when the relay is slow.
  const isPollingRef = useRef(false);

  // Poll for remote player actions
  useEffect(() => {
    if (!user || gameState.winner) return;

    const poll = async () => {
      // Skip if a previous query hasn't finished yet (prevents thundering herd)
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        const since = lastSeenTimestampRef.current;

        const events = await nostr.query(
          [{
            kinds: [GAME_KINDS.ACTION],
            '#d': [lobby.gameId],
            // Only fetch events newer than what we've already processed.
            // Use a 5-second lookback buffer to handle minor clock skew between relays.
            since: Math.max(0, since - 5),
            limit: 100,
          }],
          { signal: AbortSignal.timeout(4000) },
        );

        // Advance the watermark to the newest event we received
        if (events.length > 0) {
          const newestTs = Math.max(...events.map((e: NostrEvent) => e.created_at));
          if (newestTs > lastSeenTimestampRef.current) {
            lastSeenTimestampRef.current = newestTs;
          }
        }

        // Process new actions from OTHER players
        events.forEach((event: NostrEvent) => {
          if (event.pubkey === user.pubkey) return;
          if (processedActionsRef.current.has(event.id)) return;
          processedActionsRef.current.add(event.id);

          // Prune the dedup set to avoid unbounded memory growth
          if (processedActionsRef.current.size > MAX_PROCESSED_IDS) {
            const iter = processedActionsRef.current.values();
            for (let i = 0; i < 100; i++) {
              const val = iter.next().value;
              if (val !== undefined) processedActionsRef.current.delete(val);
            }
          }

          try {
            const action = JSON.parse(event.content);
            setGameState(prev => {
              let state = prev;

              // Ensure remote player exists
              if (!state.players.has(event.pubkey)) {
                const idx = lobby.players.indexOf(event.pubkey);
                if (idx >= 0) {
                  state = addPlayer(state, event.pubkey, idx);
                } else {
                  return state;
                }
              }

              if (action.type === 'move' && action.direction) {
                state = movePlayer(state, event.pubkey, action.direction);
                // Only apply gravity for horizontal moves (same logic as local player)
                if (action.direction === 'left' || action.direction === 'right') {
                  state = applyGravity(state, event.pubkey);
                }
              } else if (action.type === 'swing') {
                const result = swingAxe(state, event.pubkey);
                state = result.state;
                if (result.hitCell && result.destroyed) {
                  addMiningParticles(result.hitCell.x, result.hitCell.y, true, result.foundBitcoin);
                } else if (result.hitCell) {
                  addMiningParticles(result.hitCell.x, result.hitCell.y, false, false);
                }
              }

              return state;
            });
          } catch {
            // Invalid action, skip
          }
        });
      } catch {
        // Query failed (timeout, network error etc.) — just try again next tick
      } finally {
        isPollingRef.current = false;
      }
    };

    // Poll every 800ms, but the guard above ensures we never have two in-flight at once
    const interval = setInterval(poll, 800);
    // Kick off an immediate first poll so we don't wait 800ms on entry
    poll();

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostr, lobby.gameId, user, lobby.players, gameState.winner]);

  // Update swing animation
  useEffect(() => {
    const interval = setInterval(() => {
      setGameState(prev => {
        let changed = false;
        const newPlayers = new Map(prev.players);

        prev.players.forEach((player, key) => {
          if (player.isSwinging) {
            changed = true;
            if (player.swingFrame >= 8) {
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

  // Claim win when bitcoin is found — also trigger house payout
  useEffect(() => {
    if (gameState.winner && gameState.winner === user?.pubkey && !winClaimedRef.current) {
      winClaimedRef.current = true;
      claimWin(lobby.gameId, lobby.hostPubkey).catch(console.error);
      updateStatus(lobby, 'finished').catch(console.error);
      // Trigger house payout to the winner
      payWinner(user.pubkey, lobby).catch(console.error);
    }
  }, [gameState.winner, user?.pubkey, lobby, claimWin, updateStatus, payWinner]);

  const handleMove = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (!user || gameStateRef.current.winner) return;

    const now = Date.now();
    if (now - lastActionTimeRef.current < ACTION_THROTTLE) return;
    lastActionTimeRef.current = now;

    setGameState(prev => {
      let state = movePlayer(prev, user.pubkey, direction);
      // Only apply gravity for horizontal movement (walking off a ledge),
      // not for intentional up/down moves.
      if (direction === 'left' || direction === 'right') {
        state = applyGravity(state, user.pubkey);
      }
      return state;
    });

    // Publish with retry — a single relay timeout shouldn't drop the move
    publishAction(lobby.gameId, { type: 'move', direction }).catch(() => {
      // Retry once after a short delay
      setTimeout(() => {
        publishAction(lobby.gameId, { type: 'move', direction }).catch(console.error);
      }, 500);
    });
  }, [user, lobby.gameId, publishAction]);

  const handleSwing = useCallback(() => {
    if (!user || gameStateRef.current.winner) return;

    const now = Date.now();
    if (now - lastActionTimeRef.current < ACTION_THROTTLE) return;
    lastActionTimeRef.current = now;

    setGameState(prev => {
      const result = swingAxe(prev, user.pubkey);
      if (result.hitCell) {
        addMiningParticles(result.hitCell.x, result.hitCell.y, result.destroyed, result.foundBitcoin);
      }
      return result.state;
    });

    // Publish with retry
    publishAction(lobby.gameId, { type: 'swing' }).catch(() => {
      setTimeout(() => {
        publishAction(lobby.gameId, { type: 'swing' }).catch(console.error);
      }, 500);
    });
  }, [user, lobby.gameId, publishAction]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          handleMove('up');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          handleMove('down');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          handleMove('left');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          handleMove('right');
          break;
        case ' ':
          e.preventDefault();
          handleSwing();
          break;
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
          <GameCanvas
            gameState={gameState}
            currentPubkey={user?.pubkey}
          />

          {/* Winner overlay */}
          {gameState.winner && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="text-center space-y-4 animate-in fade-in zoom-in duration-500">
                {isWinner ? (
                  <>
                    <div className="relative">
                      <Trophy className="w-16 h-16 text-amber-400 mx-auto animate-bounce" />
                      <div className="absolute inset-0 w-16 h-16 mx-auto bg-amber-400/20 rounded-full blur-xl" />
                    </div>
                    <h2 className="text-2xl font-bold text-amber-400 font-mono">
                      YOU FOUND THE BITCOIN!
                    </h2>
                    <p className="text-lg text-amber-300/80 font-mono">
                      You won <span className="text-amber-400 font-bold">{totalPot} sats!</span>
                    </p>
                    {isPayingOut ? (
                      <div className="flex items-center justify-center gap-2 text-amber-300/60">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-mono">Sending payout to your wallet...</span>
                      </div>
                    ) : payoutComplete ? (
                      <p className="text-xs text-emerald-400 font-mono">
                        ⚡ Payout submitted to your Lightning address!
                      </p>
                    ) : null}
                  </>
                ) : isLoser ? (
                  <>
                    <div className="text-4xl">💀</div>
                    <h2 className="text-xl font-bold text-stone-300 font-mono">
                      BITCOIN WAS FOUND
                    </h2>
                    <p className="text-sm text-stone-400 font-mono">
                      Better luck next time, miner.
                    </p>
                  </>
                ) : (
                  <>
                    <Trophy className="w-12 h-12 text-amber-400 mx-auto" />
                    <h2 className="text-xl font-bold text-stone-300 font-mono">
                      GAME OVER
                    </h2>
                  </>
                )}

                <Button
                  onClick={() => navigate('/')}
                  className="bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold mt-4"
                >
                  Back to Lobby
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Mobile controls */}
        <div className="lg:hidden">
          <GameControls
            onMove={handleMove}
            onSwing={handleSwing}
            disabled={!!gameState.winner}
          />
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

        {/* Desktop controls info */}
        <div className="hidden lg:block">
          <GameControls
            onMove={handleMove}
            onSwing={handleSwing}
            disabled={!!gameState.winner}
          />
        </div>

        {/* Game info */}
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
