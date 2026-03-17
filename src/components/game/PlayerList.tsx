import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { getPlayerColor } from '@/lib/gameEngine';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Crown, Pickaxe } from 'lucide-react';

interface PlayerCardProps {
  pubkey: string;
  index: number;
  isHost: boolean;
  isWinner: boolean;
  isCurrent: boolean;
}

function PlayerCard({ pubkey, index, isHost, isWinner, isCurrent }: PlayerCardProps) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(pubkey);
  const color = getPlayerColor(index);

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
        isWinner
          ? 'bg-amber-500/20 border border-amber-500/50 ring-1 ring-amber-400/30'
          : isCurrent
            ? 'bg-stone-700/50 border border-stone-600/50'
            : 'bg-stone-800/30 border border-stone-700/30'
      }`}
    >
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <Avatar className="w-6 h-6">
        <AvatarImage src={metadata?.picture} />
        <AvatarFallback className="text-[8px] bg-stone-700">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs text-stone-300 truncate flex-1 font-mono">
        {displayName}
      </span>
      {isHost && (
        <Crown className="w-3 h-3 text-amber-400 flex-shrink-0" />
      )}
      {isWinner && (
        <span className="text-amber-400 text-xs">₿ WINNER</span>
      )}
      {isCurrent && !isWinner && (
        <Pickaxe className="w-3 h-3 text-stone-400 flex-shrink-0" />
      )}
    </div>
  );
}

interface PlayerListProps {
  players: string[];
  hostPubkey: string;
  currentPubkey?: string;
  winner: string | null;
}

export function PlayerList({ players, hostPubkey, currentPubkey, winner }: PlayerListProps) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-mono text-stone-500 uppercase tracking-wider px-1">
        Miners ({players.length})
      </h3>
      {players.map((pubkey, index) => (
        <PlayerCard
          key={pubkey}
          pubkey={pubkey}
          index={index}
          isHost={pubkey === hostPubkey}
          isWinner={pubkey === winner}
          isCurrent={pubkey === currentPubkey}
        />
      ))}
    </div>
  );
}
