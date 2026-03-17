import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space } from 'lucide-react';

interface GameControlsProps {
  onMove: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSwing: () => void;
  disabled?: boolean;
}

export function GameControls({ onMove, onSwing, disabled }: GameControlsProps) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <p className="text-xs text-amber-400/60 font-mono uppercase tracking-wider mb-1">
        Keyboard: Arrows + Space
      </p>
      
      {/* D-pad style mobile controls */}
      <div className="grid grid-cols-3 gap-1">
        <div />
        <button
          onPointerDown={() => !disabled && onMove('up')}
          disabled={disabled}
          className="w-12 h-12 bg-stone-800/80 border border-stone-600/50 rounded-lg flex items-center justify-center text-stone-300 active:bg-stone-700 active:scale-95 transition-all disabled:opacity-30 hover:bg-stone-700/80"
          aria-label="Move up"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
        <div />
        
        <button
          onPointerDown={() => !disabled && onMove('left')}
          disabled={disabled}
          className="w-12 h-12 bg-stone-800/80 border border-stone-600/50 rounded-lg flex items-center justify-center text-stone-300 active:bg-stone-700 active:scale-95 transition-all disabled:opacity-30 hover:bg-stone-700/80"
          aria-label="Move left"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <button
          onPointerDown={() => !disabled && onMove('down')}
          disabled={disabled}
          className="w-12 h-12 bg-stone-800/80 border border-stone-600/50 rounded-lg flex items-center justify-center text-stone-300 active:bg-stone-700 active:scale-95 transition-all disabled:opacity-30 hover:bg-stone-700/80"
          aria-label="Move down"
        >
          <ArrowDown className="w-5 h-5" />
        </button>
        
        <button
          onPointerDown={() => !disabled && onMove('right')}
          disabled={disabled}
          className="w-12 h-12 bg-stone-800/80 border border-stone-600/50 rounded-lg flex items-center justify-center text-stone-300 active:bg-stone-700 active:scale-95 transition-all disabled:opacity-30 hover:bg-stone-700/80"
          aria-label="Move right"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Swing button */}
      <button
        onPointerDown={() => !disabled && onSwing()}
        disabled={disabled}
        className="mt-1 px-8 py-3 bg-amber-600/80 border border-amber-500/50 rounded-xl text-amber-100 font-mono text-sm active:bg-amber-500 active:scale-95 transition-all disabled:opacity-30 hover:bg-amber-500/80 flex items-center gap-2"
        aria-label="Swing axe"
      >
        <Space className="w-4 h-4" />
        <span>⛏️ MINE</span>
      </button>
    </div>
  );
}
