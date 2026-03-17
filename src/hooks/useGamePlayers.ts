/**
 * useGamePlayers — The single source of truth for who is in a game.
 * 
 * The player list is built from TWO sources:
 * 1. The lobby event's host pubkey (always player #0)
 * 2. Zap receipts on the lobby event (anyone who paid is in the game)
 * 
 * This replaces the old system where the host's browser had to process
 * join actions and update the lobby event's p-tags. That was fragile
 * because it required the host to be online and on the waiting room screen.
 * 
 * Now: if you paid, you're in. Period.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { GameLobbyData } from './useGameLobby';

export interface GamePlayersResult {
  /** All players in the game (host + anyone who paid). Deduplicated, stable order. */
  players: string[];
  /** Set of pubkeys that have confirmed payment */
  paidPlayers: Set<string>;
  /** Whether all players in the list have paid */
  allPaid: boolean;
  /** Number of players who have paid */
  paidCount: number;
  /** Total sats actually received in the pot */
  totalPaid: number;
  /** Loading state */
  isLoading: boolean;
}

export function useGamePlayers(lobby: GameLobbyData | undefined): GamePlayersResult {
  const { nostr } = useNostr();
  const [paidPlayers, setPaidPlayers] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [totalPaid, setTotalPaid] = useState(0);

  const checkPayments = useCallback(async () => {
    if (!lobby) return;
    try {
      const zapReceipts: NostrEvent[] = await nostr.query(
        [{
          kinds: [9735],
          '#a': [`${lobby.event.kind}:${lobby.event.pubkey}:${lobby.gameId}`],
          limit: 50,
        }],
        { signal: AbortSignal.timeout(5000) },
      );

      const paid = new Set<string>();
      let total = 0;

      for (const receipt of zapReceipts) {
        const descriptionTag = receipt.tags.find(([name]) => name === 'description')?.[1];
        if (!descriptionTag) continue;

        try {
          const zapRequest = JSON.parse(descriptionTag);
          const senderPubkey = zapRequest.pubkey as string;
          if (!senderPubkey) continue;

          const amountTag = zapRequest.tags?.find(([name]: string[]) => name === 'amount')?.[1];
          if (amountTag) {
            const paidMillisats = parseInt(amountTag);
            if (paidMillisats >= lobby.betAmount * 1000) {
              paid.add(senderPubkey);
              total += Math.floor(paidMillisats / 1000);
            }
          }
        } catch {
          // Skip invalid
        }
      }

      setPaidPlayers(paid);
      setTotalPaid(total);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, [nostr, lobby?.event.kind, lobby?.event.pubkey, lobby?.gameId, lobby?.betAmount]);

  useEffect(() => {
    checkPayments();
    const interval = setInterval(checkPayments, 4000);
    return () => clearInterval(interval);
  }, [checkPayments]);

  // Build the unified player list:
  // Start with the host, then add anyone who paid (deduplicated, stable order)
  if (!lobby) {
    return { players: [], paidPlayers, allPaid: false, paidCount: 0, totalPaid, isLoading };
  }

  const players: string[] = [lobby.hostPubkey];

  // Add lobby p-tag players that aren't already in the list
  const lobbyPTags = lobby.event.tags
    .filter(([name]) => name === 'p')
    .map(([, pubkey]) => pubkey);
  
  for (const pk of lobbyPTags) {
    if (!players.includes(pk)) {
      players.push(pk);
    }
  }

  // Add anyone who paid but isn't in the lobby event yet
  for (const pk of paidPlayers) {
    if (!players.includes(pk)) {
      players.push(pk);
    }
  }

  const paidCount = players.filter(p => paidPlayers.has(p)).length;
  const allPaid = players.length > 0 && players.every(p => paidPlayers.has(p));

  return {
    players,
    paidPlayers,
    allPaid,
    paidCount,
    totalPaid,
    isLoading,
  };
}
