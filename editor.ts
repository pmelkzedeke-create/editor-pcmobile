export type AspectRatioKey = '16:9' | '9:16' | '1:1' | '4:5' | '2k' | '4k' | 'custom';

export interface AspectRatioSpec {
  key: AspectRatioKey;
  label: string;
  width: number;
  height: number;
}

export const ASPECT_RATIOS: Record<AspectRatioKey, AspectRatioSpec> = {
  '16:9': { key: '16:9', label: '16:9 Paisagem', width: 1280, height: 720 },
  '9:16': { key: '9:16', label: '9:16 Vertical', width: 720, height: 1280 },
  '1:1': { key: '1:1', label: '1:1 Quadrado', width: 1080, height: 1080 },
  '4:5': { key: '4:5', label: '4:5 Social', width: 1080, height: 1350 },
  '2k': { key: '2k', label: '2K QHD', width: 2560, height: 1440 },
  '4k': { key: '4k', label: '4K UHD', width: 3840, height: 2160 },
  custom: { key: 'custom', label: 'Personalizado', width: 1920, height: 1080 },
};

export type MediaType = 'video' | 'image' | 'audio' | 'model3d' | 'lottie' | 'svg';
export type TrackType = 'video' | 'audio' | 'text' | 'shape' | '3d';
export type ClipType =
  | 'video'
  | 'image'
  | 'audio'
  | 'text'
  | 'shape'
  | 'solid'
  | 'adjustment'
  | 'null'
  | 'precomp'
  | 'model3d'
  | 'camera'
  | 'light'
  | 'lottie'
  | 'svg';

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type TrackMatteMode =
  | 'none'
  | 'alpha'
  | 'alpha-inverted'
  | 'luma'
  | 'luma-inverted';

export type TransitionType =
  | 'none'
  | 'fade'
  | 'dissolve'
  | 'zoom'
  | 'slide-left'
  | 'slide-up'
  | 'wipe-right'
  | 'push-left'
  | 'whip-pan'
  | 'light-sweep'
  | 'glitch'
  | 'iris-shape'
  | 'blur'
  | 'flash';

export type MotionPreset =
  | 'none'
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-right'
  | 'pan-left';

export type TextAnimation =
  | 'none'
  | 'fade-up'
  | 'pop'
  | 'typewriter'
  | 'glow'
  | 'stagger-chars'
  | 'stagger-words'
  | 'tracking-in'
  | 'mask-reveal';

export type EasingName =
  | 'linear'
  | 'smooth'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'power'
  | 'expo'
  | 'circ'
  | 'back'
  | 'elastic'
  | 'bounce'
  | 'spring'
  | 'overshoot'
  | 'cinematic'
  | 'hold'
  | 'bezier';

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'z'
  | 'anchorX'
  | 'anchorY'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'scaleZ'
  | 'rotation'
  | 'rotationX'
  | 'rotationY'
  | 'rotationZ'
  | 'opacity'
  | 'skew'
  | 'trimStartPct'
  | 'trimEndPct'
  | 'strokeWidth'
  | 'strokeDashOffset'
  | 'maskFeather'
  | 'maskExpansion'
  | 'letterSpacing'
  | 'cameraFov'
  | 'cameraFocus'
  | 'cameraAperture'
  | 'lightIntensity'
  | 'lightDistance'
  | 'dropShadowDistance'
  | 'dropShadowBlur'
  | 'dropShadowOpacity';

export type Model3dGeometry =
  | 'cube'
  | 'sphere'
  | 'cylinder'
  | 'torus'
  | 'plane'
  | 'cone'
  | 'pyramid'
  | 'dodecahedron'
  | 'custom';

export interface Model3dData {
  geometry: Model3dGeometry;
  modelUrl?: string; // URL blob/path para arquivos .GLB / .GLTF
  color: string;
  roughness: number; // 0..1
  metalness: number; // 0..1
  wireframe: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  animationIndex?: number;
  animationSpeed?: number;
}

export type LightType = 'directional' | 'point' | 'ambient' | 'spot';

export interface LightData {
  lightType: LightType;
  color: string;
  intensity: number; // 0..10
  distance: number; // alcance para point/spot
  decay: number; // 1..2
  castShadow: boolean;
  angle?: number; // radianos/graus para spot
  penumbra?: number; // 0..1 para spot
  targetX?: number;
  targetY?: number;
  targetZ?: number;
}

export interface Camera3dData {
  fov: number; // 15..120 graus (default: 50)
  near: number;
  far: number;
  focusDistance: number; // distância focal em px/unidades
  aperture: number; // abertura (0 = sem DOF blur, >0 = desfoque progressivo)
  lookAtX: number;
  lookAtY: number;
  lookAtZ: number;
  orbitRadius?: number;
}

export interface PuppetPin {
  id: string;
  name: string;
  originX: number; // coordenada normalizada -50..50 (%)
  originY: number; // coordenada normalizada -50..50 (%)
  currentX: number; // posição deformada atual
  currentY: number;
  radius: number; // raio de influência em %
}

export interface DropShadowConfig {
  enabled: boolean;
  color: string;
  blur: number; // px
  distance: number; // px
  angle: number; // graus (0..360)
  opacity: number; // 0..100 (%)
}

export interface LottieData {
  jsonString?: string;
  parsedData?: any;
  loop?: boolean;
  speed?: number;
}

export interface CurveHandle {
  x: number; // normalized 0..1 time fraction of segment
  y: number; // normalized value delta fraction (can exceed 0..1 for overshoot!)
}

export interface PropertyKeyframe {
  id: string;
  time: number; // local seconds relative to clip.startTime (0..clip.duration)
  value: number;
  easing: EasingName;
  outHandle?: CurveHandle;
  inHandle?: CurveHandle;
}

export type TrackLoopMode = 'none' | 'cycle' | 'pingpong' | 'offset';

export interface PropertyTrack {
  property: AnimatableProperty | string;
  keyframes: PropertyKeyframe[];
  loop?: TrackLoopMode;
  expression?: string;
  expressionEnabled?: boolean;
}

export type MotionBehaviorType =
  | 'spring-in'
  | 'elastic-pop'
  | 'bounce-drop'
  | 'overshoot-in'
  | 'wiggle'
  | 'squash-stretch'
  | 'shake'
  | 'recoil'
  | 'audio-pulse'
  | 'smooth-drift';

export interface MotionBehavior {
  id: string;
  type: MotionBehaviorType;
  enabled: boolean;
  property: AnimatableProperty;
  intensity: number; // -200..200, default 100
  duration: number; // seconds, e.g. 0.8
  damping: number; // 1..20, default 6
  frequency: number; // 0.2..20 Hz, default 3
  delay: number; // seconds offset from clip start
  seed?: number;
}

export interface ShapeVertex {
  x: number; // normalized -50..50 (% of shape box)
  y: number; // normalized -50..50 (% of shape box)
  inX?: number; // relative tangent handle offset
  inY?: number;
  outX?: number;
  outY?: number;
}

export type VectorShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'path';

export interface ShapeLayerData {
  kind: VectorShapeKind;
  width: number; // % of comp width (e.g. 40)
  height: number; // % of comp height (e.g. 40)
  fillMode: 'solid' | 'linear-gradient' | 'radial-gradient' | 'none';
  fillColor: string;
  gradientColor2: string;
  gradientAngle: number;
  fillOpacity: number; // 0..100
    strokeColor: string;
    strokeWidth: number;
    strokeDashArray?: number[]; // [tamanho do traço, tamanho do espaço]
    strokeDashOffset?: number; // deslocamento animável
    lineCap: 'butt' | 'round' | 'square';
    lineJoin: 'miter' | 'round' | 'bevel';
    cornerRadius: number;
    sides: number; // polygon/star points
    innerRadius: number; // star inner % (10..95)
    // Trim Paths
    trimStart: number; // 0..100%
    trimEnd: number; // 0..100%
    trimOffset: number; // -360..360 deg
  // Repeater
  repeaterCopies: number; // 1..24
  repeaterOffsetX: number; // px at 720p base
  repeaterOffsetY: number;
  repeaterRotation: number; // deg per copy
  repeaterScale: number; // % per copy (e.g. 100)
  repeaterOpacityEnd: number; // 0..100%
  // Custom Bezier Path vertices
  closed: boolean;
  vertices?: ShapeVertex[];
}

export type MaskShapeKind = 'rect' | 'ellipse' | 'star' | 'path';
export type MaskCombineMode = 'add' | 'subtract' | 'intersect';

export interface LayerMask {
  id: string;
  name: string;
  enabled: boolean;
  kind: MaskShapeKind;
  mode: MaskCombineMode;
  inverted: boolean;
  // Center & size normalized to canvas (-50..50 center offset %, 0..200 width/height %)
  x: number;
  y: number;
  width: number;
  height: number;
  feather: number; // 0..120 px
  expansion: number; // -100..100 px
  opacity: number; // 0..100 %
  vertices?: ShapeVertex[];
}

export interface ClipEffect {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, number>;
  keyframes?: PropertyTrack[];
}

export interface RemapHandle {
  x: number;
  y: number;
}

export interface TimeRemapKeyframe {
  id: string;
  time: number;
  sourceTime: number;
  interpolation: 'linear' | 'bezier' | 'hold';
  inHandle?: RemapHandle;
  outHandle?: RemapHandle;
}

export interface TimeRemap {
  enabled: boolean;
  sourceStart: number;
  sourceEnd: number;
  keyframes: TimeRemapKeyframe[];
}

export interface WorkArea {
  start: number;
  end: number;
}

export type PreviewResolution = 1 | 2 | 4;

export type MediaAvailability = 'ready' | 'missing' | 'offline';

export interface MediaAsset {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  duration: number;
  thumbnail?: string;
  waveform?: number[];
  envelope?: number[]; // 60Hz normalized amplitude envelope for expressions & beat sync
  width?: number;
  height?: number;
  ambientFX?: 'rain-neon' | 'sunbeams' | 'dust-bokeh' | 'none';
  isSample?: boolean;
  /** Original file size in bytes (0 for synthesized media). */
  size?: number;
  /** MIME type of the original file, used for relinking validation. */
  mimeType?: string;
  /** Key under which the binary blob is persisted in the media store. */
  storageKey?: string;
  /** Availability after project load: missing assets must be relinked by the user. */
  status?: MediaAvailability;
  /** Raw Lottie JSON text for lottie assets (persisted separately when small). */
  lottieJson?: string;
}

/**
 * Serializable asset descriptor stored inside the project file.
 * Binary data is NEVER embedded here — it lives in the media store (IndexedDB)
 * or, for portable packages, in an optional base64 side-table under a size limit.
 */
export interface PersistedAsset {
  id: string;
  name: string;
  type: MediaType;
  duration: number;
  width?: number;
  height?: number;
  size?: number;
  mimeType?: string;
  storageKey?: string;
  ambientFX?: 'rain-neon' | 'sunbeams' | 'dust-bokeh' | 'none';
  isSample?: boolean;
  thumbnail?: string;
  waveform?: number[];
  envelope?: number[];
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  solo?: boolean;
  colorTag?: string;
}

export interface ColorAdjustments {
  brightness: number; // 0..200, default 100
  contrast: number; // 0..200, default 100
  saturation: number; // 0..250, default 100
  hue: number; // -180..180, default 0
  blur: number; // 0..20, default 0
  vignette: number; // 0..100, default 0
  temperature: number; // -100..100, default 0
  presetName: string;
}

export interface TextAnimator {
  enabled: boolean;
  unit: 'char' | 'word' | 'line';
  rangeStart: number; // 0..100%
  rangeEnd: number; // 0..100%
  offsetX: number;
  offsetY: number;
  scale: number; // 0..250%
  rotation: number; // -180..180 deg
  opacity: number; // 0..100%
  tracking: number; // px
}

export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  gradientColor2?: string;
  useGradient?: boolean;
  backgroundColor: string;
  backgroundOpacity: number; // 0..100
  strokeColor: string;
  strokeWidth: number;
  shadowBlur: number;
  textAlign: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeightMultiplier?: number; // default 1.24
  pathArc?: number; // -100..100 curved path arc
  borderRadius: number;
  uppercase: boolean;
  animation: TextAnimation;
  animator?: TextAnimator;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Coordinates are normalized to the ORIGINAL media, not to the composition. */
export interface MotionSample {
  time: number;
  x: number;
  y: number;
  confidence: number;
}

export interface MotionAnalysis {
  kind: 'point' | 'camera';
  mediaId: string;
  sourceWidth: number;
  sourceHeight: number;
  start: number;
  end: number;
  sampleRate: number;
  samples: MotionSample[];
}

export interface ClipVfx {
  background?: {
    enabled: boolean;
    tolerance: number;
    softness: number;
    /** null selects the median border color automatically. */
    color: string | null;
    connected: boolean;
  };
  tracking?: MotionAnalysis;
  cleanup?: {
    enabled: boolean;
    rect: NormalizedRect;
    mode: 'clone' | 'blur' | 'pixelate';
    sourceOffsetX: number;
    sourceOffsetY: number;
    feather: number;
    followTrack: boolean;
    referenceTime?: number;
  };
  stabilization?: {
    enabled: boolean;
    strength: number;
    smoothing: number;
    crop: number;
    analysis: MotionAnalysis;
  };
}

export interface TimelineClip {
  id: string;
  trackId: string;
  mediaId?: string;
  precompId?: string; // Reference to nested Composition id when type === 'precomp'
  solidColor?: string; // Color when type === 'solid'
  parentId?: string | null; // Parenting hierarchy link to another clip id
  blendMode?: BlendMode;
  trackMatte?: TrackMatteMode;
  motionBlur?: boolean;
  labelColor?: string;
  enabled?: boolean; // Active switch (defaults to true)
  type: ClipType;
  name: string;
  startTime: number; // seconds on timeline
  duration: number; // seconds visible on timeline
  trimStart: number; // offset inside media source
  maxDuration: number; // max source duration
  // Spatial transform (2D + 2.5D)
  x: number; // -100..100 (% of canvas width from center)
  y: number; // -100..100 (% of canvas height from center)
  z?: number; // -1000..1000 depth units (perspective projection)
  anchorX?: number; // -100..100 (% offset from layer center)
  anchorY?: number; // -100..100 (% offset from layer center)
  scale: number; // 10..300 (%) uniform scale
  scaleX?: number; // optional independent X scale (10..300, defaults to scale)
  scaleY?: number; // optional independent Y scale (10..300, defaults to scale)
  scaleZ?: number; // optional independent Z scale
  unlinkScale?: boolean;
  rotation: number; // -180..180 deg Z rotation
  rotationX?: number; // -85..85 deg 2.5D tilt X
  rotationY?: number; // -85..85 deg 2.5D tilt Y
  rotationZ?: number; // rotação Z explícita 3D
  skew?: number; // -60..60 deg
  opacity: number; // 0..100 (%)
  flipH: boolean;
  flipV: boolean;
  fitMode: 'cover' | 'contain';
  // 3D Switch e Recursos Profissionais
  is3D?: boolean;
  shutterAngle?: number; // 0..720 (padrão: 180)
  motionBlurSamples?: number; // 4..32 (padrão: 8)
  model3dData?: Model3dData;
  lightData?: LightData;
  cameraData?: Camera3dData;
  puppetPins?: PuppetPin[];
  dropShadow?: DropShadowConfig;
  lottieData?: LottieData;
  // Timing & Motion
  speed: number; // 0.25..3
  motionPreset: MotionPreset;
  timeRemap?: TimeRemap;
  // Property Keyframes & Motion Stack
  keyframes?: PropertyTrack[];
  motionStack?: MotionBehavior[];
  // Effects & Masks
  effects?: ClipEffect[];
  masks?: LayerMask[];
  /** Source-space analysis/effects shared by live preview, RAM cache and export. */
  vfx?: ClipVfx;
  // Color & LUTs
  filters: ColorAdjustments;
  // Transitions
  transitionIn: TransitionType;
  transitionInDuration: number;
  transitionOut: TransitionType;
  transitionOutDuration: number;
  // Audio
  volume: number; // 0..200 (%)
  muted: boolean;
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  // Optional Text / Shape Payloads
  textStyle?: TextStyle;
  shapeData?: ShapeLayerData;
  // Cached UI display
  thumbnail?: string;
  waveform?: number[];
  ambientFX?: 'rain-neon' | 'sunbeams' | 'dust-bokeh' | 'none';
}

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface Composition {
  id: string;
  name: string;
  aspectRatio: AspectRatioKey;
  customWidth?: number;
  customHeight?: number;
  fps: 24 | 30 | 60 | 120;
  durationHint?: number;
  backgroundColor: string;
  transparentBg?: boolean;
  tracks: Track[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  workArea?: WorkArea;
}

export interface SavedMotionPreset {
  id: string;
  name: string;
  category:
    | 'Intro'
    | 'Outro'
    | 'Logo Animation'
    | 'Text Animation'
    | 'Lower Thirds'
    | 'Transitions'
    | 'Social Media'
    | 'Cinematic'
    | 'Camera Movement'
    | 'Shake'
    | 'Spring'
    | 'Bounce'
    | 'Glitch'
    | 'HUD'
    | 'Callouts'
    | 'Backgrounds'
    | 'Shapes';
  description: string;
  version: string;
  favorite?: boolean;
  gradient: string;
  patch: {
    motionBehaviors?: Omit<MotionBehavior, 'id'>[];
    keyframes?: PropertyTrack[];
    effects?: { type: string; params?: Record<string, number> }[];
    filters?: Partial<ColorAdjustments>;
    transitionIn?: TransitionType;
    transitionOut?: TransitionType;
    textAnimator?: TextAnimator;
    shapePatch?: Partial<ShapeLayerData>;
  };
}

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface ProjectState {
  schemaVersion?: number;
  /** Asset descriptors referenced by clips (mediaId). Binary blobs are stored separately. */
  assetRegistry?: PersistedAsset[];
  projectName: string;
  aspectRatio: AspectRatioKey;
  customWidth?: number;
  customHeight?: number;
  backgroundColor?: string;
  transparentBg?: boolean;
  fps: 24 | 30 | 60 | 120;
  tracks: Track[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  workArea?: WorkArea;
  activeCompId?: string;
  compositions?: Composition[];
  customPresets?: SavedMotionPreset[];
}

export type LeftSidebarTab = 'media' | 'shapes' | 'text' | 'effects' | 'audio';
export type ExportQuality = '720p' | '1080p' | '2k' | '4k';
export type StudioTheme = 'dark' | 'light';
