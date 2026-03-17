import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Users, Zap, Loader2, Crown, Play } from 'lucide-react';
import type { GameLobbyData } from '@/hooks/useGameLobby';

interface LobbyCardProps {
  lobby: GameLobbyData;
  currentPubkey?: string;
  onJoin: (lobby: GameLobbyData) => void;
  onStart: (lobby: GameLobbyData) => void;
  isJoining: boolean;
}

export function LobbyCard({ lobby, currentPubkey, onJoin, onStart, isJoining }: LobbyCardProps) {
  const hostAuthor = useAuthor(lobby.hostPubkey);
  const hostName = hostAuthor.data?.metadata?.name ?? genUserName(lobby.hostPubkey);
  const isHost = currentPubkey === lobby.hostPubkey;
  const isInGame = currentPubkey ? lobby.players.includes(currentPubkey) : false;
  const totalPot = lobby.betAmount * lobby.players.length;
  const isFull = lobby.players.length >= lobby.maxPlayers;

  return (
    <div className="group relative bg-stone-900/70 border border-stone-700/50 rounded-xl p-5 hover:border-amber-600/40 transition-all hover:shadow-lg hover:shadow-amber-900/10">
      {/* Ambient glow */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-amber-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="relative space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 border-2 border-stone-700">
              <AvatarImage src={hostAuthor.data?.metadata?.picture} />
              <AvatarFallback className="bg-stone-800 text-stone-400 text-xs">
                {hostName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-stone-200">{hostName}</span>
                <Crown className="w-3 h-3 text-amber-400" />
              </div>
              <p className="text-xs text-stone-500 font-mono">Host</p>
            </div>
          </div>

          {/* Pot display */}
          <div className="text-right">
            <div className="flex items-center gap-1 text-amber-400">
              <Zap className="w-4 h-4 fill-current" />
              <span className="text-lg font-mono font-bold">{totalPot}</span>
            </div>
            <p className="text-xs text-stone-500 font-mono">sats in pot</p>
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-stone-400">
            <Users className="w-3.5 h-3.5" />
            <span className="text-xs font-mono">
              {lobby.players.length}/{lobby.maxPlayers}
            </span>
          </div>
          <div className="text-xs font-mono text-stone-500">
            Entry: <span className="text-amber-400/80">{lobby.betAmount} sats</span>
          </div>
          {isFull && (
            <span className="text-xs font-mono text-red-400/80 bg-red-400/10 px-2 py-0.5 rounded">
              FULL
            </span>
          )}
        </div>

        {/* Player avatars */}
        {lobby.players.length > 1 && (
          <div className="flex -space-x-2">
            {lobby.players.slice(0, 6).map((pubkey) => (
              <PlayerMiniAvatar key={pubkey} pubkey={pubkey} />
            ))}
            {lobby.players.length > 6 && (
              <div className="w-7 h-7 rounded-full bg-stone-700 border-2 border-stone-900 flex items-center justify-center text-[10px] text-stone-400">
                +{lobby.players.length - 6}
              </div>
            )}
          </div>
        )}

        {/* Action button */}
        <div>
          {isHost ? (
            <Button
              onClick={() => onStart(lobby)}
              disabled={lobby.players.length < 1}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold"
            >
              <Play className="w-4 h-4 mr-2" />
              Start Game
            </Button>
          ) : isInGame ? (
            <Button
              disabled
              className="w-full bg-stone-700 text-stone-400 font-mono"
            >
              Waiting for host to start...
            </Button>
          ) : (
            <Button
              onClick={() => onJoin(lobby)}
              disabled={isJoining || isFull || !currentPubkey}
              className="w-full bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold"
            >
              {isJoining ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2 fill-current" />
                  Join — {lobby.betAmount} sats
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerMiniAvatar({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const name = author.data?.metadata?.name ?? genUserName(pubkey);

  return (
    <Avatar className="w-7 h-7 border-2 border-stone-900">
      <AvatarImage src={author.data?.metadata?.picture} />
      <AvatarFallback className="bg-stone-700 text-[8px] text-stone-400">
        {name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
