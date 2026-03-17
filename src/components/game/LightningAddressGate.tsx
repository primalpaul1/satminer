import { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useAuthor } from '@/hooks/useAuthor';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Zap, Loader2, AlertTriangle } from 'lucide-react';

interface LightningAddressGateProps {
  children: React.ReactNode;
}

/**
 * Wraps children and only renders them once the logged-in user has a
 * Lightning address (lud16) on their Nostr profile. If they don't, it
 * shows a simple inline form to add one.
 */
export function LightningAddressGate({ children }: LightningAddressGateProps) {
  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey);
  const { mutateAsync: publishEvent, isPending } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [address, setAddress] = useState('');

  // Not logged in — let the parent handle auth
  if (!user) return <>{children}</>;

  // Still loading the profile — show a loading state instead of passing through
  if (author.isLoading) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-stone-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="font-mono">Checking profile...</span>
        </div>
      </div>
    );
  }

  const metadata = author.data?.metadata;
  const hasLightning = !!(metadata?.lud16 || metadata?.lud06);

  // If they already have a lightning address, render children normally
  if (hasLightning) return <>{children}</>;

  const handleSave = async () => {
    // Validate Lightning address format: user@domain.tld
    const lnAddressRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!lnAddressRegex.test(address.trim())) {
      toast({
        title: 'Invalid address',
        description: 'Enter a valid Lightning address (e.g. you@walletofsatoshi.com)',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Merge with existing metadata to avoid overwriting other fields
      const existing = metadata ?? {};
      await publishEvent({
        kind: 0,
        content: JSON.stringify({ ...existing, lud16: address.trim() }),
      });

      // Refresh profile cache
      queryClient.invalidateQueries({ queryKey: ['nostr', 'author', user.pubkey] });

      toast({ title: 'Lightning address saved!' });
    } catch (error) {
      toast({
        title: 'Failed to save',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6 py-12 text-center">
      <div className="relative inline-flex items-center justify-center">
        <div className="absolute w-16 h-16 bg-amber-500/10 rounded-full blur-xl animate-pulse" />
        <div className="relative w-14 h-14 bg-amber-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center">
          <Zap className="w-7 h-7 text-amber-400 fill-current" />
        </div>
      </div>

      <h2 className="text-xl font-mono font-bold text-stone-200">
        Add a Lightning Address
      </h2>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2.5 text-left">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-400/90 font-mono">
          To receive your winnings, you need a Lightning address on your Nostr profile.
          This is how the pot gets paid out to the winner automatically.
        </p>
      </div>

      <div className="space-y-3 text-left">
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="you@walletofsatoshi.com"
          className="bg-stone-800 border-stone-600 text-stone-200 font-mono placeholder:text-stone-600"
        />
        <p className="text-[10px] text-stone-500 font-mono">
          Common providers: Wallet of Satoshi, Alby, Primal, Strike, Cash App
        </p>
      </div>

      <Button
        onClick={handleSave}
        disabled={isPending || !address}
        className="w-full bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold py-5"
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Zap className="w-4 h-4 mr-2 fill-current" />
            Save & Continue
          </>
        )}
      </Button>
    </div>
  );
}
