/**
 * SatMiner Payout Worker
 *
 * Cloudflare Worker that holds the house wallet credentials server-side
 * and processes payouts / refunds. The frontend never sees the nsec or NWC string.
 */

import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import * as nip19 from 'nostr-tools/nip19';
import * as nip57 from 'nostr-tools/nip57';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  HOUSE_NSEC: string;
  HOUSE_NWC: string;
  ALLOWED_ORIGIN: string;
  DEFAULT_RELAYS: string;
}

interface PayoutRequest {
  gameId: string;
  hostPubkey: string;
  winnerPubkey: string;
  relays?: string[];
}

interface RefundRequest {
  gameId: string;
  hostPubkey: string;
  betAmount: number;
  refundPubkeys: string[];
  relays?: string[];
}

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// In-memory dedup guards (cleared on worker restart, which is fine —
// the Nostr zap-receipt check provides durable dedup).
const paidGames = new Set<string>();
const refundedGames = new Set<string>();

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// House keys
// ---------------------------------------------------------------------------

function getHouseKeys(nsec: string): { secretKey: Uint8Array; pubkey: string } {
  const decoded = nip19.decode(nsec as `nsec1${string}`);
  if (decoded.type !== 'nsec') throw new Error('Invalid HOUSE_NSEC');
  const secretKey = decoded.data;
  const pubkey = getPublicKey(secretKey);
  return { secretKey, pubkey };
}

// ---------------------------------------------------------------------------
// NWC helpers
// ---------------------------------------------------------------------------

interface NWCParams {
  walletPubkey: string;
  relayUrl: string;
  secretKey: Uint8Array;
  ourPubkey: string;
}

function parseNWC(uri: string): NWCParams {
  const url = new URL(uri.replace('nostr+walletconnect://', 'http://'));
  const walletPubkey = url.hostname || url.pathname.replace('//', '');
  const relayUrl = url.searchParams.get('relay');
  const secret = url.searchParams.get('secret');
  if (!relayUrl || !secret) throw new Error('Invalid NWC URI — missing relay or secret');
  const secretKey = hexToBytes(secret);
  const ourPubkey = getPublicKey(secretKey);
  return { walletPubkey, relayUrl, secretKey, ourPubkey };
}

/**
 * Connect to a WebSocket using the Cloudflare Workers fetch-upgrade pattern.
 * CF Workers don't support `new WebSocket(url)` for outbound connections.
 */
async function connectWS(url: string): Promise<WebSocket> {
  const resp = await fetch(url, { headers: { Upgrade: 'websocket' } });
  const ws = (resp as unknown as { webSocket: WebSocket | null }).webSocket;
  if (!ws) throw new Error(`Failed to establish WebSocket to ${url}`);
  ws.accept();
  return ws;
}

/**
 * Pay a Lightning invoice via NWC (NIP-47).
 * Opens a WebSocket to the NWC relay, sends a pay_invoice request, and waits for the result.
 */
async function payViaNWC(nwcUri: string, invoice: string): Promise<string> {
  const { walletPubkey, relayUrl, secretKey } = parseNWC(nwcUri);

  // Build NIP-47 request content
  const plaintext = JSON.stringify({ method: 'pay_invoice', params: { invoice } });
  const encrypted = await nip04.encrypt(secretKey, walletPubkey, plaintext);

  const requestEvent = finalizeEvent(
    {
      kind: 23194,
      content: encrypted,
      tags: [['p', walletPubkey]],
      created_at: Math.floor(Date.now() / 1000),
    } as EventTemplate,
    secretKey,
  );

  const ws = await connectWS(relayUrl);

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error('NWC payment timed out after 60 seconds'));
    }, 60_000);

    ws.addEventListener('message', async (evt) => {
      try {
        const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer));
        if (msg[0] === 'EVENT' && msg[1] === 'nwc-res') {
          const responseEvent = msg[2] as NostrEvent;
          const decrypted = await nip04.decrypt(secretKey, walletPubkey, responseEvent.content);
          const result = JSON.parse(decrypted);

          clearTimeout(timeout);
          try { ws.close(); } catch { /* ignore */ }

          if (result.error) {
            reject(new Error(result.error.message || JSON.stringify(result.error)));
          } else {
            resolve(result.result?.preimage || '');
          }
        }
      } catch (e) {
        // ignore parse errors on non-relevant messages
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error on NWC relay: ${relayUrl}`));
    });

    // Send immediately — connection is already established after accept()
    ws.send(JSON.stringify([
      'REQ', 'nwc-res',
      { kinds: [23195], authors: [walletPubkey], '#e': [requestEvent.id] },
    ]));
    ws.send(JSON.stringify(['EVENT', requestEvent]));
  });
}

// ---------------------------------------------------------------------------
// Nostr relay helpers
// ---------------------------------------------------------------------------

/** Query a single relay and return matching events (with EOSE-based completion). */
async function queryRelay(relayUrl: string, filter: Record<string, unknown>, timeoutMs = 8000): Promise<NostrEvent[]> {
  let ws: WebSocket;
  try {
    ws = await connectWS(relayUrl);
  } catch {
    return [];
  }

  return new Promise<NostrEvent[]>((resolve) => {
    const events: NostrEvent[] = [];
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(events);
    }, timeoutMs);

    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer));
        if (msg[0] === 'EVENT' && msg[1] === 'q') {
          events.push(msg[2] as NostrEvent);
        } else if (msg[0] === 'EOSE') {
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          resolve(events);
        }
      } catch { /* ignore */ }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(events);
    });

    // Send immediately — connection is already established
    ws.send(JSON.stringify(['REQ', 'q', filter]));
  });
}

/** Try querying multiple relays in order until one succeeds with results. */
async function queryRelays(relayUrls: string[], filter: Record<string, unknown>): Promise<NostrEvent[]> {
  for (const url of relayUrls) {
    try {
      const events = await queryRelay(url, filter);
      if (events.length > 0) return events;
    } catch { /* try next */ }
  }
  return [];
}

/** Publish an event to all relays (best-effort, don't wait for all). */
async function publishToRelays(relayUrls: string[], event: VerifiedEvent): Promise<void> {
  await Promise.allSettled(
    relayUrls.map(async (url) => {
      try {
        const ws = await connectWS(url);
        ws.send(JSON.stringify(['EVENT', event]));
        // Give it a moment to send, then close
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            try { ws.close(); } catch { /* ignore */ }
            resolve();
          }, 1000);
        });
      } catch { /* ignore */ }
    }),
  );
}

// ---------------------------------------------------------------------------
// Payout logic
// ---------------------------------------------------------------------------

async function handlePayout(body: PayoutRequest, env: Env): Promise<Response> {
  const { gameId, hostPubkey, winnerPubkey, relays: clientRelays } = body;

  if (!gameId || !hostPubkey || !winnerPubkey) {
    return json({ success: false, error: 'Missing required fields: gameId, hostPubkey, winnerPubkey' }, 400);
  }

  // Dedup guard
  const dedupeKey = `payout:${gameId}:${winnerPubkey}`;
  if (paidGames.has(dedupeKey)) {
    return json({ success: true, message: 'Payout already processed' });
  }

  const relays = clientRelays?.length ? clientRelays : env.DEFAULT_RELAYS.split(',');
  const { secretKey, pubkey: housePubkey } = getHouseKeys(env.HOUSE_NSEC);

  // 1. Verify the lobby exists on a relay
  const lobbyEvents = await queryRelays(relays, {
    kinds: [35303],
    authors: [hostPubkey],
    '#d': [gameId],
    limit: 1,
  });

  if (lobbyEvents.length === 0) {
    return json({ success: false, error: 'Game lobby not found on relays' }, 404);
  }

  const lobby = lobbyEvents[0];
  const betTag = lobby.tags.find(([t]) => t === 'bet');
  const betAmount = betTag ? parseInt(betTag[1]) : 0;
  if (!betAmount) {
    return json({ success: false, error: 'Could not determine bet amount from lobby event' }, 400);
  }

  // Count players from p-tags
  const playerPubkeys = lobby.tags.filter(([t]) => t === 'p').map(([, pk]) => pk);
  // Include host
  const allPlayers = [hostPubkey, ...playerPubkeys.filter((pk) => pk !== hostPubkey)];
  const totalPot = betAmount * Math.max(allPlayers.length, 2); // at least 2 players

  // 2. Check for existing payout (durable dedup via Nostr)
  const existingPayouts = await queryRelays(relays, {
    kinds: [9735],
    authors: [housePubkey],
    '#p': [winnerPubkey],
    limit: 10,
  });

  for (const payout of existingPayouts) {
    const descTag = payout.tags.find(([t]) => t === 'description');
    if (descTag?.[1]?.includes(gameId)) {
      paidGames.add(dedupeKey);
      return json({ success: true, message: 'Payout already sent for this game' });
    }
  }

  // 3. Fetch winner's profile to get Lightning address
  const winnerProfiles = await queryRelays(relays, {
    kinds: [0],
    authors: [winnerPubkey],
    limit: 1,
  });

  if (winnerProfiles.length === 0) {
    return json({ success: false, error: 'Winner profile not found — cannot determine Lightning address' }, 404);
  }

  const winnerProfile = winnerProfiles[0];
  let metadata: { lud06?: string; lud16?: string };
  try {
    metadata = JSON.parse(winnerProfile.content);
  } catch {
    return json({ success: false, error: 'Could not parse winner profile metadata' }, 400);
  }

  if (!metadata.lud06 && !metadata.lud16) {
    return json({ success: false, error: 'Winner has no Lightning address configured' }, 400);
  }

  // 4. Get zap endpoint
  const zapEndpoint = await nip57.getZapEndpoint(winnerProfile as Parameters<typeof nip57.getZapEndpoint>[0]);
  if (!zapEndpoint) {
    return json({ success: false, error: 'Could not resolve zap endpoint for winner' }, 400);
  }

  // 5. Create and sign zap request from house account
  const zapAmount = totalPot * 1000; // millisats
  const zapRequest = nip57.makeZapRequest({
    profile: winnerPubkey,
    event: null,
    amount: zapAmount,
    relays,
    comment: `SatMiner payout! You won ${totalPot} sats from game ${gameId}`,
  });

  const signedZapRequest = finalizeEvent(zapRequest as EventTemplate, secretKey);

  // 6. Fetch invoice from the winner's LNURL endpoint
  const lnurlRes = await fetch(
    `${zapEndpoint}?amount=${zapAmount}&nostr=${encodeURIComponent(JSON.stringify(signedZapRequest))}`,
  );
  const lnurlData = (await lnurlRes.json()) as { pr?: string; reason?: string };

  if (!lnurlRes.ok || !lnurlData.pr) {
    return json({
      success: false,
      error: `LNURL error: ${lnurlData.reason || 'no invoice returned'}`,
    }, 502);
  }

  // 7. Pay the invoice via NWC
  let preimage: string;
  try {
    preimage = await payViaNWC(env.HOUSE_NWC, lnurlData.pr);
  } catch (err) {
    return json({
      success: false,
      error: `NWC payment failed: ${err instanceof Error ? err.message : String(err)}`,
    }, 502);
  }

  // 8. Publish zap receipt to relays for verifiability
  const receiptEvent = finalizeEvent(
    {
      kind: 9735,
      content: '',
      tags: [
        ['p', winnerPubkey],
        ['bolt11', lnurlData.pr],
        ['preimage', preimage],
        ['amount', zapAmount.toString()],
        ['description', JSON.stringify(signedZapRequest)],
      ],
      created_at: Math.floor(Date.now() / 1000),
    } as EventTemplate,
    secretKey,
  );

  await publishToRelays(relays, receiptEvent);

  paidGames.add(dedupeKey);

  return json({
    success: true,
    preimage,
    totalPot,
    message: `Paid ${totalPot} sats to winner`,
  });
}

// ---------------------------------------------------------------------------
// Refund logic
// ---------------------------------------------------------------------------

async function handleRefund(body: RefundRequest, env: Env): Promise<Response> {
  const { gameId, hostPubkey, betAmount, refundPubkeys, relays: clientRelays } = body;

  if (!gameId || !hostPubkey || !betAmount || !refundPubkeys?.length) {
    return json({ success: false, error: 'Missing required fields' }, 400);
  }

  const dedupeKey = `refund:${gameId}`;
  if (refundedGames.has(dedupeKey)) {
    return json({ success: true, message: 'Refunds already processed', results: [] });
  }

  const relays = clientRelays?.length ? clientRelays : env.DEFAULT_RELAYS.split(',');
  const { secretKey } = getHouseKeys(env.HOUSE_NSEC);

  const results: { pubkey: string; success: boolean; error?: string }[] = [];

  for (const pubkey of refundPubkeys) {
    try {
      // Fetch player profile
      const profiles = await queryRelays(relays, {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      });

      if (profiles.length === 0) {
        results.push({ pubkey, success: false, error: 'Profile not found' });
        continue;
      }

      let metadata: { lud06?: string; lud16?: string };
      try {
        metadata = JSON.parse(profiles[0].content);
      } catch {
        results.push({ pubkey, success: false, error: 'Invalid profile' });
        continue;
      }

      if (!metadata.lud06 && !metadata.lud16) {
        results.push({ pubkey, success: false, error: 'No Lightning address' });
        continue;
      }

      const zapEndpoint = await nip57.getZapEndpoint(profiles[0] as Parameters<typeof nip57.getZapEndpoint>[0]);
      if (!zapEndpoint) {
        results.push({ pubkey, success: false, error: 'No zap endpoint' });
        continue;
      }

      const refundAmount = betAmount * 1000; // millisats
      const zapRequest = nip57.makeZapRequest({
        profile: pubkey,
        event: null,
        amount: refundAmount,
        relays,
        comment: `SatMiner refund: ${betAmount} sats from expired game ${gameId}`,
      });

      const signedZapRequest = finalizeEvent(zapRequest as EventTemplate, secretKey);

      const lnurlRes = await fetch(
        `${zapEndpoint}?amount=${refundAmount}&nostr=${encodeURIComponent(JSON.stringify(signedZapRequest))}`,
      );
      const lnurlData = (await lnurlRes.json()) as { pr?: string; reason?: string };

      if (!lnurlRes.ok || !lnurlData.pr) {
        results.push({ pubkey, success: false, error: lnurlData.reason || 'No invoice returned' });
        continue;
      }

      const preimage = await payViaNWC(env.HOUSE_NWC, lnurlData.pr);

      // Publish refund receipt
      const refundReceipt = finalizeEvent(
        {
          kind: 9735,
          content: '',
          tags: [
            ['p', pubkey],
            ['bolt11', lnurlData.pr],
            ['preimage', preimage],
            ['amount', refundAmount.toString()],
            ['description', JSON.stringify(signedZapRequest)],
          ],
          created_at: Math.floor(Date.now() / 1000),
        } as EventTemplate,
        secretKey,
      );

      await publishToRelays(relays, refundReceipt);
      results.push({ pubkey, success: true });
    } catch (err) {
      results.push({ pubkey, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  refundedGames.add(dedupeKey);

  const successCount = results.filter((r) => r.success).length;
  return json({
    success: successCount > 0,
    results,
    message: `${successCount}/${refundPubkeys.length} refunds sent`,
  });
}

// ---------------------------------------------------------------------------
// Info endpoint (returns public house pubkey)
// ---------------------------------------------------------------------------

function handleInfo(env: Env): Response {
  const { pubkey } = getHouseKeys(env.HOUSE_NSEC);
  return json({ housePubkey: pubkey });
}

// ---------------------------------------------------------------------------
// CORS + routing
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : (allowed.split(',').includes(origin) ? origin : ''),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    let response: Response;

    try {
      if (url.pathname === '/info' && request.method === 'GET') {
        response = handleInfo(env);
      } else if (url.pathname === '/payout' && request.method === 'POST') {
        const body = (await request.json()) as PayoutRequest;
        response = await handlePayout(body, env);
      } else if (url.pathname === '/refund' && request.method === 'POST') {
        const body = (await request.json()) as RefundRequest;
        response = await handleRefund(body, env);
      } else {
        response = json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error('Worker error:', err);
      response = json({
        success: false,
        error: err instanceof Error ? err.message : 'Internal server error',
      }, 500);
    }

    // Attach CORS headers to every response
    for (const [key, value] of Object.entries(cors)) {
      if (value) response.headers.set(key, value);
    }

    return response;
  },
};
