import type { SavedMotionPreset } from '../types/editor';

export const BUILTIN_MOTION_PRESETS: SavedMotionPreset[] = [
  {
    id: 'mp-intro-spring',
    name: 'Hero Spring Intro',
    category: 'Intro',
    description: 'Entrada de mola vertical com fade suave para cenas e logos',
    version: '1.0',
    favorite: true,
    gradient: 'from-blue-600 to-cyan-400',
    patch: {
      motionBehaviors: [
        { type: 'spring-in', enabled: true, property: 'y', intensity: 40, duration: 0.9, damping: 5.5, frequency: 9, delay: 0 },
      ],
      keyframes: [
        {
          property: 'opacity',
          keyframes: [
            { id: 'k1', time: 0, value: 0, easing: 'ease-out' },
            { id: 'k2', time: 0.45, value: 100, easing: 'linear' },
          ],
        },
      ],
    },
  },
  {
    id: 'mp-outro-zoom',
    name: 'Fade & Scale Outro',
    category: 'Outro',
    description: 'Encerramento suave reduzindo escala e opacidade',
    version: '1.0',
    gradient: 'from-slate-700 to-indigo-600',
    patch: {
      transitionOut: 'dissolve',
      keyframes: [
        {
          property: 'scale',
          keyframes: [
            { id: 'k1', time: 0, value: 100, easing: 'cinematic' },
            { id: 'k2', time: 2.5, value: 90, easing: 'linear' },
          ],
        },
      ],
    },
  },
  {
    id: 'mp-logo-elastic',
    name: 'Logo Elastic Pop',
    category: 'Logo Animation',
    description: 'Revelação de marca com elasticidade calibrada e leve rotação',
    version: '1.0',
    favorite: true,
    gradient: 'from-violet-600 to-fuchsia-500',
    patch: {
      motionBehaviors: [
        { type: 'elastic-pop', enabled: true, property: 'scale', intensity: 52, duration: 0.9, damping: 5, frequency: 11, delay: 0 },
        { type: 'spring-in', enabled: true, property: 'rotation', intensity: -14, duration: 0.8, damping: 6, frequency: 8, delay: 0 },
      ],
    },
  },
  {
    id: 'mp-text-stagger',
    name: 'Kinetic Character Reveal',
    category: 'Text Animation',
    description: 'Animação sequencial por caractere subindo com opacidade',
    version: '1.0',
    favorite: true,
    gradient: 'from-amber-500 to-orange-600',
    patch: {
      textAnimator: {
        enabled: true,
        unit: 'char',
        rangeStart: 0,
        rangeEnd: 100,
        offsetX: 0,
        offsetY: 42,
        scale: 75,
        rotation: 0,
        opacity: 0,
        tracking: 6,
      },
    },
  },
  {
    id: 'mp-lower-third-slide',
    name: 'Editorial Lower Third Slide',
    category: 'Lower Thirds',
    description: 'Entrada lateral com overshoot preciso para créditos',
    version: '1.0',
    gradient: 'from-sky-600 to-blue-800',
    patch: {
      motionBehaviors: [
        { type: 'overshoot-in', enabled: true, property: 'x', intensity: -55, duration: 0.75, damping: 6, frequency: 6.5, delay: 0 },
      ],
    },
  },
  {
    id: 'mp-whip-transition',
    name: 'Whip Pan Transition',
    category: 'Transitions',
    description: ' Chicote rápido de câmera nas bordas do clipe',
    version: '1.0',
    gradient: 'from-rose-500 to-amber-500',
    patch: {
      transitionIn: 'whip-pan',
      transitionOut: 'whip-pan',
    },
  },
  {
    id: 'mp-social-beat',
    name: 'Reels Audio Beat Pump',
    category: 'Social Media',
    description: 'Pulsa o zoom automaticamente no ritmo do áudio',
    version: '1.0',
    favorite: true,
    gradient: 'from-pink-500 to-rose-600',
    patch: {
      motionBehaviors: [
        { type: 'audio-pulse', enabled: true, property: 'scale', intensity: 16, duration: 5, damping: 4, frequency: 1, delay: 0 },
      ],
    },
  },
  {
    id: 'mp-cinema-anamorphic',
    name: 'Anamorphic Cinema Grade',
    category: 'Cinematic',
    description: 'Contraste cinematográfico + Glow suave + Vinheta óptica',
    version: '1.0',
    gradient: 'from-teal-600 to-amber-500',
    patch: {
      filters: { contrast: 118, saturation: 114, temperature: 16, vignette: 34, presetName: 'Anamorphic' },
      effects: [{ type: 'S_Glow', params: { brightness: 55, size: 32 } }],
    },
  },
  {
    id: 'mp-cam-handheld',
    name: 'Handheld Documentary Drift',
    category: 'Camera Movement',
    description: 'Movimento orgânico sutil de câmera na mão',
    version: '1.0',
    gradient: 'from-emerald-600 to-teal-800',
    patch: {
      motionBehaviors: [
        { type: 'wiggle', enabled: true, property: 'x', intensity: 1.8, duration: 5, damping: 1, frequency: 1.2, delay: 0 },
        { type: 'wiggle', enabled: true, property: 'y', intensity: 1.5, duration: 5, damping: 1, frequency: 1.0, delay: 0, seed: 42 },
        { type: 'wiggle', enabled: true, property: 'rotation', intensity: 0.7, duration: 5, damping: 1, frequency: 0.8, delay: 0, seed: 91 },
      ],
    },
  },
  {
    id: 'mp-impact-shake',
    name: 'Heavy Bass Impact Shake',
    category: 'Shake',
    description: 'Impacto curto de câmera com recuo e dissipação rápida',
    version: '1.0',
    gradient: 'from-red-600 to-orange-500',
    patch: {
      motionBehaviors: [
        { type: 'shake', enabled: true, property: 'x', intensity: 18, duration: 0.5, damping: 7, frequency: 20, delay: 0 },
        { type: 'recoil', enabled: true, property: 'scale', intensity: 14, duration: 0.45, damping: 8, frequency: 9, delay: 0 },
      ],
    },
  },
  {
    id: 'mp-spring-squash',
    name: ' Rubber Squash & Stretch',
    category: 'Spring',
    description: ' Física cartoon com compressão elástica nos eixos X/Y',
    version: '1.0',
    gradient: 'from-lime-500 to-emerald-600',
    patch: {
      motionBehaviors: [
        { type: 'squash-stretch', enabled: true, property: 'scaleY', intensity: 28, duration: 0.7, damping: 5.5, frequency: 10, delay: 0 },
        { type: 'squash-stretch', enabled: true, property: 'scaleX', intensity: -20, duration: 0.7, damping: 5.5, frequency: 10, delay: 0 },
      ],
    },
  },
  {
    id: 'mp-bounce-drop',
    name: 'Gravity Bounce Drop',
    category: 'Bounce',
    description: 'Queda com gravidade e quiques amortecidos',
    version: '1.0',
    gradient: 'from-yellow-500 to-amber-600',
    patch: {
      motionBehaviors: [
        { type: 'bounce-drop', enabled: true, property: 'y', intensity: -45, duration: 1.0, damping: 4.2, frequency: 7.5, delay: 0 },
      ],
    },
  },
  {
    id: 'mp-glitch-hit',
    name: 'Cyber RGB Glitch Hit',
    category: 'Glitch',
    description: 'Aberração cromática + blocos digitais e scanlines',
    version: '1.0',
    gradient: 'from-fuchsia-600 to-cyan-500',
    patch: {
      effects: [
        { type: 'S_DigitalDamage', params: { amount: 42, blocks: 14, rgb: 16 } },
        { type: 'S_WarpChroma', params: { amount: 7 } },
      ],
    },
  },
  {
    id: 'mp-hud-spin',
    name: 'HUD Telemetry Ring',
    category: 'HUD',
    description: 'Rotação técnica contínua com Trim Paths e brilho',
    version: '1.0',
    gradient: 'from-cyan-500 to-sky-700',
    patch: {
      shapePatch: { trimStart: 12, trimEnd: 78, repeaterCopies: 3, repeaterRotation: 120, fillMode: 'none', strokeWidth: 4 },
      keyframes: [
        {
          property: 'rotation',
          loop: 'offset',
          keyframes: [
            { id: 'h1', time: 0, value: 0, easing: 'linear' },
            { id: 'h2', time: 4, value: 360, easing: 'linear' },
          ],
        },
      ],
    },
  },
  {
    id: 'mp-callout-pop',
    name: 'Clean Callout Pop',
    category: 'Callouts',
    description: 'Destaque informativo rápido com sombra suave',
    version: '1.0',
    gradient: 'from-indigo-500 to-blue-600',
    patch: {
      motionBehaviors: [
        { type: 'elastic-pop', enabled: true, property: 'scale', intensity: 35, duration: 0.65, damping: 6.5, frequency: 10, delay: 0 },
      ],
      effects: [{ type: 'S_DropShadow', params: { opacity: 65, distance: 12, blur: 14 } }],
    },
  },
  {
    id: 'mp-bg-drift',
    name: 'Ambient Gradient Drift',
    category: 'Backgrounds',
    description: 'Flutuação lenta e hipnótica para fundos e texturas',
    version: '1.0',
    gradient: 'from-purple-700 to-indigo-900',
    patch: {
      motionBehaviors: [
        { type: 'smooth-drift', enabled: true, property: 'y', intensity: 5, duration: 6, damping: 1, frequency: 0.35, delay: 0 },
      ],
    },
  },
  {
    id: 'mp-shape-burst',
    name: 'Radial Shape Burst',
    category: 'Shapes',
    description: 'Repetidor radial com animação de Trim Paths',
    version: '1.0',
    gradient: 'from-emerald-400 to-cyan-600',
    patch: {
      shapePatch: { repeaterCopies: 8, repeaterOffsetX: 0, repeaterOffsetY: 0, repeaterRotation: 45, repeaterScale: 88 },
      keyframes: [
        {
          property: 'trimEndPct',
          keyframes: [
            { id: 's1', time: 0, value: 0, easing: 'expo' },
            { id: 's2', time: 1.1, value: 100, easing: 'linear' },
          ],
        },
      ],
    },
  },
];
