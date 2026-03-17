import { useRef, useEffect, useCallback } from 'react';
import type { GameState, Cell, PlayerState } from '@/lib/gameEngine';
import { GRID_WIDTH, GRID_HEIGHT, CELL_SIZE } from '@/lib/gameEngine';

interface GameCanvasProps {
  gameState: GameState;
  currentPubkey: string | undefined;
  className?: string;
}

// Color palette
const COLORS = {
  surface: '#4a7c59',       // green grass
  surfaceGrass: '#5a9c69',  // lighter grass detail
  sky: '#1a1a2e',           // dark night sky
  rock: '#6b7280',          // gray
  rockDetail: '#4b5563',    // darker gray
  hardRock: '#78350f',      // brown
  hardRockDetail: '#92400e',
  bedrock: '#1f2937',       // very dark
  bedrockDetail: '#111827',
  empty: '#292524',         // dark underground
  bitcoin: '#f59e0b',       // gold
  bitcoinGlow: '#fbbf24',
  gridLine: 'rgba(255,255,255,0.03)',
};

function drawCell(ctx: CanvasRenderingContext2D, cell: Cell, x: number, y: number) {
  const px = x * CELL_SIZE;
  const py = y * CELL_SIZE;

  switch (cell.type) {
    case 'surface':
      // Sky background
      ctx.fillStyle = COLORS.sky;
      ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
      
      // Stars
      if (y === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        const starSeed = x * 7 + y * 13;
        for (let i = 0; i < 2; i++) {
          const sx = px + ((starSeed * (i + 1) * 17) % CELL_SIZE);
          const sy = py + ((starSeed * (i + 1) * 23) % CELL_SIZE);
          ctx.fillRect(sx, sy, 1, 1);
        }
      }
      
      // Grass on bottom of surface row closest to underground
      if (y === 1) {
        ctx.fillStyle = COLORS.surface;
        ctx.fillRect(px, py + CELL_SIZE - 8, CELL_SIZE, 8);
        // Grass blades
        ctx.fillStyle = COLORS.surfaceGrass;
        for (let i = 0; i < 4; i++) {
          const bladeX = px + 4 + i * 10;
          ctx.fillRect(bladeX, py + CELL_SIZE - 12, 2, 6);
        }
      }
      break;

    case 'rock':
      ctx.fillStyle = COLORS.rock;
      ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
      // Rock texture
      ctx.fillStyle = COLORS.rockDetail;
      ctx.fillRect(px + 2, py + 2, 12, 8);
      ctx.fillRect(px + 20, py + 14, 16, 10);
      ctx.fillRect(px + 6, py + 26, 14, 10);
      // Cracks
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py + CELL_SIZE / 2);
      ctx.lineTo(px + CELL_SIZE / 3, py + CELL_SIZE / 2 + 4);
      ctx.stroke();
      break;

    case 'hard_rock': {
      ctx.fillStyle = COLORS.hardRock;
      ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
      // Texture
      ctx.fillStyle = COLORS.hardRockDetail;
      ctx.fillRect(px + 4, py + 4, 14, 12);
      ctx.fillRect(px + 22, py + 20, 12, 14);
      // Gems / crystals
      ctx.fillStyle = '#a855f7';
      ctx.fillRect(px + 28, py + 6, 4, 4);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(px + 10, py + 28, 3, 3);
      // Health indicator
      const hp = cell.health;
      if (hp < 3) {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 5, py + 5);
        ctx.lineTo(px + CELL_SIZE - 5, py + CELL_SIZE - 5);
        ctx.stroke();
        if (hp < 2) {
          ctx.beginPath();
          ctx.moveTo(px + CELL_SIZE - 5, py + 5);
          ctx.lineTo(px + 5, py + CELL_SIZE - 5);
          ctx.stroke();
        }
      }
      break;
    }

    case 'bitcoin':
      // Show as rock (hidden) unless revealed
      if (!cell.revealed) {
        ctx.fillStyle = COLORS.rock;
        ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
        ctx.fillStyle = COLORS.rockDetail;
        ctx.fillRect(px + 2, py + 2, 12, 8);
        ctx.fillRect(px + 20, py + 14, 16, 10);
      } else {
        // Revealed bitcoin
        ctx.fillStyle = COLORS.empty;
        ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
        drawBitcoinSymbol(ctx, px + CELL_SIZE / 2, py + CELL_SIZE / 2, 14);
      }
      break;

    case 'bedrock':
      ctx.fillStyle = COLORS.bedrock;
      ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
      ctx.fillStyle = COLORS.bedrockDetail;
      ctx.fillRect(px + 2, py + 2, 8, 6);
      ctx.fillRect(px + 16, py + 10, 10, 8);
      ctx.fillRect(px + 6, py + 24, 12, 8);
      ctx.fillRect(px + 26, py + 28, 8, 6);
      break;

    case 'empty':
      ctx.fillStyle = COLORS.empty;
      ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
      // Subtle ambient particles
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(px + 12, py + 8, 2, 2);
      ctx.fillRect(px + 28, py + 24, 2, 2);
      break;
  }

  // Grid lines
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
}

function drawBitcoinSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  // Glow
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2);
  gradient.addColorStop(0, 'rgba(245, 158, 11, 0.4)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2, 0, Math.PI * 2);
  ctx.fill();

  // Circle
  ctx.fillStyle = COLORS.bitcoin;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // "₿" symbol
  ctx.fillStyle = '#1a1a2e';
  ctx.font = `bold ${radius}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₿', cx, cy + 1);
}

function drawPlayer(ctx: CanvasRenderingContext2D, player: PlayerState, isCurrent: boolean, time: number) {
  const px = player.x * CELL_SIZE;
  const py = player.y * CELL_SIZE;
  const cx = px + CELL_SIZE / 2;
  const cy = py + CELL_SIZE / 2;

  // Player glow for current player
  if (isCurrent) {
    const glowRadius = 24 + Math.sin(time * 3) * 4;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    gradient.addColorStop(0, `${player.color}40`);
    gradient.addColorStop(1, `${player.color}00`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body
  ctx.fillStyle = player.color;
  // Head
  ctx.beginPath();
  ctx.arc(cx, cy - 8, 7, 0, Math.PI * 2);
  ctx.fill();

  // Hard hat
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(cx - 8, cy - 16, 16, 4);
  ctx.fillRect(cx - 6, cy - 19, 12, 4);

  // Body
  ctx.fillStyle = player.color;
  ctx.fillRect(cx - 5, cy - 1, 10, 12);

  // Legs (simple)
  ctx.fillRect(cx - 5, cy + 11, 4, 6);
  ctx.fillRect(cx + 1, cy + 11, 4, 6);

  // Boots
  ctx.fillStyle = '#78350f';
  ctx.fillRect(cx - 6, cy + 15, 5, 4);
  ctx.fillRect(cx + 1, cy + 15, 5, 4);

  // Eyes
  ctx.fillStyle = '#fff';
  const eyeOffsetX = player.direction === 'left' ? -2 : player.direction === 'right' ? 2 : 0;
  ctx.fillRect(cx - 3 + eyeOffsetX, cy - 10, 2, 2);
  ctx.fillRect(cx + 1 + eyeOffsetX, cy - 10, 2, 2);

  // Axe
  drawAxe(ctx, player, cx, cy, time);

  // Name label
  if (isCurrent) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(cx - 16, cy - 28, 32, 10);
    ctx.fillStyle = '#fff';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YOU', cx, cy - 23);
  }
}

function drawAxe(ctx: CanvasRenderingContext2D, player: PlayerState, cx: number, cy: number, time: number) {
  ctx.save();
  ctx.translate(cx, cy);

  let angle = 0;
  let axeX = 0;
  let axeY = 0;

  // Swing animation
  if (player.isSwinging) {
    const swingProgress = Math.min(player.swingFrame / 6, 1);
    const swingAngle = Math.sin(swingProgress * Math.PI) * 1.2;

    switch (player.direction) {
      case 'right':
        angle = -0.3 + swingAngle;
        axeX = 10;
        axeY = -4;
        break;
      case 'left':
        angle = 0.3 - swingAngle;
        axeX = -10;
        axeY = -4;
        break;
      case 'down':
        angle = swingAngle;
        axeX = 8;
        axeY = 4;
        break;
      case 'up':
        angle = -swingAngle;
        axeX = 8;
        axeY = -10;
        break;
    }
  } else {
    // Idle bobbing
    const bob = Math.sin(time * 2) * 0.1;
    switch (player.direction) {
      case 'right':
        angle = -0.3 + bob;
        axeX = 10;
        axeY = -4;
        break;
      case 'left':
        angle = 0.3 - bob;
        axeX = -10;
        axeY = -4;
        break;
      case 'down':
        angle = bob;
        axeX = 8;
        axeY = 4;
        break;
      case 'up':
        angle = -bob;
        axeX = 8;
        axeY = -10;
        break;
    }
  }

  ctx.translate(axeX, axeY);
  ctx.rotate(angle);

  // Handle
  ctx.fillStyle = '#92400e';
  ctx.fillRect(-1, -12, 3, 16);

  // Axe head
  ctx.fillStyle = '#9ca3af';
  ctx.beginPath();
  ctx.moveTo(-1, -12);
  ctx.lineTo(8, -8);
  ctx.lineTo(8, -4);
  ctx.lineTo(-1, -4);
  ctx.closePath();
  ctx.fill();

  // Shine
  ctx.fillStyle = '#d1d5db';
  ctx.fillRect(2, -10, 3, 2);

  ctx.restore();
}

// Particle system for mining effects
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

let particles: Particle[] = [];

export function addMiningParticles(cellX: number, cellY: number, destroyed: boolean, isBitcoin: boolean) {
  const px = cellX * CELL_SIZE + CELL_SIZE / 2;
  const py = cellY * CELL_SIZE + CELL_SIZE / 2;
  const count = destroyed ? (isBitcoin ? 30 : 15) : 6;
  const colors = isBitcoin
    ? ['#f59e0b', '#fbbf24', '#fcd34d', '#fffbeb']
    : ['#6b7280', '#9ca3af', '#4b5563', '#d1d5db'];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    particles.push({
      x: px + (Math.random() - 0.5) * 10,
      y: py + (Math.random() - 0.5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      life: 30 + Math.random() * 20,
      maxLife: 50,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 2 + Math.random() * 3,
    });
  }
}

function updateAndDrawParticles(ctx: CanvasRenderingContext2D) {
  particles = particles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1; // gravity
    p.life--;
    p.vx *= 0.98;

    const alpha = p.life / p.maxLife;
    ctx.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size * alpha, p.size * alpha);

    return p.life > 0;
  });
}

export function GameCanvas({ gameState, currentPubkey, className }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        drawCell(ctx, gameState.grid[y][x], x, y);
      }
    }

    // Draw particles
    updateAndDrawParticles(ctx);

    // Draw other players first (below current)
    const timeSeconds = time / 1000;
    gameState.players.forEach((player) => {
      if (player.pubkey !== currentPubkey) {
        drawPlayer(ctx, player, false, timeSeconds);
      }
    });

    // Draw current player on top
    if (currentPubkey) {
      const currentPlayer = gameState.players.get(currentPubkey);
      if (currentPlayer) {
        drawPlayer(ctx, currentPlayer, true, timeSeconds);
      }
    }

    // Winner celebration overlay
    if (gameState.winner) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Bitcoin found indicator
      const btcX = gameState.bitcoinX * CELL_SIZE + CELL_SIZE / 2;
      const btcY = gameState.bitcoinY * CELL_SIZE + CELL_SIZE / 2;
      const pulseRadius = 20 + Math.sin(timeSeconds * 5) * 8;
      const glow = ctx.createRadialGradient(btcX, btcY, 0, btcX, btcY, pulseRadius);
      glow.addColorStop(0, 'rgba(245, 158, 11, 0.8)');
      glow.addColorStop(1, 'rgba(245, 158, 11, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(btcX, btcY, pulseRadius, 0, Math.PI * 2);
      ctx.fill();

      drawBitcoinSymbol(ctx, btcX, btcY, 16);
    }

    animationRef.current = requestAnimationFrame(draw);
  }, [gameState, currentPubkey]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [draw]);

  const width = GRID_WIDTH * CELL_SIZE;
  const height = GRID_HEIGHT * CELL_SIZE;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{
        imageRendering: 'pixelated',
        width: '100%',
        maxWidth: `${width}px`,
        height: 'auto',
        aspectRatio: `${width}/${height}`,
      }}
    />
  );
}
