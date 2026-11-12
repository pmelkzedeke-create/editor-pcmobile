import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {
  Camera3dData,
  LightData,
  Model3dData,
  TimelineClip,
} from '../types/editor';
import { resolveClipAnimation } from './keyframes';

interface LoadedModelCache {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

interface ModelEntry {
  obj: THREE.Object3D;
  sig: string;
  /** Geometry/material belong to this entry (primitives) and must be disposed with it. */
  ownsResources: boolean;
  mixer?: THREE.AnimationMixer;
  lastUsed: number;
}

interface LightEntry {
  light: THREE.Light;
  sig: string;
  lastUsed: number;
}

export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything (camera distance, light range, model size) is authored for a 720px-tall frame. */
const REFERENCE_HEIGHT = 720;
/** Distance at which a point/spot light's `intensity` reads like a classic (non-physical) light. */
const LIGHT_REFERENCE_DISTANCE = 500;
const MAX_IDLE_FRAMES = 240;
const MODEL_TARGET_SIZE = 140;

const DEFAULT_LIGHT: LightData = {
  lightType: 'directional',
  color: '#ffffff',
  intensity: 1.5,
  distance: 800,
  decay: 2,
  castShadow: true,
};

function detectLowPower(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const touch = navigator.maxTouchPoints > 0;
  const small = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 900;
  return touch && small;
}

export class StudioThreeEngine {
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private defaultCamera: THREE.PerspectiveCamera;
  private gltfLoader = new GLTFLoader();
  private modelCache = new Map<string, LoadedModelCache>();
  private pendingLoads = new Map<string, Promise<LoadedModelCache | null>>();
  private failedLoads = new Set<string>();
  private geometryCache = new Map<string, THREE.BufferGeometry>();
  private entries = new Map<string, ModelEntry>();
  private lights = new Map<string, LightEntry>();
  private frameCounter = 0;
  private lowPower = detectLowPower();
  private maxDimension = 4096;
  private lastW = 0;
  private lastH = 0;
  private contextLost = false;

  // 2D output used by the depth-of-field pass (a WebGL canvas cannot hand out a 2D context).
  private outCanvas: HTMLCanvasElement | null = null;
  private blurCanvas: HTMLCanvasElement | null = null;

  /** Screen-space bounds (canvas pixels) of the last model rendered, or null. */
  lastBounds: ScreenBounds | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.defaultCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
    this.defaultCamera.position.set(0, 0, 800);
    if (typeof document === 'undefined') {
      this.canvas = null as unknown as HTMLCanvasElement;
      this.renderer = null;
      return;
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.initRenderer();
  }

  private initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: !this.lowPower,
        // The compositor copies the frame synchronously after render; keeping the
        // drawing buffer around only costs bandwidth (very noticeable on mobile GPUs).
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in r18x
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);

      const gl = this.renderer.getContext();
      const maxRb = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 4096;
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
      const maxVp = viewport ? Math.min(viewport[0], viewport[1]) : 4096;
      this.maxDimension = Math.max(512, Math.min(maxRb, maxVp, this.lowPower ? 2048 : 8192));

      this.canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.contextLost = true;
      });
      this.canvas.addEventListener('webglcontextrestored', () => {
        this.contextLost = false;
        this.lastW = 0;
        this.lastH = 0;
        // Ask the monitor to redraw: three.js re-uploads GPU resources by itself.
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('otto-3d-restored'));
      });
    } catch {
      this.renderer = null;
    }
  }

  get isSupported(): boolean {
    return this.renderer !== null && typeof document !== 'undefined';
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Resizes the GL canvas, clamping to what the GPU can allocate. Returns the real size. */
  private applySize(width: number, height: number): { w: number; h: number } {
    let w = Math.max(2, Math.round(width));
    let h = Math.max(2, Math.round(height));
    const over = Math.max(w, h) / this.maxDimension;
    if (over > 1) {
      w = Math.max(2, Math.floor(w / over));
      h = Math.max(2, Math.floor(h / over));
    }
    if (this.renderer && (w !== this.lastW || h !== this.lastH)) {
      this.renderer.setSize(w, h, false);
      this.lastW = w;
      this.lastH = h;
    }
    return { w, h };
  }

  setSize(width: number, height: number) {
    if (!this.canvas) return;
    this.applySize(width, height);
  }

  loadGlbModel(url: string): Promise<LoadedModelCache | null> {
    const cached = this.modelCache.get(url);
    if (cached) return Promise.resolve(cached);
    if (typeof document === 'undefined' || this.failedLoads.has(url)) return Promise.resolve(null);
    const pending = this.pendingLoads.get(url);
    if (pending) return pending;

    const promise = new Promise<LoadedModelCache | null>((resolve) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // GLB files come in arbitrary units (often ~1 meter = 1 unit = invisible).
          // Center the model and normalise it to the same size as the built-in primitives.
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const root = new THREE.Group();
          if (!box.isEmpty()) {
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            gltf.scene.position.sub(center);
            root.add(gltf.scene);
            root.scale.setScalar(MODEL_TARGET_SIZE / maxDim);
          } else {
            root.add(gltf.scene);
          }

          const result: LoadedModelCache = { scene: root, animations: gltf.animations || [] };
          this.modelCache.set(url, result);
          this.pendingLoads.delete(url);
          resolve(result);
        },
        undefined,
        () => {
          this.failedLoads.add(url);
          this.pendingLoads.delete(url);
          resolve(null);
        }
      );
    });
    this.pendingLoads.set(url, promise);
    return promise;
  }

  createGeometry(data: Model3dData): THREE.BufferGeometry {
    const key = data.geometry;
    const cached = this.geometryCache.get(key);
    if (cached) return cached;
    let geo: THREE.BufferGeometry;
    switch (data.geometry) {
      case 'sphere':
        geo = new THREE.SphereGeometry(60, 32, 24);
        break;
      case 'cylinder':
        geo = new THREE.CylinderGeometry(50, 50, 120, 32);
        break;
      case 'torus':
        geo = new THREE.TorusGeometry(60, 22, 24, 48);
        break;
      case 'cone':
        geo = new THREE.ConeGeometry(60, 120, 32);
        break;
      case 'pyramid':
        geo = new THREE.ConeGeometry(70, 110, 4);
        break;
      case 'plane':
        geo = new THREE.PlaneGeometry(300, 300, 4, 4);
        break;
      case 'dodecahedron':
        geo = new THREE.DodecahedronGeometry(60);
        break;
      case 'cube':
      default:
        geo = new THREE.BoxGeometry(100, 100, 100);
        break;
    }
    this.geometryCache.set(key, geo);
    return geo;
  }

  createMaterial(data: Model3dData): THREE.Material {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(data.color || '#3b82f6'),
      roughness: Math.max(0, Math.min(1, data.roughness ?? 0.3)),
      metalness: Math.max(0, Math.min(1, data.metalness ?? 0.4)),
      wireframe: !!data.wireframe,
      emissive: new THREE.Color(data.emissive || '#000000'),
      emissiveIntensity: data.emissiveIntensity ?? 0,
      side: THREE.DoubleSide,
    });
  }

  isModelCached(url: string): boolean {
    return this.modelCache.has(url);
  }

  // ───────────────────────── entries / lights ─────────────────────────

  private modelSignature(m: Model3dData, ready: boolean): string {
    return [
      m.geometry,
      m.modelUrl || '',
      ready ? 1 : 0,
      m.color,
      m.roughness,
      m.metalness,
      m.wireframe ? 1 : 0,
      m.emissive || '',
      m.emissiveIntensity ?? 0,
      m.castShadow !== false ? 1 : 0,
      m.receiveShadow !== false ? 1 : 0,
      m.animationIndex ?? 0,
    ].join('|');
  }

  private disposeEntry(entry: ModelEntry) {
    entry.mixer?.stopAllAction();
    if (!entry.ownsResources) return;
    entry.obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Geometries are shared through geometryCache; only materials are per-entry.
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }

  private getModelEntry(clip: TimelineClip, mData: Model3dData): ModelEntry {
    const loaded =
      mData.geometry === 'custom' && mData.modelUrl ? this.modelCache.get(mData.modelUrl) : undefined;
    const sig = this.modelSignature(mData, !!loaded);
    const existing = this.entries.get(clip.id);
    if (existing && existing.sig === sig) {
      existing.lastUsed = this.frameCounter;
      return existing;
    }
    if (existing) this.disposeEntry(existing);

    let obj: THREE.Object3D;
    let ownsResources = true;
    let mixer: THREE.AnimationMixer | undefined;

    if (mData.geometry === 'custom' && mData.modelUrl) {
      if (loaded) {
        obj = cloneSkinned(loaded.scene);
        ownsResources = false; // geometry + materials are shared with the cached GLB
        if (loaded.animations.length) {
          mixer = new THREE.AnimationMixer(obj);
          const idx = Math.min(loaded.animations.length - 1, Math.max(0, mData.animationIndex ?? 0));
          mixer.clipAction(loaded.animations[idx]).play();
        }
      } else {
        void this.loadGlbModel(mData.modelUrl);
        const mesh = new THREE.Mesh(
          this.createGeometry({ ...mData, geometry: 'cube' }),
          this.createMaterial({ ...mData, wireframe: true })
        );
        mesh.scale.setScalar(0.8);
        obj = new THREE.Group().add(mesh);
      }
    } else {
      const mesh = new THREE.Mesh(this.createGeometry(mData), this.createMaterial(mData));
      mesh.castShadow = mData.castShadow !== false && !this.lowPower;
      mesh.receiveShadow = mData.receiveShadow !== false && !this.lowPower;
      obj = mesh;
    }

    const entry: ModelEntry = { obj, sig, ownsResources, mixer, lastUsed: this.frameCounter };
    this.entries.set(clip.id, entry);
    return entry;
  }

  private lightSignature(type: string, castShadow: boolean) {
    return `${type}|${castShadow ? 1 : 0}`;
  }

  private acquireLight(
    key: string,
    type: LightData['lightType'],
    castShadow: boolean,
    factory: () => THREE.Light
  ): THREE.Light {
    const sig = this.lightSignature(type, castShadow);
    const existing = this.lights.get(key);
    if (existing && existing.sig === sig) {
      existing.lastUsed = this.frameCounter;
      return existing.light;
    }
    if (existing) existing.light.dispose();
    const light = factory();
    this.lights.set(key, { light, sig, lastUsed: this.frameCounter });
    return light;
  }

  private configureShadow(light: THREE.Light, size: number, reach: number, k: number) {
    const shadow = (light as THREE.DirectionalLight).shadow;
    if (!shadow) return;
    const map = this.lowPower ? 512 : size;
    shadow.mapSize.set(map, map);
    shadow.bias = -0.0006;
    shadow.normalBias = 0.5 * k;
    if ((light as THREE.DirectionalLight).isDirectionalLight) {
      const cam = shadow.camera as THREE.OrthographicCamera;
      cam.near = 10 * k;
      cam.far = 2500 * k;
      const d = reach * k;
      cam.left = -d;
      cam.right = d;
      cam.top = d;
      cam.bottom = -d;
      cam.updateProjectionMatrix();
    }
  }

  /** Releases GPU memory of models / lights that have not been drawn for a while. */
  private pruneIdle() {
    if (this.frameCounter % 60 !== 0) return;
    for (const [id, entry] of this.entries) {
      if (this.frameCounter - entry.lastUsed > MAX_IDLE_FRAMES) {
        this.disposeEntry(entry);
        this.entries.delete(id);
      }
    }
    for (const [id, entry] of this.lights) {
      if (this.frameCounter - entry.lastUsed > MAX_IDLE_FRAMES) {
        entry.light.dispose();
        this.lights.delete(id);
      }
    }
  }

  // ─────────────────────────────── render ───────────────────────────────

  render3DScene(
    clips: TimelineClip[],
    allClipsMap: Map<string, TimelineClip>,
    width: number,
    height: number,
    currentTime: number,
    fps = 30,
    activeCameraClip?: TimelineClip,
    activeLightClips: TimelineClip[] = []
  ): HTMLCanvasElement | null {
    this.lastBounds = null;
    if (!this.renderer || !this.canvas || this.contextLost) return null;

    const drawables = clips.filter(
      (c) =>
        c.enabled !== false &&
        c.type === 'model3d' &&
        currentTime >= c.startTime &&
        currentTime < c.startTime + c.duration
    );
    // Nothing to draw: skip building lights/cameras entirely.
    if (drawables.length === 0) return null;

    this.frameCounter++;
    const { w, h } = this.applySize(width, height);
    // Everything is authored in 720p units; scale world so preview (1/2, 1/4) and export match.
    const k = h / REFERENCE_HEIGHT;
    const aspect = w / h;

    // Detach everything from the previous pass; entries/lights stay alive in their pools.
    this.scene.clear();

    // ── Camera ──
    let activeCamera: THREE.PerspectiveCamera = this.defaultCamera;
    let activeCamData: Camera3dData | null = null;

    if (activeCameraClip && activeCameraClip.cameraData) {
      const camAnim = resolveClipAnimation(activeCameraClip, currentTime, fps, 1, 0);
      const camData: Camera3dData = activeCameraClip.cameraData;
      const fov = camAnim.cameraFov || camData.fov || 50;
      activeCamera = new THREE.PerspectiveCamera(
        fov,
        aspect,
        (camData.near || 0.1) * k,
        (camData.far || 5000) * k
      );
      activeCamData = {
        ...camData,
        fov,
        focusDistance: camAnim.cameraFocus,
        aperture: camAnim.cameraAperture,
      };

      activeCamera.position.set(
        (camAnim.x / 100) * (w / 2),
        -(camAnim.y / 100) * (h / 2),
        (camAnim.z + 800) * k
      );
      activeCamera.lookAt(
        (camData.lookAtX / 100) * (w / 2),
        -(camData.lookAtY / 100) * (h / 2),
        (camData.lookAtZ ?? 0) * k
      );

      // Tilt / roll around the camera's own axes (after look-at), not the world's.
      const camRotZ = camAnim.rotationZ || camAnim.rotation || 0;
      if (camRotZ) activeCamera.rotateZ((camRotZ * Math.PI) / 180);
      if (camAnim.rotationX) activeCamera.rotateX((camAnim.rotationX * Math.PI) / 180);
      if (camAnim.rotationY) activeCamera.rotateY((camAnim.rotationY * Math.PI) / 180);
    } else {
      this.defaultCamera.aspect = aspect;
      this.defaultCamera.near = 0.1 * k;
      this.defaultCamera.far = 5000 * k;
      this.defaultCamera.position.set(0, 0, 800 * k);
      this.defaultCamera.rotation.set(0, 0, 0);
      activeCamera = this.defaultCamera;
    }
    activeCamera.updateProjectionMatrix();
    activeCamera.updateMatrixWorld(true);

    // ── Lights ──
    // Lights follow the classic (non-physical) convention: intensity 1 ≈ "full".
    // three.js >= r155 is physically based, so compensate (π for lux, distance² for candela).
    if (activeLightClips.length > 0) {
      for (const lightClip of activeLightClips) {
        const lightAnim = resolveClipAnimation(lightClip, currentTime, fps, 1, 0);
        const lData: LightData = lightClip.lightData || DEFAULT_LIGHT;
        const lx = (lightAnim.x / 100) * (w / 2);
        const ly = -(lightAnim.y / 100) * (h / 2);
        const lz = (lightAnim.z + 400) * k;
        const intensity = lightAnim.lightIntensity ?? lData.intensity ?? 1.5;
        const decay = lData.decay || 2;
        const physical = Math.PI * Math.pow(LIGHT_REFERENCE_DISTANCE * k, decay);
        const wantsShadow = lData.castShadow !== false && !this.lowPower;
        const key = `clip:${lightClip.id}`;

        let lightObj: THREE.Light;
        if (lData.lightType === 'point') {
          const light = this.acquireLight(key, 'point', wantsShadow, () => {
            const l = new THREE.PointLight();
            l.castShadow = wantsShadow;
            if (wantsShadow) this.configureShadow(l, 1024, 0, k);
            return l;
          }) as THREE.PointLight;
          light.distance = (lData.distance || 1000) * k;
          light.decay = decay;
          light.intensity = intensity * physical;
          light.position.set(lx, ly, lz);
          lightObj = light;
        } else if (lData.lightType === 'spot') {
          const light = this.acquireLight(key, 'spot', wantsShadow, () => {
            const l = new THREE.SpotLight();
            l.castShadow = wantsShadow;
            if (wantsShadow) this.configureShadow(l, 1024, 0, k);
            return l;
          }) as THREE.SpotLight;
          light.distance = (lData.distance || 1200) * k;
          light.decay = decay;
          light.angle = ((lData.angle || 45) * Math.PI) / 180;
          light.penumbra = lData.penumbra ?? 0.3;
          light.intensity = intensity * physical;
          light.position.set(lx, ly, lz);
          light.target.position.set(0, 0, 0);
          light.target.updateMatrixWorld();
          lightObj = light;
        } else if (lData.lightType === 'ambient') {
          const light = this.acquireLight(key, 'ambient', false, () => new THREE.AmbientLight()) as THREE.AmbientLight;
          light.intensity = intensity * Math.PI;
          lightObj = light;
        } else {
          const light = this.acquireLight(key, 'directional', wantsShadow, () => {
            const l = new THREE.DirectionalLight();
            l.castShadow = wantsShadow;
            if (wantsShadow) this.configureShadow(l, 1024, 600, k);
            return l;
          }) as THREE.DirectionalLight;
          light.intensity = intensity * Math.PI;
          light.position.set(lx, ly, lz);
          lightObj = light;
        }
        lightObj.color.set(lData.color || '#ffffff');
        this.scene.add(lightObj);
      }
    } else {
      // Default studio rig
      const ambient = this.acquireLight('default:ambient', 'ambient', false, () => new THREE.AmbientLight()) as THREE.AmbientLight;
      ambient.color.set(0xffffff);
      ambient.intensity = 0.9 * Math.PI;
      this.scene.add(ambient);

      const keyShadow = !this.lowPower;
      const key = this.acquireLight('default:key', 'directional', keyShadow, () => {
        const l = new THREE.DirectionalLight();
        l.castShadow = keyShadow;
        if (keyShadow) this.configureShadow(l, 1024, 600, k);
        return l;
      }) as THREE.DirectionalLight;
      key.color.set(0xffffff);
      key.intensity = 1.8 * Math.PI;
      key.position.set(300 * k, 400 * k, 500 * k);
      this.scene.add(key);

      const fill = this.acquireLight('default:fill', 'point', false, () => new THREE.PointLight()) as THREE.PointLight;
      fill.color.set(0x60a5fa);
      fill.distance = 1200 * k;
      fill.decay = 2;
      fill.intensity = 0.8 * Math.PI * Math.pow(LIGHT_REFERENCE_DISTANCE * k, 2);
      fill.position.set(-400 * k, -200 * k, 300 * k);
      this.scene.add(fill);
    }

    // ── Models ──
    let boundsObject: THREE.Object3D | null = null;
    for (const clip of drawables) {
      const clipAnim = resolveClipAnimation(clip, currentTime, fps, 1, 0);

      // Hierarchical parenting: follow the parent layer's position
      let parentOffsetX = 0;
      let parentOffsetY = 0;
      let parentOffsetZ = 0;
      if (clip.parentId && allClipsMap.has(clip.parentId)) {
        const parent = allClipsMap.get(clip.parentId)!;
        const parentAnim = resolveClipAnimation(parent, currentTime, fps, 1, 0);
        parentOffsetX = (parentAnim.x / 100) * (w / 2);
        parentOffsetY = -(parentAnim.y / 100) * (h / 2);
        parentOffsetZ = (parentAnim.z ?? 0) * k;
      }

      const mData: Model3dData = clip.model3dData || {
        geometry: 'cube',
        color: '#3b82f6',
        roughness: 0.3,
        metalness: 0.4,
        wireframe: false,
        castShadow: true,
        receiveShadow: true,
      };

      const entry = this.getModelEntry(clip, mData);
      const obj = entry.obj;
      obj.position.set(
        (clipAnim.x / 100) * (w / 2) + parentOffsetX,
        -(clipAnim.y / 100) * (h / 2) + parentOffsetY,
        clipAnim.z * k + parentOffsetZ
      );
      obj.rotation.set(
        (clipAnim.rotationX * Math.PI) / 180,
        (clipAnim.rotationY * Math.PI) / 180,
        -((clipAnim.rotationZ || clipAnim.rotation || 0) * Math.PI) / 180
      );
      // Preserve the intrinsic scale of normalised GLB roots / placeholder meshes.
      const base = (obj.userData.baseScale as number | undefined) ?? obj.scale.x;
      if (obj.userData.baseScale === undefined) obj.userData.baseScale = base;
      obj.scale.set(
        base * (clipAnim.scaleX / 100) * k,
        base * (clipAnim.scaleY / 100) * k,
        base * (clipAnim.scaleZ / 100) * k
      );

      if (entry.mixer) {
        const local = Math.max(0, currentTime - clip.startTime) * (mData.animationSpeed ?? 1);
        entry.mixer.setTime(local);
      }

      this.scene.add(obj);
      boundsObject = obj;
    }

    // ── Draw ──
    this.renderer.clear();
    this.renderer.render(this.scene, activeCamera);

    if (boundsObject) this.lastBounds = this.projectBounds(boundsObject, activeCamera, w, h);
    this.pruneIdle();

    // Depth-of-field: blurred copy blended over the sharp frame (2D pass).
    if (activeCamData && activeCamData.aperture > 0.5) {
      const out = this.applyDepthOfField(activeCamData, w, h);
      if (out) return out;
    }
    return this.canvas;
  }

  /** Projects an object's bounding box to canvas pixels so selection handles match the 3D model. */
  private projectBounds(
    obj: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
    w: number,
    h: number
  ): ScreenBounds | null {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return null;
    const { min, max } = box;
    const v = new THREE.Vector3();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(camera);
      if (!Number.isFinite(v.x) || v.z > 1) return null; // behind the camera
      const px = ((v.x + 1) / 2) * w;
      const py = ((1 - v.y) / 2) * h;
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    }
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(w, x1);
    y1 = Math.min(h, y1);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  private applyDepthOfField(camData: Camera3dData, width: number, height: number): HTMLCanvasElement | null {
    const aperture = Math.min(30, camData.aperture || 0);
    if (aperture <= 0.5) return null;

    const out = this.outCanvas || (this.outCanvas = document.createElement('canvas'));
    const blur = this.blurCanvas || (this.blurCanvas = document.createElement('canvas'));
    if (out.width !== width || out.height !== height) {
      out.width = width;
      out.height = height;
    }
    const ctx = out.getContext('2d');
    if (!ctx) return null;

    // Down/up-sampling blur: works everywhere (ctx.filter is missing on Safari) and is cheap.
    const factor = 1 + Math.min(12, aperture * 0.4);
    const bw = Math.max(2, Math.round(width / factor));
    const bh = Math.max(2, Math.round(height / factor));
    if (blur.width !== bw || blur.height !== bh) {
      blur.width = bw;
      blur.height = bh;
    }
    const bctx = blur.getContext('2d');
    if (!bctx) return null;
    bctx.clearRect(0, 0, bw, bh);
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(this.canvas, 0, 0, bw, bh);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.canvas, 0, 0, width, height);
    ctx.save();
    ctx.globalAlpha = Math.min(0.75, aperture * 0.06);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(blur, 0, 0, width, height);
    ctx.restore();
    return out;
  }

  dispose() {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    for (const entry of this.lights.values()) entry.light.dispose();
    this.lights.clear();
    for (const geo of this.geometryCache.values()) geo.dispose();
    this.geometryCache.clear();
    for (const model of this.modelCache.values()) {
      model.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry.dispose();
          const mat = (child as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else if (mat) mat.dispose();
        }
      });
    }
    this.modelCache.clear();
    this.pendingLoads.clear();
    this.scene.clear();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}

export const studioThreeEngine = new StudioThreeEngine();
