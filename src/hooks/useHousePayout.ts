import { useState, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useAppContext } from './useAppContext';
import { useToast } from './useToast';
import { getHouseSigner, HOUSE_PUBKEY_HEX, payInvoiceFromHouse } from '@/lib/houseAccount';
import { nip57 } from 'nostr-tools';
import type { GameLobbyData } from './useGameLobby';

/**
 * Hook to handle house account payouts via NWC.
 * 
 * Flow for payouts:
 * 1. Sign a NIP-57 zap request from the house account → winner's profile
 * 2. Fetch an invoice from the winner's LNURL endpoint
 * 3. Pay the invoice from the house wallet via NWC
 * 4. Publish a verifiable payout record on Nostr
 */
// Track which game IDs have already been paid out or refunded to prevent duplicates
const payoutFiredForGame = new Set<string>();
const refundFiredForGame = new Set<string>();

export function useHousePayout() {
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { toast } = useToast();
  const [isPaying, setIsPaying] = useState(false);
  const [payoutComplete, setPayoutComplete] = useState(false);

  /**
   * Pay the winner the total pot.
   */
  const payWinner = useCallback(async (
    winnerPubkey: string,
    lobby: GameLobbyData,
  ) => {
    // Idempotency guard — prevent double payouts for the same game
    if (payoutFiredForGame.has(lobby.gameId)) {
      console.log(`[House] Payout already fired for game ${lobby.gameId}, skipping`);
      return null;
    }
    payoutFiredForGame.add(lobby.gameId);

    setIsPaying(true);

    try {
      const totalPot = lobby.betAmount * lobby.players.length;

      // Fetch winner's kind 0 profile to get their Lightning address
      const [winnerEvent] = await nostr.query(
        [{ kinds: [0], authors: [winnerPubkey], limit: 1 }],
        { signal: AbortSignal.timeout(5000) },
      );

      if (!winnerEvent) {
        throw new Error('Could not find winner\'s profile. They may need to add a Lightning address.');
      }

      let metadata: { lud06?: string; lud16?: string };
      try {
        metadata = JSON.parse(winnerEvent.content);
      } catch {
        throw new Error('Could not parse winner\'s profile metadata.');
      }

      if (!metadata.lud06 && !metadata.lud16) {
        throw new Error('Winner does not have a Lightning address configured. Payout cannot be sent automatically.');
      }

      // Get zap endpoint from the winner's profile
      const zapEndpoint = await nip57.getZapEndpoint(winnerEvent);
      if (!zapEndpoint) {
        throw new Error('Could not find a zap endpoint for the winner.');
      }

      const zapAmount = totalPot * 1000; // millisats

      // Create zap request from the house account to the winner
      const zapRequest = nip57.makeZapRequest({
        profile: winnerPubkey,
        event: null,
        amount: zapAmount,
        relays: config.relayMetadata.relays.map(r => r.url),
        comment: `SatMiner payout! You won ${totalPot} sats from game ${lobby.gameId}`,
      });

      // Sign with the house signer
      const houseSigner = getHouseSigner();
      const signedZapRequest = await houseSigner.signEvent(zapRequest);

      // Fetch the invoice from the winner's LNURL endpoint
      const res = await fetch(
        `${zapEndpoint}?amount=${zapAmount}&nostr=${encodeURI(JSON.stringify(signedZapRequest))}`,
      );
      const responseData = await res.json();

      if (!res.ok) {
        throw new Error(`LNURL error: ${responseData.reason || 'Unknown error'}`);
      }

      const payoutInvoice = responseData.pr;
      if (!payoutInvoice || typeof payoutInvoice !== 'string') {
        throw new Error('Winner\'s Lightning service did not return a valid invoice.');
      }

      // PAY the invoice from the house wallet via NWC
      console.log(`[House] Paying ${totalPot} sats to winner...`);
      const payResult = await payInvoiceFromHouse(payoutInvoice);
      console.log(`[House] Payment successful! Preimage: ${payResult.preimage}`);

      // Publish a verifiable payout record on Nostr
      const payoutEvent = {
        kind: 9735 as const,
        content: '',
        tags: [
          ['p', winnerPubkey],
          ['bolt11', payoutInvoice],
          ['preimage', payResult.preimage],
          ['amount', zapAmount.toString()],
          ['description', JSON.stringify(signedZapRequest)],
        ],
        created_at: Math.floor(Date.now() / 1000),
      };

      const signedPayout = await houseSigner.signEvent(payoutEvent);
      await nostr.event(signedPayout, { signal: AbortSignal.timeout(5000) });

      setPayoutComplete(true);

      toast({
        title: 'Payout sent! ⚡',
        description: `${totalPot} sats have been sent to the winner's Lightning wallet.`,
      });

      return payoutInvoice;
    } catch (error) {
      console.error('House payout failed:', error);
      toast({
        title: 'Payout issue',
        description: (error as Error).message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsPaying(false);
    }
  }, [nostr, config, toast]);

  /**
   * Refund all players who paid. Called when the game expires.
   */
  const refundPlayers = useCallback(async (
    lobby: GameLobbyData,
    paidPubkeys: string[],
  ) => {
    // Idempotency guard — prevent double refunds for the same game
    if (refundFiredForGame.has(lobby.gameId)) {
      console.log(`[House] Refund already fired for game ${lobby.gameId}, skipping`);
      return [];
    }
    refundFiredForGame.add(lobby.gameId);

    setIsPaying(true);

    const results: { pubkey: string; success: boolean; error?: string }[] = [];

    for (const pubkey of paidPubkeys) {
      try {
        // Fetch player's profile
        const [playerEvent] = await nostr.query(
          [{ kinds: [0], authors: [pubkey], limit: 1 }],
          { signal: AbortSignal.timeout(5000) },
        );

        if (!playerEvent) {
          results.push({ pubkey, success: false, error: 'Profile not found' });
          continue;
        }

        let metadata: { lud06?: string; lud16?: string };
        try {
          metadata = JSON.parse(playerEvent.content);
        } catch {
          results.push({ pubkey, success: false, error: 'Invalid profile' });
          continue;
        }

        if (!metadata.lud06 && !metadata.lud16) {
          results.push({ pubkey, success: false, error: 'No Lightning address' });
          continue;
        }

        const zapEndpoint = await nip57.getZapEndpoint(playerEvent);
        if (!zapEndpoint) {
          results.push({ pubkey, success: false, error: 'No zap endpoint' });
          continue;
        }

        const refundAmount = lobby.betAmount * 1000; // millisats

        const zapRequest = nip57.makeZapRequest({
          profile: pubkey,
          event: null,
          amount: refundAmount,
          relays: config.relayMetadata.relays.map(r => r.url),
          comment: `SatMiner refund: ${lobby.betAmount} sats from expired game ${lobby.gameId}`,
        });

        const houseSigner = getHouseSigner();
        const signedZapRequest = await houseSigner.signEvent(zapRequest);

        const res = await fetch(
          `${zapEndpoint}?amount=${refundAmount}&nostr=${encodeURI(JSON.stringify(signedZapRequest))}`,
        );
        const responseData = await res.json();

        if (!res.ok) {
          results.push({ pubkey, success: false, error: responseData.reason || 'LNURL error' });
          continue;
        }

        const refundInvoice = responseData.pr;
        if (!refundInvoice) {
          results.push({ pubkey, success: false, error: 'No invoice returned' });
          continue;
        }

        // PAY the refund invoice from the house wallet via NWC
        console.log(`[House] Refunding ${lobby.betAmount} sats to ${pubkey.slice(0, 8)}...`);
        const payResult = await payInvoiceFromHouse(refundInvoice);
        console.log(`[House] Refund successful! Preimage: ${payResult.preimage}`);

        // Publish refund record
        const refundEvent = {
          kind: 9735 as const,
          content: '',
          tags: [
            ['p', pubkey],
            ['bolt11', refundInvoice],
            ['preimage', payResult.preimage],
            ['amount', refundAmount.toString()],
            ['description', JSON.stringify(signedZapRequest)],
          ],
          created_at: Math.floor(Date.now() / 1000),
        };

        const signedRefund = await houseSigner.signEvent(refundEvent);
        await nostr.event(signedRefund, { signal: AbortSignal.timeout(5000) });

        results.push({ pubkey, success: true });
      } catch (error) {
        results.push({ pubkey, success: false, error: (error as Error).message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    toast({
      title: successCount > 0 ? 'Refunds sent! ⚡' : 'Refund issues',
      description: `${successCount}/${paidPubkeys.length} refunds paid successfully.`,
      variant: successCount > 0 ? undefined : 'destructive',
    });

    setIsPaying(false);
    return results;
  }, [nostr, config, toast]);

  return {
    payWinner,
    refundPlayers,
    isPaying,
    payoutComplete,
    housePubkey: HOUSE_PUBKEY_HEX,
  };
}
