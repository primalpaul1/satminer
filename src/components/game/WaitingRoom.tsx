import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { PlayerList } from './PlayerList';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUpdateGameStatus } from '@/hooks/useGameLobby';
import { useGamePlayers } from '@/hooks/useGamePlayers';
import { useHousePayout } from '@/hooks/useHousePayout';
import type { GameLobbyData } from '@/hooks/useGameLobby';
import { REFUND_TIMEOUT_MS } from '@/lib/houseAccount';
import { Zap, Play, Users, Loader2, Copy, ArrowLeft, ShieldCheck, AlertTriangle, Clock, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useNavigate } from 'react-router-dom';

interface WaitingRoomProps {
  lobby: GameLobbyData;
  onGameStart: () => void;
}

export function WaitingRoom({ lobby, onGameStart }: WaitingRoomProps) {
  const { user } = useCurrentUser();
  const { updateStatus } = useUpdateGameStatus();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Single source of truth for players and payments
  const { players, paidPlayers, allPaid, paidCount, totalPaid } = useGamePlayers(lobby);

  const { refundPlayers, isPaying: isRefunding } = useHousePayout();

  const isHost = user?.pubkey === lobby.hostPubkey;

  // Calculate time remaining until refund
  const gameCreatedAt = lobby.event.created_at * 1000;
  const refundDeadline = gameCreatedAt + REFUND_TIMEOUT_MS;
  const [now, setNow] = useState(Date.now());
  const [isExpired, setIsExpired] = useState(false);
  const [refundTriggered, setRefundTriggered] = useState(false);

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= refundDeadline) {
        setIsExpired(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [refundDeadline]);

  const timeRemaining = useMemo(() => {
    const diff = Math.max(0, refundDeadline - now);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [refundDeadline, now]);

  // Auto-trigger refund when expired (host only, only 1 player who paid)
  useEffect(() => {
    if (isExpired && isHost && players.length <= 1 && paidCount > 0 && !refundTriggered) {
      setRefundTriggered(true);
      const paidList = players.filter(p => paidPlayers.has(p));
      refundPlayers(lobby, paidList).catch(console.error);
    }
  }, [isExpired, isHost, players, paidCount, paidPlayers, refundTriggered, refundPlayers, lobby]);

  const handleManualRefund = async () => {
    if (!isExpired) return;
    setRefundTriggered(true);
    const paidList = players.filter(p => paidPlayers.has(p));
    await refundPlayers(lobby, paidList);
  };

  const handleStartGame = async () => {
    if (!allPaid) {
      toast({
        title: 'Not all players have paid',
        description: 'Wait for all miners to pay their entry fee before starting.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Update lobby with the full player list before starting
      const lobbyWithAllPlayers: GameLobbyData = {
        ...lobby,
        players,
      };
      await updateStatus(lobbyWithAllPlayers, 'playing');
      onGameStart();
    } catch (error) {
      toast({
        title: 'Failed to start game',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  // Check if lobby status changed to 'playing' (non-host sees the update)
  useEffect(() => {
    if (lobby.status === 'playing') {
      onGameStart();
    }
  }, [lobby.status, onGameStart]);

  const handleCopyLink = () => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const url = `${window.location.origin}${base}/game/${lobby.hostPubkey}/${lobby.gameId}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({
        title: 'Link copied!',
        description: 'Share this link with other players',
      });
    });
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="text-stone-400 hover:text-stone-200 mb-2"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          <span className="text-xs font-mono">Back</span>
        </Button>

        <div className="relative inline-flex items-center justify-center">
          <div className="absolute w-20 h-20 bg-amber-500/10 rounded-full blur-xl animate-pulse" />
          <div className="relative flex items-center gap-2 bg-stone-800/80 border border-stone-700/50 rounded-2xl px-6 py-3">
            <Zap className="w-6 h-6 text-amber-400 fill-current" />
            <span className="text-3xl font-mono font-bold text-amber-400">{totalPaid}</span>
            <span className="text-sm text-stone-400 font-mono">sats in pot</span>
          </div>
        </div>

        <h2 className="text-xl font-mono font-bold text-stone-200 pt-2">
          Waiting for Miners
        </h2>
        <p className="text-sm text-stone-400 font-mono">
          Entry: {lobby.betAmount} sats per player
        </p>
      </div>

      {/* Payment status banner */}
      <div className={`border rounded-xl p-3 flex items-center gap-3 ${
        allPaid && players.length >= 2
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-amber-500/10 border-amber-500/30'
      }`}>
        {allPaid && players.length >= 2 ? (
          <>
            <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-xs font-mono text-emerald-400 font-bold">
                All {players.length} players have paid!
              </p>
              <p className="text-[10px] font-mono text-emerald-400/70">
                {isHost ? 'You can now start the game.' : 'Waiting for host to start the game.'}
              </p>
            </div>
          </>
        ) : (
          <>
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-xs font-mono text-amber-400 font-bold">
                {paidCount}/{players.length} miners have paid
              </p>
              <p className="text-[10px] font-mono text-amber-400/70">
                {players.length < 2
                  ? 'Share the invite link — need at least 2 players!'
                  : 'Waiting for all players to pay their entry fee...'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Players */}
      <div className="bg-stone-900/50 border border-stone-700/30 rounded-xl p-4">
        <PlayerList
          players={players}
          hostPubkey={lobby.hostPubkey}
          currentPubkey={user?.pubkey}
          winner={null}
          paidPlayers={paidPlayers}
        />

        <div className="mt-4 flex items-center justify-center gap-2 text-stone-500">
          <Users className="w-4 h-4" />
          <span className="text-xs font-mono">
            {players.length}/{lobby.maxPlayers} miners
          </span>
        </div>
      </div>

      {/* Timer & waiting animation */}
      <div className="space-y-2">
        {isExpired && players.length <= 1 ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-red-400">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-mono font-bold">Game Expired</span>
            </div>
            <p className="text-xs text-red-400/70 font-mono">
              No one joined within 1 hour. Entry fees will be refunded.
            </p>
            {paidCount > 0 && !refundTriggered && (
              <Button
                onClick={handleManualRefund}
                disabled={isRefunding}
                className="bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 font-mono text-sm"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                {isRefunding ? 'Refunding...' : 'Trigger Refund'}
              </Button>
            )}
            {refundTriggered && (
              <p className="text-xs text-emerald-400 font-mono">Refund initiated ✓</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 text-amber-400/60 animate-spin" />
              <span className="text-sm text-stone-400 font-mono animate-pulse">
                {allPaid && players.length >= 2 ? 'Ready to start!' : 'Waiting for players to join & pay...'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-stone-600">
              <Clock className="w-3 h-3" />
              <span className="text-xs font-mono">{timeRemaining}</span>
            </div>
          </div>
        )}
      </div>

      {/* Share link */}
      <Button
        variant="outline"
        onClick={handleCopyLink}
        className="w-full border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700/50 font-mono"
      >
        <Copy className="w-4 h-4 mr-2" />
        Copy Invite Link
      </Button>

      {/* Start button (host only) */}
      {isHost && (
        <Button
          onClick={handleStartGame}
          disabled={!allPaid || players.length < 2}
          className={`w-full font-mono font-bold text-base py-5 transition-all ${
            allPaid && players.length >= 2
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-stone-700 text-stone-400 cursor-not-allowed'
          }`}
        >
          <Play className="w-5 h-5 mr-2" />
          {players.length < 2
            ? 'Need at least 2 players'
            : allPaid
              ? 'Start Mining!'
              : `Waiting for ${players.length - paidCount} payment(s)...`}
        </Button>
      )}

      {/* Rules */}
      <div className="bg-stone-900/30 border border-stone-800/50 rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-mono text-amber-400/60 uppercase tracking-wider">Rules</h3>
        <ul className="text-xs text-stone-500 space-y-1.5 font-mono">
          <li className="flex items-start gap-2">
            <span className="text-amber-400/60">1.</span>
            Each player pays {lobby.betAmount} sats to enter
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400/60">2.</span>
            Funds are held in escrow by the house account
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400/60">3.</span>
            Game starts when all players have paid
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400/60">4.</span>
            First miner to find the hidden Bitcoin wins the pot!
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-400/60">5.</span>
            If no one joins within 1 hour, entry fees are refunded
          </li>
        </ul>
      </div>
    </div>
  );
}
