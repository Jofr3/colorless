import { useEffect, useRef } from "react";
import * as THREE from "three";
import CardImage from "./CardImage";

// Values copied from Balatro's Card/Moveable/Sprite hover path:
// - globals.lua: CARD_W = 2.4*35/41
// - card.lua: Card:hover() -> juice_up(0.05, 0.03)
// - card.lua: Card:juice_up() multiplies both inputs by 0.4
// - card.lua: Card:init() sets T.scale = 0.95 and zoom = true
// - moveable.lua: hover zoom adds 0.05, scale easing exp(-60*dt), rotation easing exp(-190*dt)
const BALATRO_CARD_W = (2.4 * 35) / 41;
const BALATRO_CARD_BASE_SCALE = 0.95;
const BALATRO_HOVER_ZOOM = 0.05;
const BALATRO_JUICE_DURATION = 0.4;
const BALATRO_JUICE_SCALE_AMT = 0.05 * 0.4;
const BALATRO_JUICE_ROT_AMT = 0.03 * 0.4;
const BALATRO_SCALE_EASE = 60;
const BALATRO_ROTATION_EASE = 190;

const VERTEX_SHADER = /* glsl */ `
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform float uHover;
  uniform float uScreenScale;

  varying vec2 vUv;

  void main() {
    vUv = uv;

    vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    if (uHover > 0.0) {
      vec2 ndc = clipPosition.xy / clipPosition.w;
      vec2 screenPosition = vec2(
        (ndc.x * 0.5 + 0.5) * uResolution.x,
        (-ndc.y * 0.5 + 0.5) * uResolution.y
      );

      float midDist = length(screenPosition - 0.5 * uResolution) / length(uResolution);
      vec2 mouseOffset = (screenPosition - uMouse) / max(uScreenScale, 1.0);
      // Adapted from Balatro's resources/shaders/dissolve.fs vertex bend.
      // Center boost dropped — every card bends the same regardless of
      // position within the container.
      float scale = 0.2*(-0.03)
        * uHover*(length(mouseOffset)*length(mouseOffset))/(2.0-midDist);

      clipPosition.w += scale;
    }

    gl_Position = clipPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uCardSize;
  uniform float uCornerRadius;

  varying vec2 vUv;

  float roundedCardMask(vec2 uv) {
    vec2 halfSize = 0.5 * uCardSize;
    vec2 local = (uv - 0.5) * uCardSize;
    vec2 q = abs(local) - (halfSize - vec2(uCornerRadius));
    float signedDistance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCornerRadius;
    return 1.0 - smoothstep(0.0, 1.0, signedDistance);
  }

  void main() {
    vec4 texel = texture2D(uTexture, vUv);
    texel.a *= roundedCardMask(vUv);
    if (texel.a < 0.01) discard;
    gl_FragColor = texel;
  }
`;

interface BalatroHoverCardProps {
  cardId: string;
  renderedWidth: number;
  alt: string;
  priority?: boolean;
  className?: string;
}

interface PendingCard {
  token: number;
  cardId: string;
  host: HTMLElement;
  surface: HTMLElement;
  mouseClient: THREE.Vector2;
  targetHover: number;
  juiceStart: number;
  juiceSign: number;
}

interface ActiveCard extends PendingCard {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  visibleScale: number;
  scaleVelocity: number;
  rotation: number;
  rotationVelocity: number;
}

class BalatroCardHoverRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private root: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  private readonly loader = new THREE.TextureLoader();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly pending = new Map<HTMLElement, PendingCard>();
  private readonly active = new Map<HTMLElement, ActiveCard>();
  private raf: number | null = null;
  private lastTime = 0;
  private token = 0;
  private available = true;
  private prefersReducedMotion = false;
  private width = 0;
  private height = 0;

  register(cardId: string, host: HTMLElement, surface: HTMLElement) {
    if (!this.available) return;
    this.setRootFrom(host);
    if (this.active.has(host) || this.pending.has(host)) return;

    const token = ++this.token;
    const pendingCard: PendingCard = {
      token,
      cardId,
      host,
      surface,
      mouseClient: new THREE.Vector2(),
      targetHover: 0,
      juiceStart: Number.NEGATIVE_INFINITY,
      juiceSign: 1,
    };
    this.pending.set(host, pendingCard);

    this.loadTexture(cardId)
      .then((texture) => {
        if (this.pending.get(host)?.token !== token || !host.isConnected) return;
        this.pending.delete(host);
        this.activate(pendingCard, texture);
      })
      .catch(() => {
        if (this.pending.get(host)?.token === token) this.pending.delete(host);
      });
  }

  unregister(host: HTMLElement) {
    this.pending.delete(host);
    const card = this.active.get(host);
    if (card) this.removeActive(host, card);
    if (this.active.size === 0 && this.pending.size === 0) {
      this.setOverlayActive(false);
    }
  }

  hover(host: HTMLElement, event: PointerEvent) {
    if (!this.available) return;
    const now = performance.now() / 1000;
    const sign = Math.random() > 0.5 ? 1 : -1;

    const pending = this.pending.get(host);
    if (pending) {
      pending.targetHover = this.prefersReducedMotion ? 0 : 1;
      pending.mouseClient.set(event.clientX, event.clientY);
      pending.juiceStart = this.prefersReducedMotion ? Number.NEGATIVE_INFINITY : now;
      pending.juiceSign = sign;
      return;
    }

    const card = this.active.get(host);
    if (!card) return;

    card.targetHover = this.prefersReducedMotion ? 0 : 1;
    card.mouseClient.set(event.clientX, event.clientY);
    card.juiceStart = this.prefersReducedMotion ? Number.NEGATIVE_INFINITY : now;
    card.juiceSign = sign;
    if (!this.prefersReducedMotion) {
      // Match Moveable:juice_up — snap VT.scale to pop value, leave velocity.
      card.visibleScale = (1 - 0.6 * BALATRO_JUICE_SCALE_AMT) / BALATRO_CARD_BASE_SCALE;
    }
    this.requestFrame();
  }

  unhover(host: HTMLElement) {
    const pending = this.pending.get(host);
    if (pending) {
      pending.targetHover = 0;
      return;
    }
    const card = this.active.get(host);
    if (!card) return;
    card.targetHover = 0;
    this.requestFrame();
  }

  move(host: HTMLElement, event: PointerEvent) {
    const card = this.active.get(host) ?? this.pending.get(host);
    if (!card) return;
    card.mouseClient.set(event.clientX, event.clientY);
    if (this.active.has(host)) this.requestFrame();
  }

  private activate(card: PendingCard, texture: THREE.Texture) {
    if (!this.ensureRenderer()) return;

    // Refresh juiceStart so juice plays from when card actually pops in,
    // even if texture load delayed activation past pointer enter.
    if (!this.prefersReducedMotion && card.targetHover > 0) {
      card.juiceStart = performance.now() / 1000;
    }

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uResolution: { value: new THREE.Vector2(Math.max(this.width, 1), Math.max(this.height, 1)) },
        uMouse: { value: new THREE.Vector2() },
        uHover: { value: 0 },
        uScreenScale: { value: 1 },
        uCardSize: { value: new THREE.Vector2(1, 1) },
        uCornerRadius: { value: 6 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = card.token;

    this.scene?.add(mesh);

    const hoveredAtActivate = !this.prefersReducedMotion && card.targetHover > 0;
    this.active.set(card.host, {
      ...card,
      mesh,
      material,
      visibleScale: hoveredAtActivate
        ? (1 - 0.6 * BALATRO_JUICE_SCALE_AMT) / BALATRO_CARD_BASE_SCALE
        : 1, // rest = absolute 0.95 / baseScale 0.95 = 1.0 (=CSS size)
      scaleVelocity: 0,
      rotation: 0,
      rotationVelocity: 0,
    });

    // Sync render once before unhiding canvas — avoids 1-frame flash of stale
    // buffer. Render-only (no physics) so dt on next rAF stays correct.
    this.renderInitial(card.host);
    card.host.setAttribute("data-balatro-active", "true");
    this.setOverlayActive(true);
    this.requestFrame();
  }

  private renderInitial(host: HTMLElement) {
    if (!this.renderer || !this.scene || !this.camera || !this.root) return;
    const card = this.active.get(host);
    if (!card) return;

    this.resizeToRoot();
    this.applyCardTransform(card);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  private applyCardTransform(card: ActiveCard) {
    if (!this.root) return;
    const rootRect = this.root.getBoundingClientRect();
    const rect = card.surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = rect.left - rootRect.left;
    const y = rect.top - rootRect.top;

    card.mesh.position.set(x + rect.width / 2, this.height - (y + rect.height / 2), 0);
    card.mesh.scale.set(rect.width * card.visibleScale, rect.height * card.visibleScale, 1);
    card.mesh.rotation.z = card.rotation;

    card.material.uniforms.uResolution.value.set(this.width, this.height);
    card.material.uniforms.uMouse.value.set(
      card.mouseClient.x - rootRect.left,
      card.mouseClient.y - rootRect.top,
    );
    card.material.uniforms.uHover.value = card.targetHover;
    card.material.uniforms.uScreenScale.value = Math.max(1, rect.width / BALATRO_CARD_W);
    card.material.uniforms.uCardSize.value.set(rect.width, rect.height);
    card.material.uniforms.uCornerRadius.value = Math.min(8, Math.max(3, rect.width * 0.043));
  }

  private loadTexture(cardId: string) {
    const cached = this.textures.get(cardId);
    if (cached) return cached;

    if (!this.ensureRenderer()) {
      return Promise.reject(new Error("WebGL renderer is unavailable"));
    }

    const texturePromise = new Promise<THREE.Texture>((resolve, reject) => {
      this.loader.load(
        `/cards/${cardId}-400.jpg`,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(4, this.renderer?.capabilities.getMaxAnisotropy() ?? 1);
          texture.needsUpdate = true;
          resolve(texture);
        },
        undefined,
        reject,
      );
    });

    this.textures.set(cardId, texturePromise);
    return texturePromise;
  }

  private ensureRenderer() {
    if (!this.available) return null;
    if (this.renderer) return this.renderer;

    try {
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 1000);
      this.camera.position.z = 100;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "balatro-webgl-overlay";
      this.canvas.setAttribute("aria-hidden", "true");
      this.canvas.setAttribute("data-active", "false");

      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const onLayoutChange = () => this.requestFrame();
      window.addEventListener("resize", onLayoutChange, { passive: true });
      window.addEventListener("scroll", onLayoutChange, { passive: true, capture: true });

      this.attachCanvas();
      this.resizeToRoot();
    } catch {
      this.available = false;
      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.canvas = null;
    }

    return this.renderer;
  }

  private setRootFrom(element: HTMLElement) {
    const nextRoot = element.closest<HTMLElement>(".playmat-wrapper") ?? document.body;
    if (this.root === nextRoot) return;

    this.root = nextRoot;

    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.requestFrame());
    this.resizeObserver.observe(this.root);

    this.attachCanvas();
    this.resizeToRoot();
  }

  private attachCanvas() {
    if (!this.canvas || !this.root) return;
    if (this.canvas.parentElement !== this.root) this.root.appendChild(this.canvas);
  }

  private resizeToRoot() {
    if (!this.renderer || !this.camera || !this.root) return;

    const rect = this.root.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));

    if (nextWidth === this.width && nextHeight === this.height) return;

    this.width = nextWidth;
    this.height = nextHeight;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(nextWidth, nextHeight, false);

    this.camera.left = 0;
    this.camera.right = nextWidth;
    this.camera.top = nextHeight;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  private requestFrame() {
    if (this.raf !== null || !this.available) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (timeMs: number) => {
    this.raf = null;
    if (!this.renderer || !this.scene || !this.camera || !this.root) return;

    this.resizeToRoot();

    const now = timeMs / 1000;
    // Clamp non-negative — guards against clock skew between performance.now()
    // (used by sync renderInitial) and rAF timestamps.
    const dt = this.lastTime > 0 ? Math.max(0, Math.min(0.05, now - this.lastTime)) : 1 / 60;
    this.lastTime = now;

    const removeQueue: Array<[HTMLElement, ActiveCard]> = [];
    let needsAnotherFrame = false;

    for (const [host, card] of this.active) {
      if (!host.isConnected || !card.surface.isConnected) {
        removeQueue.push([host, card]);
        continue;
      }

      const juiceT = now - card.juiceStart;
      const juiceAlive = juiceT >= 0 && juiceT < BALATRO_JUICE_DURATION;
      const juiceRemaining = juiceAlive ? (BALATRO_JUICE_DURATION - juiceT) / BALATRO_JUICE_DURATION : 0;
      const juiceScale = juiceAlive
        ? BALATRO_JUICE_SCALE_AMT * Math.sin(50.8 * juiceT) * Math.pow(juiceRemaining, 3)
        : 0;
      const juiceRotation = juiceAlive
        ? card.juiceSign * BALATRO_JUICE_ROT_AMT * Math.sin(40.8 * juiceT) * Math.pow(juiceRemaining, 2)
        : 0;

      const desiredScale = this.prefersReducedMotion
        ? 1
        : (BALATRO_CARD_BASE_SCALE + card.targetHover * BALATRO_HOVER_ZOOM + juiceScale) /
          BALATRO_CARD_BASE_SCALE;
      const scaleEase = Math.exp(-BALATRO_SCALE_EASE * dt);
      card.scaleVelocity = scaleEase * card.scaleVelocity + (1 - scaleEase) * (desiredScale - card.visibleScale);
      card.visibleScale += card.scaleVelocity;

      const desiredRotation = this.prefersReducedMotion ? 0 : juiceRotation * 2;
      const rotationEase = Math.exp(-BALATRO_ROTATION_EASE * dt);
      card.rotationVelocity = rotationEase * card.rotationVelocity + (1 - rotationEase) * (desiredRotation - card.rotation);
      card.rotation += card.rotationVelocity;

      this.applyCardTransform(card);

      const restScale = 1;
      const scaleStillMoving =
        Math.abs(card.visibleScale - desiredScale) > 0.0005 || Math.abs(card.scaleVelocity) > 0.0005;
      const rotationStillMoving =
        Math.abs(card.rotation - desiredRotation) > 0.0005 || Math.abs(card.rotationVelocity) > 0.0005;
      const atRest =
        card.targetHover === 0 &&
        !juiceAlive &&
        !scaleStillMoving &&
        !rotationStillMoving &&
        Math.abs(card.visibleScale - restScale) < 0.001;

      if (!atRest) needsAnotherFrame = true;
    }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    for (const [host, card] of removeQueue) this.removeActive(host, card);

    if (this.active.size === 0) {
      this.lastTime = 0;
      this.setOverlayActive(false);
      return;
    }

    if (needsAnotherFrame) {
      this.requestFrame();
    } else {
      // All cards settled; canvas keeps its last frame via preserveDrawingBuffer.
      this.lastTime = 0;
    }
  };

  private removeActive(host: HTMLElement, card: ActiveCard) {
    this.scene?.remove(card.mesh);
    card.material.dispose();
    this.active.delete(host);
    host.removeAttribute("data-balatro-active");
  }

  private setOverlayActive(active: boolean) {
    if (!this.canvas) return;
    this.canvas.setAttribute("data-active", String(active));
  }
}

let sharedRenderer: BalatroCardHoverRenderer | null = null;

function getBalatroCardHoverRenderer() {
  sharedRenderer ??= new BalatroCardHoverRenderer();
  return sharedRenderer;
}

export default function BalatroHoverCard({
  cardId,
  renderedWidth,
  alt,
  priority = false,
  className,
}: BalatroHoverCardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) return;

    const renderer = getBalatroCardHoverRenderer();
    renderer.register(cardId, host, surface);

    const handlePointerEnter = (event: PointerEvent) => {
      renderer.hover(host, event);
    };
    const handlePointerMove = (event: PointerEvent) => {
      renderer.move(host, event);
    };
    const handlePointerLeave = () => {
      renderer.unhover(host);
    };

    host.addEventListener("pointerenter", handlePointerEnter);
    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      host.removeEventListener("pointerenter", handlePointerEnter);
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerleave", handlePointerLeave);
      renderer.unregister(host);
    };
  }, [cardId]);

  return (
    <div ref={hostRef} className={`balatro-hover-card ${className ?? ""}`.trim()}>
      <div ref={surfaceRef} className="balatro-hover-card__surface">
        <CardImage
          cardId={cardId}
          renderedWidth={renderedWidth}
          alt={alt}
          priority={priority}
          className="balatro-hover-card__image"
        />
      </div>
    </div>
  );
}
