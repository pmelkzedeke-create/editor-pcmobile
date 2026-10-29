import type { MotionBehavior, MotionBehaviorType } from '../types/editor';

export interface ExpressionContext {
  time: number; // global comp time (s)
  relTime: number; // clip local time (s)
  value: number; // evaluated keyframe value before expression
  duration: number; // clip duration (s)
  fps: number;
  index: number; // 1-based layer index
  audioLevel: number; // 0..1 normalized amplitude envelope
  seed: number; // deterministic seed per clip
}

// Deterministic smooth 1D gradient/value noise so expressions are 100% reproducible in RAM cache & Export
function hash1D(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return (s - Math.floor(s)) * 2 - 1;
}

export function smoothNoise1D(x: number, seed = 1): number {
  const xi = Math.floor(x);
  const xf = x - xi;
  const u = xf * xf * (3 - 2 * xf);
  const a = hash1D(xi + seed * 19.37);
  const b = hash1D(xi + 1 + seed * 19.37);
  return a + (b - a) * u;
}

export function wiggleValue(time: number, freq: number, amp: number, seed = 1): number {
  const f = Math.max(0.001, freq);
  return (
    (smoothNoise1D(time * f, seed) * 0.68 +
      smoothNoise1D(time * f * 2.13 + 7.4, seed + 3) * 0.32) *
    amp
  );
}

// ---------------- Safe Recursive-Descent Expression Lexer & Parser ----------------
type Token =
  | { kind: 'num'; val: number }
  | { kind: 'id'; val: string }
  | { kind: 'op'; val: string }
  | { kind: 'paren'; val: '(' | ')' }
  | { kind: 'comma' };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = source.length;
  if (len > 400) {
    throw new Error('Expressão muito longa (máximo de 400 caracteres).');
  }
  while (i < len) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let start = i;
      let dots = 0;
      while (i < len && /[0-9.]/.test(source[i])) {
        if (source[i] === '.') dots++;
        i++;
      }
      if (dots > 1) throw new Error(`Número inválido próximo a "${source.slice(start, i)}"`);
      const parsed = Number(source.slice(start, i));
      if (!Number.isFinite(parsed)) throw new Error('Literal numérico inválido.');
      tokens.push({ kind: 'num', val: parsed });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_.]/.test(source[i])) i++;
      tokens.push({ kind: 'id', val: source.slice(start, i) });
      continue;
    }
    if ('+-*/%'.includes(ch)) {
      tokens.push({ kind: 'op', val: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ kind: 'paren', val: ch });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' });
      i++;
      continue;
    }
    throw new Error(`Caractere não permitido na expressão: "${ch}"`);
  }
  return tokens;
}

class SafeParser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly ctx: ExpressionContext) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  parseExpression(): number {
    if (this.tokens.length === 0) return this.ctx.value;
    const result = this.parseAddSub();
    if (this.pos < this.tokens.length) {
      throw new Error(' Expressão incompleta ou parêntese inesperado.');
    }
    return result;
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    while (true) {
      const next = this.peek();
      if (!next || next.kind !== 'op' || (next.val !== '+' && next.val !== '-')) break;
      this.consume();
      const right = this.parseMulDiv();
      left = next.val === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parseUnary();
    while (true) {
      const next = this.peek();
      if (!next || next.kind !== 'op' || (next.val !== '*' && next.val !== '/' && next.val !== '%')) break;
      this.consume();
      const right = this.parseUnary();
      if (next.val === '*') left *= right;
      else if (next.val === '/') left = Math.abs(right) < 1e-9 ? 0 : left / right;
      else left = Math.abs(right) < 1e-9 ? 0 : left % right;
    }
    return left;
  }

  private parseUnary(): number {
    const tok = this.peek();
    if (tok?.kind === 'op' && (tok.val === '+' || tok.val === '-')) {
      this.consume();
      const val = this.parseUnary();
      return tok.val === '-' ? -val : val;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const tok = this.peek();
    if (!tok) throw new Error('Fim inesperado da expressão.');

    if (tok.kind === 'num') {
      this.consume();
      return tok.val;
    }

    if (tok.kind === 'paren' && tok.val === '(') {
      this.consume();
      const inner = this.parseAddSub();
      const close = this.peek();
      if (!close || close.kind !== 'paren' || close.val !== ')') {
        throw new Error('Falta fechar parêntese ")".');
      }
      this.consume();
      return inner;
    }

    if (tok.kind === 'id') {
      this.consume();
      const name = tok.val;
      if (this.peek()?.kind === 'paren' && (this.peek() as { val: string }).val === '(') {
        this.consume(); // '('
        const args: number[] = [];
        if (!(this.peek()?.kind === 'paren' && (this.peek() as { val: string }).val === ')')) {
          args.push(this.parseAddSub());
          while (this.peek()?.kind === 'comma') {
            this.consume();
            args.push(this.parseAddSub());
          }
        }
        const close = this.peek();
        if (!close || close.kind !== 'paren' || close.val !== ')') {
          throw new Error(`Falta ")" na função ${name}().`);
        }
        this.consume();
        return this.evalCall(name, args);
      }
      return this.evalIdentifier(name);
    }

    throw new Error('Sintaxe inválida na expressão.');
  }

  private evalIdentifier(name: string): number {
    switch (name) {
      case 'time':
        return this.ctx.time;
      case 'relTime':
      case 'localTime':
        return this.ctx.relTime;
      case 'value':
        return this.ctx.value;
      case 'duration':
        return this.ctx.duration;
      case 'fps':
        return this.ctx.fps;
      case 'index':
        return this.ctx.index;
      case 'audioLevel':
      case 'audio':
        return this.ctx.audioLevel;
      case 'PI':
      case 'Math.PI':
        return Math.PI;
      default:
        throw new Error(`Variável desconhecida: "${name}". Use value, time, relTime, audioLevel, duration, fps ou index.`);
    }
  }

  private evalCall(rawName: string, args: number[]): number {
    const name = rawName.startsWith('Math.') ? rawName.slice(5) : rawName;
    const t = this.ctx.relTime;
    switch (name) {
      case 'wiggle': {
        const freq = args[0] ?? 3;
        const amp = args[1] ?? 15;
        const seed = args[2] ?? this.ctx.seed;
        return this.ctx.value + wiggleValue(this.ctx.time, freq, amp, seed);
      }
      case 'oscillate':
      case 'wave': {
        const freq = args[0] ?? 1.5;
        const amp = args[1] ?? 20;
        const phase = args[2] ?? 0;
        return this.ctx.value + Math.sin(this.ctx.time * Math.PI * 2 * freq + phase) * amp;
      }
      case 'spring': {
        const amp = args[0] ?? -35;
        const decay = args[1] ?? 5.5;
        const freq = args[2] ?? 9;
        return this.ctx.value + amp * Math.exp(-Math.max(0, t) * decay) * Math.cos(Math.max(0, t) * freq);
      }
      case 'bounce': {
        const amp = args[0] ?? -40;
        const decay = args[1] ?? 4.5;
        const freq = args[2] ?? 7;
        return this.ctx.value + amp * Math.exp(-Math.max(0, t) * decay) * Math.abs(Math.cos(Math.max(0, t) * freq));
      }
      case 'overshoot': {
        const amp = args[0] ?? 24;
        const freq = args[1] ?? 7;
        const decay = args[2] ?? 5;
        return this.ctx.value - amp * Math.exp(-Math.max(0, t) * decay) * Math.sin(Math.max(0, t) * freq);
      }
      case 'snap': {
        const step = Math.max(0.0001, args[1] ?? args[0] ?? 1);
        const target = args.length >= 2 ? args[0] : this.ctx.value;
        return Math.round(target / step) * step;
      }
      case 'clamp':
        return Math.min(args[2] ?? 100, Math.max(args[1] ?? 0, args[0] ?? this.ctx.value));
      case 'linear': {
        const [x, t1, t2, v1, v2] = [args[0] ?? t, args[1] ?? 0, args[2] ?? 1, args[3] ?? 0, args[4] ?? 1];
        const u = Math.max(0, Math.min(1, (x - t1) / Math.max(1e-6, t2 - t1)));
        return v1 + (v2 - v1) * u;
      }
      case 'ease': {
        const [x, t1, t2, v1, v2] = [args[0] ?? t, args[1] ?? 0, args[2] ?? 1, args[3] ?? 0, args[4] ?? 1];
        const u = Math.max(0, Math.min(1, (x - t1) / Math.max(1e-6, t2 - t1)));
        const s = u * u * (3 - 2 * u);
        return v1 + (v2 - v1) * s;
      }
      case 'pingpong': {
        const period = Math.max(0.05, args[0] ?? 1);
        const amp = args[1] ?? 25;
        const cycle = (this.ctx.relTime / period) % 2;
        const tri = cycle <= 1 ? cycle : 2 - cycle;
        return this.ctx.value + (tri * 2 - 1) * amp;
      }
      case 'sin':
        return Math.sin(args[0] ?? 0);
      case 'cos':
        return Math.cos(args[0] ?? 0);
      case 'abs':
        return Math.abs(args[0] ?? 0);
      case 'sqrt':
        return Math.sqrt(Math.max(0, args[0] ?? 0));
      case 'pow':
        return Math.pow(args[0] ?? 0, args[1] ?? 1);
      case 'min':
        return Math.min(...(args.length ? args : [0]));
      case 'max':
        return Math.max(...(args.length ? args : [0]));
      case 'floor':
        return Math.floor(args[0] ?? 0);
      case 'ceil':
        return Math.ceil(args[0] ?? 0);
      case 'round':
        return Math.round(args[0] ?? 0);
      default:
        throw new Error(`Função não permitida: "${rawName}()". Use wiggle, oscillate, spring, bounce, overshoot, pingpong, linear, ease, clamp, snap, sin, cos.`);
    }
  }
}

export function evaluateSafeExpression(expr: string, ctx: ExpressionContext): { value: number; error: string | null } {
  try {
    const trimmed = expr.trim();
    if (!trimmed) return { value: ctx.value, error: null };
    const tokens = tokenize(trimmed);
    const parser = new SafeParser(tokens, ctx);
    const out = parser.parseExpression();
    if (!Number.isFinite(out)) return { value: ctx.value, error: 'Resultado numérico inválido (NaN/Infinito).' };
    return { value: out, error: null };
  } catch (err) {
    return {
      value: ctx.value,
      error: err instanceof Error ? err.message : 'Erro de sintaxe na expressão.',
    };
  }
}

export function validateSafeExpression(expr: string): string | null {
  return evaluateSafeExpression(expr, {
    time: 1,
    relTime: 0.5,
    value: 100,
    duration: 5,
    fps: 30,
    index: 1,
    audioLevel: 0.5,
    seed: 7,
  }).error;
}

// ---------------- Motion Stack Procedural Engine ----------------
export interface MotionBehaviorDefinition {
  type: MotionBehaviorType;
  label: string;
  description: string;
  defaultProperty: MotionBehavior['property'];
  defaults: Pick<MotionBehavior, 'intensity' | 'duration' | 'damping' | 'frequency' | 'delay'>;
}

export const MOTION_BEHAVIOR_DEFS: MotionBehaviorDefinition[] = [
  {
    type: 'spring-in',
    label: 'Spring Entrance',
    description: 'Entrada com mola física e amortecimento natural',
    defaultProperty: 'y',
    defaults: { intensity: 36, duration: 0.9, damping: 6, frequency: 9, delay: 0 },
  },
  {
    type: 'elastic-pop',
    label: 'Elastic Pop',
    description: ' Explosão elástica de escala ideal para títulos e ícones',
    defaultProperty: 'scale',
    defaults: { intensity: 45, duration: 0.85, damping: 5, frequency: 11, delay: 0 },
  },
  {
    type: 'bounce-drop',
    label: 'Bounce Drop',
    description: 'Queda com quique realista na base',
    defaultProperty: 'y',
    defaults: { intensity: -42, duration: 0.95, damping: 4.5, frequency: 7.5, delay: 0 },
  },
  {
    type: 'overshoot-in',
    label: 'Overshoot Slide',
    description: 'Deslize rápido que ultrapassa o alvo e assenta suave',
    defaultProperty: 'x',
    defaults: { intensity: -48, duration: 0.75, damping: 5.5, frequency: 6.5, delay: 0 },
  },
  {
    type: 'wiggle',
    label: 'Wiggle Orgânico',
    description: 'Oscilação contínua controlada por frequência e seed',
    defaultProperty: 'rotation',
    defaults: { intensity: 6, duration: 5, damping: 1, frequency: 2.5, delay: 0 },
  },
  {
    type: 'squash-stretch',
    label: 'Squash & Stretch',
    description: 'Compressão e estiramento elástico no início do movimento',
    defaultProperty: 'scaleY',
    defaults: { intensity: 28, duration: 0.7, damping: 6, frequency: 10, delay: 0 },
  },
  {
    type: 'shake',
    label: 'Impact Shake',
    description: 'Vibração de impacto de câmera que dissipa suavemente',
    defaultProperty: 'x',
    defaults: { intensity: 14, duration: 0.55, damping: 7, frequency: 18, delay: 0 },
  },
  {
    type: 'recoil',
    label: 'Recoil Kickback',
    description: 'Recuo súbito com retorno amortecido',
    defaultProperty: 'scale',
    defaults: { intensity: 22, duration: 0.5, damping: 8, frequency: 8, delay: 0 },
  },
  {
    type: 'audio-pulse',
    label: 'Reativo ao Áudio',
    description: 'Impulsiona a propriedade conforme os picos da trilha sonora',
    defaultProperty: 'scale',
    defaults: { intensity: 26, duration: 5, damping: 4, frequency: 1, delay: 0 },
  },
  {
    type: 'smooth-drift',
    label: 'Flutuação Suave',
    description: 'Movimento senoidal contínuo de cinema',
    defaultProperty: 'y',
    defaults: { intensity: 4, duration: 5, damping: 1, frequency: 0.5, delay: 0 },
  },
];

export function evaluateMotionBehaviorDelta(
  behavior: MotionBehavior,
  relTime: number,
  audioLevel: number,
  seed: number
): number {
  if (!behavior.enabled) return 0;
  const t = relTime - (behavior.delay || 0);
  const amp = behavior.intensity;
  const damp = Math.max(0.5, behavior.damping || 5);
  const freq = Math.max(0.1, behavior.frequency || 4);

  switch (behavior.type) {
    case 'spring-in': {
      if (t < 0) return amp;
      return amp * Math.exp(-t * damp) * Math.cos(t * freq);
    }
    case 'elastic-pop': {
      if (t < 0) return -amp;
      return -amp * Math.exp(-t * damp) * Math.cos(t * freq);
    }
    case 'bounce-drop': {
      if (t < 0) return amp;
      return amp * Math.exp(-t * damp) * Math.abs(Math.cos(t * freq));
    }
    case 'overshoot-in': {
      if (t < 0) return amp;
      return amp * Math.exp(-t * damp) * (Math.cos(t * freq) - 0.35 * Math.sin(t * freq));
    }
    case 'squash-stretch': {
      if (t < 0) return 0;
      return amp * Math.exp(-t * damp) * Math.sin(t * freq * 1.4);
    }
    case 'shake': {
      if (t < 0) return 0;
      return amp * Math.exp(-t * damp) * Math.sin(t * freq * Math.PI * 2);
    }
    case 'recoil': {
      if (t < 0) return 0;
      const rise = Math.min(1, t / 0.06);
      return amp * rise * Math.exp(-t * damp);
    }
    case 'wiggle':
      return wiggleValue(Math.max(0, t), freq, amp, behavior.seed ?? seed);
    case 'audio-pulse':
      return amp * Math.max(0, audioLevel);
    case 'smooth-drift':
      return amp * Math.sin(Math.max(0, t) * Math.PI * 2 * freq);
    default:
      return 0;
  }
}
