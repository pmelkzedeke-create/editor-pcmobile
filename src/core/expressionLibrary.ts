export interface ExpressionPreset {
  id: string;
  name: string;
  category: 'Movimento' | 'Áudio' | 'Utilidade' | 'Física';
  code: string;
  description: string;
  exampleTarget: string;
}

export const EXPRESSION_LIBRARY: ExpressionPreset[] = [
  {
    id: 'wiggle-subtle',
    name: 'Wiggle Sutil',
    category: 'Movimento',
    code: 'wiggle(2, 8)',
    description: 'Oscilação orgânica suave. Argumentos: frequência (Hz), amplitude, seed opcional.',
    exampleTarget: 'rotation, x, y',
  },
  {
    id: 'wiggle-strong',
    name: 'Wiggle Intenso',
    category: 'Movimento',
    code: 'wiggle(5, 25)',
    description: 'Vibração energética para shakes e impactos.',
    exampleTarget: 'x, y, rotation',
  },
  {
    id: 'oscillate-loop',
    name: 'Oscilação em Loop',
    category: 'Movimento',
    code: 'oscillate(1, 20)',
    description: 'Senoide perfeita: frequência, amplitude e fase opcional.',
    exampleTarget: 'y, scale, opacity',
  },
  {
    id: 'spring-entrance',
    name: 'Entrada com Mola',
    category: 'Física',
    code: 'spring(-40, 5, 9)',
    description: 'Parte deslocado e assenta com mola amortecida. Argumentos: amplitude, decay, frequência.',
    exampleTarget: 'x, y, scale',
  },
  {
    id: 'bounce-drop',
    name: 'Queda com Quique',
    category: 'Física',
    code: 'bounce(-50, 4.5, 7)',
    description: 'Queda gravitacional com quiques decrescentes.',
    exampleTarget: 'y',
  },
  {
    id: 'overshoot-settle',
    name: 'Ultrapassagem Suave',
    category: 'Física',
    code: 'overshoot(24, 7, 5)',
    description: 'Ultrapassa o alvo e retorna com amortecimento.',
    exampleTarget: 'scale, rotation',
  },
  {
    id: 'pingpong-drift',
    name: 'Ping-Pong Contínuo',
    category: 'Movimento',
    code: 'pingpong(2, 15)',
    description: 'Vai e volta em triângulo: período (s) e amplitude.',
    exampleTarget: 'x, rotationX',
  },
  {
    id: 'audio-pulse',
    name: 'Pulso no Beat',
    category: 'Áudio',
    code: 'value + audioLevel * 30',
    description: 'Reage à energia do áudio (0..1). Combine com escala ou opacidade.',
    exampleTarget: 'scale, opacity',
  },
  {
    id: 'audio-gate',
    name: 'Gate por Áudio',
    category: 'Áudio',
    code: 'value + clamp((audioLevel - 0.4) * 80, 0, 40)',
    description: 'Só reage quando o áudio passa do limiar 0.4.',
    exampleTarget: 'scale, y',
  },
  {
    id: 'time-ramp',
    name: 'Rampa Temporal',
    category: 'Utilidade',
    code: 'linear(relTime, 0, 2, value - 30, value + 30)',
    description: 'Interpola entre dois valores ao longo de 2s do clipe.',
    exampleTarget: 'x, rotation, opacity',
  },
  {
    id: 'ease-in-out-range',
    name: 'Ease por Intervalo',
    category: 'Utilidade',
    code: 'ease(relTime, 0, 1.5, value, value + 60)',
    description: 'Curva suave S entre dois instantes do clipe.',
    exampleTarget: 'x, y, scale',
  },
  {
    id: 'snap-steps',
    name: 'Degraus (Stop Motion)',
    category: 'Utilidade',
    code: 'snap(value + relTime * 20, 10)',
    description: 'Quantiza o movimento em degraus de 10 unidades.',
    exampleTarget: 'rotation, x',
  },
  {
    id: 'posterize-stopmotion',
    name: 'Posterize Time (12 fps)',
    category: 'Utilidade',
    code: 'posterizeTime(12, 25)',
    description: 'Amostra o tempo em 12 quadros/seg para estética spider-verse / stop-motion.',
    exampleTarget: 'rotation, x, y',
  },
  {
    id: 'conditional-gate',
    name: 'Condicional (if)',
    category: 'Utilidade',
    code: 'if(audioLevel > 0.35, value + 25, value)',
    description: 'Expressão condicional baseada em comparação (> , < , ==).',
    exampleTarget: 'scale, opacity',
  },
  {
    id: 'loop-out-cycle',
    name: 'LoopOut Cíclico',
    category: 'Movimento',
    code: 'loopOut(1.5, 45)',
    description: 'Repete rampa contínua a cada 1.5s.',
    exampleTarget: 'rotation, x',
  },
];
