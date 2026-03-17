import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostrPublish } from './useNostrPublish';
import { useCurrentUser } from './useCurrentUser';
import { GAME_KINDS, MIN_BET_SATS, MAX_PLAYERS } from '@/lib/gameConstants';
import type { NostrEvent } from '@nostrify/nostrify';

export interface GameLobbyData {
  gameId: string;
  hostPubkey: string;
  betAmount: number;
  seed: string;
  status: 'waiting' | 'playing' | 'finished';
  maxPlayers: number;
  players: string[];
  event: NostrEvent;
}

function parseGameLobby(event: NostrEvent): GameLobbyData | null {
  try {
    const d = event.tags.find(([name]) => name === 'd')?.[1];
    const betTag = event.tags.find(([name]) => name === 'bet')?.[1];
    const seedTag = event.tags.find(([name]) => name === 'seed')?.[1];
    const statusTag = event.tags.find(([name]) => name === 'status')?.[1];
    const maxPlayersTag = event.tags.find(([name]) => name === 'max_players')?.[1];
    const playerTags = event.tags.filter(([name]) => name === 'p').map(([, pubkey]) => pubkey);

    if (!d || !betTag || !seedTag || !statusTag) return null;

    return {
      gameId: d,
      hostPubkey: event.pubkey,
      betAmount: parseInt(betTag),
      seed: seedTag,
      status: statusTag as 'waiting' | 'playing' | 'finished',
      maxPlayers: maxPlayersTag ? parseInt(maxPlayersTag) : MAX_PLAYERS,
      players: [event.pubkey, ...playerTags],
      event,
    };
  } catch {
    return null;
  }
}

export function useGameLobbies() {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['game-lobbies'],
    queryFn: async () => {
      const events = await nostr.query(
        [{ kinds: [GAME_KINDS.LOBBY], '#status': ['waiting'], limit: 20 }],
        { signal: AbortSignal.timeout(5000) },
      );

      return events
        .map(parseGameLobby)
        .filter((lobby): lobby is GameLobbyData => lobby !== null)
        .filter(lobby => lobby.betAmount >= MIN_BET_SATS);
    },
    refetchInterval: 5000,
  });
}

export function useGameLobby(gameId: string, hostPubkey: string, isPlaying = false) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['game-lobby', gameId, hostPubkey],
    queryFn: async () => {
      const events = await nostr.query(
        [{
          kinds: [GAME_KINDS.LOBBY],
          authors: [hostPubkey],
          '#d': [gameId],
          limit: 1,
        }],
        { signal: AbortSignal.timeout(5000) },
      );

      if (events.length === 0) return null;
      return parseGameLobby(events[0]);
    },
    // Stop polling once gameplay starts — the lobby event doesn't change mid-game
    // and polling wastes relay connections that are needed for ACTION events.
    refetchInterval: isPlaying ? false : 3000,
    enabled: !!gameId && !!hostPubkey,
  });
}

export function useCreateGame() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const createGame = async (betAmount: number) => {
    if (!user) throw new Error('Must be logged in');
    if (betAmount < MIN_BET_SATS) throw new Error(`Minimum bet is ${MIN_BET_SATS} sats`);

    const gameId = `satminer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seed = `${gameId}-${user.pubkey}-${Date.now()}`;

    const event = await createEvent({
      kind: GAME_KINDS.LOBBY,
      content: '',
      tags: [
        ['d', gameId],
        ['bet', betAmount.toString()],
        ['seed', seed],
        ['status', 'waiting'],
        ['max_players', MAX_PLAYERS.toString()],
        ['t', 'satminer'],
        ['alt', 'SatMiner game lobby - a multiplayer Bitcoin mining game'],
      ],
      created_at: Math.floor(Date.now() / 1000),
    });

    queryClient.invalidateQueries({ queryKey: ['game-lobbies'] });

    return { gameId, seed, event };
  };

  return { createGame };
}

export function useJoinGame() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const joinGame = async (lobby: GameLobbyData) => {
    if (!user) throw new Error('Must be logged in');
    if (lobby.players.includes(user.pubkey)) throw new Error('Already in this game');
    if (lobby.players.length >= lobby.maxPlayers) throw new Error('Game is full');

    // Publish a join action event
    await createEvent({
      kind: GAME_KINDS.ACTION,
      content: JSON.stringify({ type: 'join' }),
      tags: [
        ['e', lobby.event.id],
        ['p', lobby.hostPubkey],
        ['d', lobby.gameId],
        ['t', 'satminer'],
        ['alt', 'Player joining SatMiner game'],
      ],
      created_at: Math.floor(Date.now() / 1000),
    });

    queryClient.invalidateQueries({ queryKey: ['game-lobby', lobby.gameId, lobby.hostPubkey] });
    queryClient.invalidateQueries({ queryKey: ['game-lobbies'] });
  };

  return { joinGame };
}

export function useUpdateGameStatus() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  const updateStatus = async (lobby: GameLobbyData, status: 'waiting' | 'playing' | 'finished') => {
    await createEvent({
      kind: GAME_KINDS.LOBBY,
      content: '',
      tags: [
        ['d', lobby.gameId],
        ['bet', lobby.betAmount.toString()],
        ['seed', lobby.seed],
        ['status', status],
        ['max_players', lobby.maxPlayers.toString()],
        ...lobby.players.slice(1).map(p => ['p', p]),
        ['t', 'satminer'],
        ['alt', `SatMiner game - status: ${status}`],
      ],
      created_at: Math.floor(Date.now() / 1000),
    });

    queryClient.invalidateQueries({ queryKey: ['game-lobby', lobby.gameId, lobby.hostPubkey] });
    queryClient.invalidateQueries({ queryKey: ['game-lobbies'] });
  };

  return { updateStatus };
}

export function useGameActions(gameId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['game-actions', gameId],
    queryFn: async () => {
      const events = await nostr.query(
        [{
          kinds: [GAME_KINDS.ACTION],
          '#d': [gameId],
          limit: 100,
        }],
        { signal: AbortSignal.timeout(5000) },
      );

      return events;
    },
    refetchInterval: 1000,
    enabled: !!gameId,
  });
}

export function usePublishAction() {
  const { mutateAsync: createEvent } = useNostrPublish();

  const publishAction = async (gameId: string, action: { type: string; direction?: string }) => {
    await createEvent({
      kind: GAME_KINDS.ACTION,
      content: JSON.stringify(action),
      tags: [
        ['d', gameId],
        ['t', 'satminer'],
        ['alt', `SatMiner game action: ${action.type}`],
      ],
      created_at: Math.floor(Date.now() / 1000),
    });
  };

  return { publishAction };
}

export function useClaimWin() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  const claimWin = async (gameId: string, hostPubkey: string) => {
    await createEvent({
      kind: GAME_KINDS.RESULT,
      content: JSON.stringify({ result: 'win', gameId }),
      tags: [
        ['d', gameId],
        ['p', hostPubkey],
        ['t', 'satminer'],
        ['alt', 'SatMiner game win claim'],
      ],
      created_at: Math.floor(Date.now() / 1000),
    });

    queryClient.invalidateQueries({ queryKey: ['game-lobby', gameId, hostPubkey] });
  };

  return { claimWin };
}
