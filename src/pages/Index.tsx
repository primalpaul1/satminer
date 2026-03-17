import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGameLobbies, useUpdateGameStatus } from '@/hooks/useGameLobby';
import { LoginArea } from '@/components/auth/LoginArea';
import { CreateGameDialog } from '@/components/game/CreateGameDialog';
import { LobbyCard } from '@/components/game/LobbyCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Pickaxe, Zap, RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { GameLobbyData } from '@/hooks/useGameLobby';

const Index = () => {
  const { user } = useCurrentUser();
  const { data: lobbies, isLoading, refetch, isRefetching } = useGameLobbies();
  const { updateStatus } = useUpdateGameStatus();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useSeoMeta({
    title: 'SatMiner — Mine for Bitcoin, Win Sats',
    description: 'A multiplayer Nostr game where you mine for hidden Bitcoin. Bet sats, find the treasure, winner takes all!',
  });

  const handleGameCreated = (gameId: string, _seed: string) => {
    if (user) {
      // Navigate to game page — payment gate will show first
      navigate(`/game/${user.pubkey}/${gameId}`);
    }
  };

  const handleJoin = (lobby: GameLobbyData) => {
    if (!user) return;
    setJoiningId(lobby.gameId);
    // Navigate to game page — payment gate will show first.
    // The player is registered by paying (zap receipt = proof of entry).
    navigate(`/game/${lobby.hostPubkey}/${lobby.gameId}`);
  };

  const handleStart = async (lobby: GameLobbyData) => {
    try {
      await updateStatus(lobby, 'playing');
      navigate(`/game/${lobby.hostPubkey}/${lobby.gameId}`);
    } catch (error) {
      toast({
        title: 'Failed to start',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Hero */}
      <div className="relative overflow-hidden isolate">
        {/* Animated background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-amber-900/10 via-stone-950 to-stone-950" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl animate-pulse" />
          <div className="absolute top-20 right-1/4 w-72 h-72 bg-orange-500/5 rounded-full blur-3xl animate-pulse delay-1000" />
          
          {/* Pixel stars */}
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-0.5 h-0.5 bg-white/30 rounded-full animate-pulse"
              style={{
                left: `${(i * 37) % 100}%`,
                top: `${(i * 23) % 40}%`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: `${2 + (i % 3)}s`,
              }}
            />
          ))}
        </div>

        <div className="max-w-5xl mx-auto px-4 pt-12 pb-8">
          {/* Nav */}
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/20 border border-amber-500/30 rounded-xl flex items-center justify-center">
                <Pickaxe className="w-5 h-5 text-amber-400" />
              </div>
              <span className="text-lg font-mono font-bold text-stone-200">SatMiner</span>
            </div>
            <LoginArea className="max-w-60" />
          </div>

          {/* Hero content */}
          <div className="text-center space-y-6 mb-12">
            <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-current" />
              <span className="text-xs font-mono text-amber-400">Multiplayer Bitcoin Mining Game</span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight">
              <span className="text-stone-100">Mine Deep.</span>
              <br />
              <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent">
                Find Bitcoin.
              </span>
              <br />
              <span className="text-stone-100">Win Sats.</span>
            </h1>

            <p className="text-stone-400 max-w-lg mx-auto text-base sm:text-lg font-mono">
              Bet sats, grab your pickaxe, and race other miners to find the hidden Bitcoin. Winner takes the whole pot.
            </p>

            {user ? (
              <Button
                onClick={() => setCreateDialogOpen(true)}
                size="lg"
                className="bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold text-base px-8 py-6 rounded-xl shadow-lg shadow-amber-900/30 hover:shadow-amber-900/50 transition-all hover:scale-105"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create New Game
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-stone-500 font-mono">Log in with Nostr to start playing</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game Lobbies */}
      <div className="max-w-5xl mx-auto px-4 pb-16">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-mono font-bold text-stone-200">Open Games</h2>
            <button
              onClick={() => refetch()}
              className="text-stone-500 hover:text-stone-300 transition-colors"
              aria-label="Refresh lobbies"
            >
              {isRefetching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          </div>

          {user && (
            <Button
              onClick={() => setCreateDialogOpen(true)}
              variant="outline"
              size="sm"
              className="border-stone-700 bg-stone-900/50 text-stone-300 hover:bg-stone-800 font-mono"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New Game
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="bg-stone-900/70 border-stone-700/50">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full bg-stone-800" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-24 bg-stone-800" />
                      <Skeleton className="h-3 w-16 bg-stone-800" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-full bg-stone-800" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : lobbies && lobbies.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {lobbies.map((lobby) => (
              <LobbyCard
                key={`${lobby.hostPubkey}-${lobby.gameId}`}
                lobby={lobby}
                currentPubkey={user?.pubkey}
                onJoin={handleJoin}
                onStart={handleStart}
                isJoining={joiningId === lobby.gameId}
              />
            ))}
          </div>
        ) : (
          <Card className="border-dashed border-stone-700/50 bg-stone-900/30">
            <CardContent className="py-16 px-8 text-center">
              <div className="max-w-sm mx-auto space-y-4">
                <div className="text-4xl">⛏️</div>
                <p className="text-stone-400 font-mono">
                  No open games right now.
                </p>
                {user ? (
                  <Button
                    onClick={() => setCreateDialogOpen(true)}
                    className="bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Be the First to Create One
                  </Button>
                ) : (
                  <p className="text-sm text-stone-500 font-mono">
                    Log in to create a game
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-stone-800/50 py-8">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-stone-600 text-xs font-mono">
            <Pickaxe className="w-3 h-3" />
            <span>SatMiner</span>
          </div>
          <a
            href="https://shakespeare.diy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-stone-600 hover:text-stone-400 transition-colors font-mono"
          >
            Vibed with Shakespeare
          </a>
        </div>
      </footer>

      {/* Create Game Dialog */}
      <CreateGameDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onGameCreated={handleGameCreated}
      />
    </div>
  );
};

export default Index;
