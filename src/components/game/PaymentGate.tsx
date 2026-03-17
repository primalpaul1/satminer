import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { useToast } from '@/hooks/useToast';
import { WalletModal } from '@/components/WalletModal';
import { HOUSE_PUBKEY_HEX } from '@/lib/houseAccount';
import {
  Zap,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Wallet,
  CheckCircle2,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';
import { nip57 } from 'nostr-tools';
import QRCode from 'qrcode';
import type { GameLobbyData } from '@/hooks/useGameLobby';
import type { WebLNProvider } from '@webbtc/webln-types';
import { useNostr } from '@nostrify/react';
import { CharacterPicker } from './CharacterPicker';

interface PaymentGateProps {
  lobby: GameLobbyData;
  selectedCharacter: string;
  onSelectCharacter: (id: string) => void;
  onPaymentComplete: () => void;
  onBack: () => void;
}

export function PaymentGate({ lobby, selectedCharacter, onSelectCharacter, onPaymentComplete, onBack }: PaymentGateProps) {
  const { user } = useCurrentUser();
  const houseAuthor = useAuthor(HOUSE_PUBKEY_HEX);
  const { config } = useAppContext();
  const { webln } = useWallet();
  const { sendPayment, getActiveConnection } = useNWC();
  const { nostr } = useNostr();
  const { toast } = useToast();

  const [invoice, setInvoice] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPaid, setIsPaid] = useState(false);

  const amount = lobby.betAmount;

  // Check if current user already has a zap receipt on the lobby event
  const checkExistingPayment = useCallback(async () => {
    if (!user) return;

    try {
      // Check for zap receipts on the lobby event from this user
      const zapReceipts = await nostr.query(
        [{
          kinds: [9735],
          '#a': [`${lobby.event.kind}:${lobby.event.pubkey}:${lobby.gameId}`],
          limit: 50,
        }],
        { signal: AbortSignal.timeout(5000) },
      );

      for (const receipt of zapReceipts) {
        const descriptionTag = receipt.tags.find(([name]) => name === 'description')?.[1];
        if (descriptionTag) {
          try {
            const zapRequest = JSON.parse(descriptionTag);
            if (zapRequest.pubkey === user.pubkey) {
              const amountTag = zapRequest.tags?.find(([name]: string[]) => name === 'amount')?.[1];
              if (amountTag) {
                const paidMillisats = parseInt(amountTag);
                if (paidMillisats >= amount * 1000) {
                  setIsPaid(true);
                  return;
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch {
      // Query failed, continue
    }
  }, [user, nostr, lobby, amount]);

  useEffect(() => {
    checkExistingPayment();
  }, [checkExistingPayment]);

  // If already paid, auto-advance
  useEffect(() => {
    if (isPaid) {
      const timer = setTimeout(() => onPaymentComplete(), 1500);
      return () => clearTimeout(timer);
    }
  }, [isPaid, onPaymentComplete]);

  // Generate QR code when invoice changes
  useEffect(() => {
    if (!invoice) {
      setQrCodeUrl('');
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(invoice.toUpperCase(), {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    }).then((url) => {
      if (!cancelled) setQrCodeUrl(url);
    }).catch(console.error);

    return () => { cancelled = true; };
  }, [invoice]);

  // Poll for payment confirmation after invoice is generated
  useEffect(() => {
    if (!invoice || isPaid) return;

    const interval = setInterval(() => {
      checkExistingPayment();
    }, 3000);

    return () => clearInterval(interval);
  }, [invoice, isPaid, checkExistingPayment]);

  const generateInvoice = async () => {
    if (!user) return;

    setIsGenerating(true);
    try {
      // Use the HOUSE ACCOUNT for receiving payments
      const authorData = houseAuthor.data;
      if (!authorData?.metadata || !authorData.event) {
        toast({
          title: 'House account not found',
          description: 'Could not load the game\'s escrow account. Try again in a moment.',
          variant: 'destructive',
        });
        setIsGenerating(false);
        return;
      }

      const { lud06, lud16 } = authorData.metadata;
      if (!lud06 && !lud16) {
        toast({
          title: 'Payment unavailable',
          description: 'The house account does not have a Lightning address configured.',
          variant: 'destructive',
        });
        setIsGenerating(false);
        return;
      }

      const zapEndpoint = await nip57.getZapEndpoint(authorData.event);
      if (!zapEndpoint) {
        toast({
          title: 'Zap endpoint not found',
          description: 'Could not find a payment endpoint for the house account.',
          variant: 'destructive',
        });
        setIsGenerating(false);
        return;
      }

      const zapAmount = amount * 1000; // millisats

      // Zap the HOUSE ACCOUNT, but reference the lobby event for tracking
      const zapRequest = nip57.makeZapRequest({
        profile: HOUSE_PUBKEY_HEX,
        event: lobby.event,
        amount: zapAmount,
        relays: config.relayMetadata.relays.map(r => r.url),
        comment: `SatMiner entry: ${lobby.gameId}`,
      });

      const signedZapRequest = await user.signer.signEvent(zapRequest);

      const res = await fetch(
        `${zapEndpoint}?amount=${zapAmount}&nostr=${encodeURI(JSON.stringify(signedZapRequest))}`,
      );
      const responseData = await res.json();

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${responseData.reason || 'Unknown error'}`);
      }

      const newInvoice = responseData.pr;
      if (!newInvoice || typeof newInvoice !== 'string') {
        throw new Error('Lightning service did not return a valid invoice');
      }

      setInvoice(newInvoice);

      // Try auto-pay with NWC or WebLN
      await attemptAutoPay(newInvoice);
    } catch (error) {
      console.error('Failed to generate invoice:', error);
      toast({
        title: 'Invoice generation failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const attemptAutoPay = async (inv: string) => {
    setIsPaying(true);
    try {
      // Try NWC first
      const nwcConnection = getActiveConnection();
      if (nwcConnection?.connectionString && nwcConnection.isConnected) {
        try {
          await sendPayment(nwcConnection, inv);
          toast({
            title: 'Payment sent!',
            description: `${amount} sats paid via NWC.`,
          });
          setIsPaying(false);
          setIsPaid(true);
          return;
        } catch (nwcError) {
          console.error('NWC auto-pay failed:', nwcError);
        }
      }

      // Try WebLN
      if (webln) {
        try {
          let provider = webln;
          if (webln.enable && typeof webln.enable === 'function') {
            const enabledProvider = await webln.enable();
            const p = enabledProvider as WebLNProvider | undefined;
            if (p) provider = p;
          }
          await provider.sendPayment(inv);
          toast({
            title: 'Payment sent!',
            description: `${amount} sats paid via WebLN.`,
          });
          setIsPaying(false);
          setIsPaid(true);
          return;
        } catch (weblnError) {
          console.error('WebLN auto-pay failed:', weblnError);
        }
      }

      // No auto-pay available
      setIsPaying(false);
    } catch {
      setIsPaying(false);
    }
  };

  const handleCopy = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    toast({ title: 'Invoice copied!' });
    setTimeout(() => setCopied(false), 2000);
  };

  const openInWallet = () => {
    if (invoice) {
      window.open(`lightning:${invoice}`, '_blank');
    }
  };

  // Already paid state
  if (isPaid) {
    return (
      <div className="max-w-md mx-auto text-center space-y-6 py-12">
        <div className="relative inline-flex">
          <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse" />
          <CheckCircle2 className="relative w-16 h-16 text-emerald-400" />
        </div>
        <h2 className="text-xl font-mono font-bold text-stone-200">Payment Confirmed!</h2>
        <p className="text-sm text-stone-400 font-mono">
          Your {amount} sat entry fee has been received. Entering the game...
        </p>
        <Loader2 className="w-5 h-5 text-amber-400 animate-spin mx-auto" />
      </div>
    );
  }

  // Pre-invoice: show pay button
  if (!invoice) {
    return (
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-stone-400 hover:text-stone-200 mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="text-xs font-mono">Back</span>
          </Button>

          <div className="relative inline-flex items-center justify-center">
            <div className="absolute w-20 h-20 bg-amber-500/10 rounded-full blur-xl animate-pulse" />
            <div className="relative flex items-center gap-2 bg-stone-800/80 border border-stone-700/50 rounded-2xl px-6 py-3">
              <Zap className="w-6 h-6 text-amber-400 fill-current" />
              <span className="text-3xl font-mono font-bold text-amber-400">{amount}</span>
              <span className="text-sm text-stone-400 font-mono">sats</span>
            </div>
          </div>

          <h2 className="text-xl font-mono font-bold text-stone-200 pt-2">
            Entry Fee Required
          </h2>
          <p className="text-sm text-stone-400 font-mono">
            Pay <span className="text-amber-400">{amount} sats</span> via Lightning to enter the game.
            The winner takes the entire pot!
          </p>
        </div>

        {/* Escrow info */}
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-emerald-400/80 font-mono">
            Funds are held in escrow by the SatMiner house account. The winner receives the full pot automatically. If no one joins within 1 hour, you get a refund.
          </p>
        </div>

        {/* Wallet connection status */}
        <div className="bg-stone-900/50 border border-stone-700/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-stone-500 uppercase tracking-wider">
              Payment Method
            </span>
            <WalletModal>
              <button className="text-xs font-mono text-amber-400/80 hover:text-amber-400 transition-colors flex items-center gap-1">
                <Wallet className="w-3 h-3" />
                Configure
              </button>
            </WalletModal>
          </div>

          {getActiveConnection()?.isConnected ? (
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              NWC Wallet connected — auto-pay enabled
            </div>
          ) : webln ? (
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono">
              <CheckCircle2 className="w-3.5 h-3.5" />
              WebLN detected — auto-pay enabled
            </div>
          ) : (
            <div className="text-xs text-stone-500 font-mono">
              No wallet connected. You can still pay by scanning a QR code or copying the invoice.
            </div>
          )}
        </div>

        {/* Character picker */}
        <div className="bg-stone-900/50 border border-stone-700/30 rounded-xl p-4">
          <CharacterPicker
            selected={selectedCharacter}
            onSelect={onSelectCharacter}
          />
        </div>

        <Button
          onClick={generateInvoice}
          disabled={isGenerating}
          className="w-full bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold text-base py-5"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Invoice...
            </>
          ) : (
            <>
              <Zap className="w-5 h-5 mr-2 fill-current" />
              Pay {amount} sats to Enter
            </>
          )}
        </Button>

        <p className="text-[10px] text-stone-600 font-mono text-center">
          Entry fee is held in escrow. Winner receives the pot. 
          Refunds issued if the game doesn&apos;t start within 1 hour.
        </p>
      </div>
    );
  }

  // Invoice generated: show payment UI
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setInvoice(null)}
          className="text-stone-400 hover:text-stone-200 mb-2"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          <span className="text-xs font-mono">Back</span>
        </Button>

        <h2 className="text-lg font-mono font-bold text-stone-200">
          Pay {amount} sats
        </h2>
        <p className="text-xs text-stone-400 font-mono">
          Scan the QR code or copy the invoice to pay
        </p>
      </div>

      {isPaying && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
          <span className="text-sm text-amber-400 font-mono">Processing payment...</span>
        </div>
      )}

      {/* QR Code */}
      <Card className="bg-white p-2 mx-auto max-w-[280px]">
        <CardContent className="p-0">
          {qrCodeUrl ? (
            <img
              src={qrCodeUrl}
              alt="Lightning Invoice QR"
              className="w-full h-auto aspect-square"
            />
          ) : (
            <div className="w-full aspect-square bg-stone-100 animate-pulse rounded" />
          )}
        </CardContent>
      </Card>

      {/* Invoice copy */}
      <div className="flex gap-2">
        <Input
          value={invoice}
          readOnly
          className="bg-stone-800 border-stone-700 text-stone-300 font-mono text-xs"
          onClick={(e) => e.currentTarget.select()}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleCopy}
          className="border-stone-700 bg-stone-800 hover:bg-stone-700 flex-shrink-0"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4 text-stone-400" />
          )}
        </Button>
      </div>

      {/* Action buttons */}
      <div className="space-y-2">
        {webln && (
          <Button
            onClick={() => attemptAutoPay(invoice)}
            disabled={isPaying}
            className="w-full bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold"
          >
            <Zap className="w-4 h-4 mr-2 fill-current" />
            {isPaying ? 'Processing...' : 'Pay with Wallet'}
          </Button>
        )}

        <Button
          variant="outline"
          onClick={openInWallet}
          className="w-full border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700/50 font-mono"
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Open in Lightning Wallet
        </Button>
      </div>

      {/* Waiting for confirmation */}
      <div className="flex items-center justify-center gap-2 pt-2">
        <Loader2 className="w-4 h-4 text-stone-500 animate-spin" />
        <span className="text-xs text-stone-500 font-mono">
          Waiting for payment confirmation...
        </span>
      </div>
    </div>
  );
}

// Note: The old usePaidPlayers hook has been replaced by useGamePlayers 
// in @/hooks/useGamePlayers.ts which is the single source of truth for
// player lists and payment status.
