import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useGameLobby } from '@/hooks/useGameLobby';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGamePlayers } from '@/hooks/useGamePlayers';
import { WaitingRoom } from '@/components/game/WaitingRoom';
import { GamePlay } from '@/components/game/GamePlay';
import { PaymentGate } from '@/components/game/PaymentGate';
import { LightningAddressGate } from '@/components/game/LightningAddressGate';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { CHARACTERS } from '@/lib/gameConstants';
import type { GameLobbyData } from '@/hooks/useGameLobby';

export default function GamePage() {
  const { hostPubkey, gameId } = useParams<{ hostPubkey: string; gameId: string }>();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [gameStarted, setGameStarted] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useLocalStorage('satminer-character', CHARACTERS[0].id);

  useSeoMeta({
    title: 'SatMiner — Game Room',
    description: 'Mine for Bitcoin and win sats!',
  });

  const { data: lobby, isLoading, error } = useGameLobby(gameId ?? '', hostPubkey ?? '', gameStarted);

  const handleGameStart = useCallback(() => {
    setGameStarted(true);
  }, []);

  const handlePaymentComplete = useCallback(() => {
    setHasPaid(true);
  }, []);

  if (!hostPubkey || !gameId) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-stone-400 font-mono">Invalid game link</p>
          <Button onClick={() => navigate('/')} variant="outline" className="border-stone-700 font-mono">
            Back to Lobby
          </Button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="text-center space-y-6 max-w-sm">
          <div className="text-4xl">⛏️</div>
          <h2 className="text-xl font-mono font-bold text-stone-200">Login to Play</h2>
          <p className="text-sm text-stone-400 font-mono">
            Connect your Nostr account to join the mining game.
          </p>
          <LoginArea className="flex justify-center" />
        </div>
      </div>
    );
  }

  // Wrap all game screens in the LightningAddressGate so the player
  // can't enter a game without having a payout address on their profile.
  return (
    <LightningAddressGate>
      <GamePageInner
        lobby={lobby}
        isLoading={isLoading}
        error={error}
        gameStarted={gameStarted}
        hasPaid={hasPaid}
        selectedCharacter={selectedCharacter}
        onSelectCharacter={setSelectedCharacter}
        onGameStart={handleGameStart}
        onPaymentComplete={handlePaymentComplete}
        onBack={() => navigate('/')}
      />
    </LightningAddressGate>
  );
}

/** Inner component rendered after lightning-address check passes. */
function GamePageInner({
  lobby,
  isLoading,
  error,
  gameStarted,
  hasPaid,
  selectedCharacter,
  onSelectCharacter,
  onGameStart,
  onPaymentComplete,
  onBack,
}: {
  lobby: GameLobbyData | null | undefined;
  isLoading: boolean;
  error: Error | null;
  gameStarted: boolean;
  hasPaid: boolean;
  selectedCharacter: string;
  onSelectCharacter: (id: string) => void;
  onGameStart: () => void;
  onPaymentComplete: () => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  // Use zap receipts as the authoritative payment check (not just local state)
  const { paidPlayers } = useGamePlayers(lobby ?? undefined);
  const verifiedPaid = hasPaid || (user ? paidPlayers.has(user.pubkey) : false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-stone-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="font-mono">Loading game...</span>
        </div>
      </div>
    );
  }

  if (error || !lobby) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-stone-400 font-mono">Game not found</p>
          <Button onClick={() => navigate('/')} variant="outline" className="border-stone-700 font-mono">
            Back to Lobby
          </Button>
        </div>
      </div>
    );
  }

  const isPlaying = gameStarted || lobby.status === 'playing';

  if (isPlaying) {
    return (
      <div className="min-h-screen bg-stone-950 px-4 py-6">
        <GamePlay lobby={lobby} characterId={selectedCharacter} />
      </div>
    );
  }

  if (!verifiedPaid) {
    return (
      <div className="min-h-screen bg-stone-950 px-4 py-8">
        <PaymentGate
          lobby={lobby}
          selectedCharacter={selectedCharacter}
          onSelectCharacter={onSelectCharacter}
          onPaymentComplete={onPaymentComplete}
          onBack={onBack}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 px-4 py-6">
      <WaitingRoom lobby={lobby} onGameStart={onGameStart} />
    </div>
  );
}
