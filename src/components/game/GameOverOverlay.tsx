import { useState, useEffect, useRef } from 'react';
import { Trophy, Zap, Loader2, Skull } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { playWinSound, playLoseSound, playBitcoinFoundSound } from '@/lib/sounds';

const WINNER_MESSAGES = [
  'YOU FOUND THE BITCOIN!',
  'STRIKE IT RICH!',
  'DIAMOND HANDS PAID OFF!',
  'SATOSHI WOULD BE PROUD!',
  'TO THE MOON!',
];

const LOSER_MESSAGES = [
  'Better luck next time, miner.',
  'The sats weren\'t meant to be...',
  'Back to the mines with you!',
  'Someone else got the goods.',
  'You fought hard, but came up short.',
  'The Bitcoin slipped through your pickaxe.',
  'Not every mine has gold.',
  'Dust yourself off and try again!',
  'Almost had it... almost.',
  'The other miner was just faster.',
];

interface GameOverOverlayProps {
  isWinner: boolean;
  isLoser: boolean;
  totalPot: number;
  isPayingOut: boolean;
  payoutComplete: boolean;
  onBack: () => void;
}

/** Floating particle for the celebration effect */
interface CelebrationParticle {
  id: number;
  x: number;
  y: number;
  emoji: string;
  size: number;
  duration: number;
  delay: number;
}

function WinnerOverlay({ totalPot, isPayingOut, payoutComplete, onBack }: {
  totalPot: number;
  isPayingOut: boolean;
  payoutComplete: boolean;
  onBack: () => void;
}) {
  const [message] = useState(() => WINNER_MESSAGES[Math.floor(Math.random() * WINNER_MESSAGES.length)]);
  const [particles, setParticles] = useState<CelebrationParticle[]>([]);
  const [showContent, setShowContent] = useState(false);
  const [satsCountUp, setSatsCountUp] = useState(0);
  const soundPlayed = useRef(false);

  // Sound effect
  useEffect(() => {
    if (!soundPlayed.current) {
      soundPlayed.current = true;
      playBitcoinFoundSound();
      setTimeout(() => playWinSound(), 400);
    }
  }, []);

  // Generate celebration particles
  useEffect(() => {
    const emojis = ['₿', '⚡', '🪙', '✨', '💰', '🎉', '🏆', '⭐'];
    const newParticles: CelebrationParticle[] = [];
    for (let i = 0; i < 40; i++) {
      newParticles.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        emoji: emojis[i % emojis.length],
        size: 16 + Math.random() * 24,
        duration: 2 + Math.random() * 3,
        delay: Math.random() * 2,
      });
    }
    setParticles(newParticles);
  }, []);

  // Staggered reveal
  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 300);
    return () => clearTimeout(timer);
  }, []);

  // Count up sats animation
  useEffect(() => {
    if (!showContent) return;
    const duration = 1500;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setSatsCountUp(Math.floor(eased * totalPot));
      if (progress >= 1) clearInterval(interval);
    }, 16);
    return () => clearInterval(interval);
  }, [showContent, totalPot]);

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {/* Animated radial background */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="absolute inset-0 bg-gradient-radial from-amber-500/20 via-transparent to-transparent animate-pulse" />

      {/* Celebration particles */}
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute pointer-events-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            fontSize: `${p.size}px`,
            animation: `float-up ${p.duration}s ease-out ${p.delay}s both`,
            opacity: 0,
          }}
        >
          {p.emoji}
        </div>
      ))}

      {/* Lightning bolts in corners */}
      <div className="absolute top-4 left-4 text-amber-400/40 animate-pulse">
        <Zap className="w-12 h-12 fill-current" style={{ animationDelay: '0.2s' }} />
      </div>
      <div className="absolute top-4 right-4 text-amber-400/40 animate-pulse">
        <Zap className="w-12 h-12 fill-current" style={{ animationDelay: '0.7s' }} />
      </div>
      <div className="absolute bottom-4 left-4 text-amber-400/40 animate-pulse">
        <Zap className="w-12 h-12 fill-current" style={{ animationDelay: '0.4s' }} />
      </div>
      <div className="absolute bottom-4 right-4 text-amber-400/40 animate-pulse">
        <Zap className="w-12 h-12 fill-current" style={{ animationDelay: '0.9s' }} />
      </div>

      {/* Main content */}
      <div className={`relative z-10 text-center space-y-5 transition-all duration-700 ${showContent ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
        {/* Trophy with glow */}
        <div className="relative inline-block">
          <div className="absolute inset-0 w-24 h-24 mx-auto bg-amber-400/30 rounded-full blur-2xl animate-pulse" />
          <div className="absolute inset-0 w-32 h-32 -mt-4 mx-auto bg-amber-500/10 rounded-full blur-3xl animate-ping" style={{ animationDuration: '2s' }} />
          <Trophy className="relative w-20 h-20 text-amber-400 mx-auto drop-shadow-[0_0_30px_rgba(245,158,11,0.5)]" style={{ animation: 'winner-bounce 0.6s ease-in-out infinite alternate' }} />
        </div>

        {/* Title */}
        <h2 className="text-3xl font-bold font-mono" style={{
          background: 'linear-gradient(to right, #f59e0b, #fbbf24, #f59e0b)',
          backgroundSize: '200% auto',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          animation: 'shimmer 2s linear infinite',
        }}>
          {message}
        </h2>

        {/* Sats counter */}
        <div className="flex items-center justify-center gap-2">
          <Zap className="w-6 h-6 text-amber-400 fill-current" />
          <span className="text-4xl font-mono font-black text-amber-400 tabular-nums">
            {satsCountUp.toLocaleString()}
          </span>
          <span className="text-lg text-amber-300/70 font-mono">sats</span>
        </div>

        {/* Payout status */}
        <div className="h-8 flex items-center justify-center">
          {isPayingOut ? (
            <div className="flex items-center gap-2 text-amber-300/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs font-mono">Sending sats to your wallet...</span>
            </div>
          ) : payoutComplete ? (
            <div className="flex items-center gap-2 text-emerald-400">
              <Zap className="w-4 h-4 fill-current" />
              <span className="text-sm font-mono font-bold">Payout sent to your Lightning wallet!</span>
            </div>
          ) : null}
        </div>

        <Button
          onClick={onBack}
          className="bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold text-base px-8 py-5 rounded-xl shadow-lg shadow-amber-900/30 hover:shadow-amber-900/50 transition-all hover:scale-105 mt-2"
        >
          Play Again
        </Button>
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes float-up {
          0% { opacity: 0; transform: translateY(30px) scale(0.5) rotate(0deg); }
          20% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-200px) scale(1.2) rotate(360deg); }
        }
        @keyframes winner-bounce {
          0% { transform: translateY(0) rotate(-5deg); }
          100% { transform: translateY(-12px) rotate(5deg); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
      `}</style>
    </div>
  );
}

function LoserOverlay({ onBack }: { onBack: () => void }) {
  const [message] = useState(() => LOSER_MESSAGES[Math.floor(Math.random() * LOSER_MESSAGES.length)]);
  const [showContent, setShowContent] = useState(false);
  const [glitchText, setGlitchText] = useState('GAME OVER');
  const soundPlayed = useRef(false);

  useEffect(() => {
    if (!soundPlayed.current) {
      soundPlayed.current = true;
      playLoseSound();
    }
  }, []);

  // Staggered reveal
  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Glitch effect on "GAME OVER" text
  useEffect(() => {
    const chars = 'GAME OVER';
    const glitchChars = '!@#$%^&*_+-=<>?';
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (count > 15) {
        setGlitchText('GAME OVER');
        clearInterval(interval);
        return;
      }
      const glitched = chars.split('').map((c, i) =>
        c === ' ' ? ' ' : (Math.random() < 0.3 + count * 0.04 ? c : glitchChars[Math.floor(Math.random() * glitchChars.length)])
      ).join('');
      setGlitchText(glitched);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {/* Dark moody background */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="absolute inset-0 bg-gradient-radial from-red-900/10 via-transparent to-transparent" />

      {/* Falling dust particles */}
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 bg-stone-500/40 rounded-full"
          style={{
            left: `${(i * 5.3) % 100}%`,
            animation: `dust-fall ${3 + (i % 3)}s linear ${i * 0.2}s infinite`,
          }}
        />
      ))}

      {/* Main content */}
      <div className={`relative z-10 text-center space-y-5 transition-all duration-500 ${showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        {/* Skull with red glow */}
        <div className="relative inline-block">
          <div className="absolute inset-0 w-20 h-20 mx-auto bg-red-500/10 rounded-full blur-2xl" />
          <Skull className="relative w-16 h-16 text-stone-400 mx-auto" style={{ animation: 'skull-shake 0.5s ease-in-out 0.5s' }} />
        </div>

        {/* Glitch title */}
        <h2 className="text-3xl font-bold text-stone-300 font-mono tracking-wider">
          {glitchText}
        </h2>

        {/* Random message */}
        <p className="text-base text-stone-500 font-mono max-w-xs mx-auto leading-relaxed">
          {message}
        </p>

        {/* Motivational */}
        <p className="text-xs text-stone-600 font-mono">
          The mines always have more Bitcoin...
        </p>

        <Button
          onClick={onBack}
          className="bg-stone-700 hover:bg-stone-600 text-stone-200 font-mono font-bold text-base px-8 py-5 rounded-xl transition-all hover:scale-105 mt-2"
        >
          Try Again
        </Button>
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes dust-fall {
          0% { top: -5%; opacity: 0; }
          10% { opacity: 0.6; }
          90% { opacity: 0.3; }
          100% { top: 105%; opacity: 0; }
        }
        @keyframes skull-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px) rotate(-5deg); }
          40% { transform: translateX(8px) rotate(5deg); }
          60% { transform: translateX(-4px) rotate(-2deg); }
          80% { transform: translateX(4px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
}

export function GameOverOverlay({ isWinner, isLoser, totalPot, isPayingOut, payoutComplete, onBack }: GameOverOverlayProps) {
  if (isWinner) {
    return <WinnerOverlay totalPot={totalPot} isPayingOut={isPayingOut} payoutComplete={payoutComplete} onBack={onBack} />;
  }

  if (isLoser) {
    return <LoserOverlay onBack={onBack} />;
  }

  // Generic game over (observer)
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="text-center space-y-4 animate-in fade-in zoom-in duration-500">
        <Trophy className="w-12 h-12 text-amber-400 mx-auto" />
        <h2 className="text-xl font-bold text-stone-300 font-mono">GAME OVER</h2>
        <Button onClick={onBack} className="bg-amber-600 hover:bg-amber-500 text-black font-mono font-bold mt-4">
          Back to Lobby
        </Button>
      </div>
    </div>
  );
}
