// CardView animation tuning — calibrated against Balatro's source.
// References (all paths relative to /home/jofre/projects/balatro-source):
//   - engine/moveable.lua:250-276  juice_up/move_juice: oscillating decay,
//     sin(50.8t) scale with cubic envelope, sin(40.8t) rotation with squared
//     envelope, 0.4s duration. Initial VT.scale = 1 - 0.6*amount (squish).
//   - engine/moveable.lua:405-421  move_xy: velocity = exp(-50*dt)*velocity
//     + (1-exp(-50*dt))*(T-VT)*35*dt, plus max_vel = 70*dt clamp.
//   - engine/moveable.lua:423-432  move_scale: damping coefficient ≈ 60.
//   - engine/moveable.lua:447-457  move_r: damping coefficient ≈ 190 (very
//     snappy) and drag rotation factor 0.015*vel.x/dt.
//   - card.lua:4306-4338  hover juice = juice_up(0.05, 0.03), which becomes
//     scale_amt 0.02 / rot_amt 0.012 after Card's *0.4 override.
//   - card.lua:4333-4338  Card override: scale*0.4 and rot*0.4 of defaults.
//   - card.lua:16  ambient_tilt = 0.2, drives subtle idle tilt at the
//     frequency time*(1.56 + per-card factor).
//   - card.lua:4370-4383  pointer-driven tilt feeds the virtual cursor
//     (tilt_var.mx/my) to the vertex shader.
//   - resources/shaders/dissolve.fs:74-85  vertex shader modifies clip-space
//     W by scale = 0.2*F*hovering*|mouse_offset|²/D where F ≈ -0.06 and
//     D ≈ 1.8 for a card near the screen center; |mouse_offset| is the
//     per-vertex distance to the cursor, divided by one tile size. The
//     resulting perspective divide displaces each corner radially outward
//     from the projection origin, with the corner farthest from the cursor
//     moving the most — that's the "lean away from cursor" feel.
//   - engine/moveable.lua:424  hover adds +0.05 scale, drag +0.10 → 1.05/1.10.
//   - game.lua:2618-2624  exp_times constants (50/60/190) driving move_xy,
//     move_scale, move_r damping respectively.
import { Container, Graphics, ImageSource, PerspectiveMesh, Texture } from "pixi.js";
import { gsap } from "../../../lib/animation/gsapPixi";
import {
  evaluateJuice as evaluateJuiceEnvelope,
  initialSquish,
  type JuiceState,
  startJuice,
} from "../../../lib/animation/juice";
import {
  clampVelocity,
  dragTiltFromVelocity,
  SPRING_C_ROT_DRAG,
  SPRING_MAX_DT,
  stepSpringScalar,
  stepSpringXY,
} from "../../../lib/animation/spring";
import type { CardPlacement } from "../types";
import { cardBackTexture, parseBackUrl } from "./cardBackTexture";

const CARD_ASPECT_RATIO = 3.5 / 2.5;

// Idle/ambient — Balatro's ambient_tilt = 0.2 (card.lua:16); we add a tiny
// Y-float (not in Balatro) but keep it small to stay in the same register.
const IDLE_ROTATION_AMOUNT = 0.012;
const IDLE_FLOAT_AMOUNT = 1.6;

// The spring + juice physics live in lib/animation/{spring,juice} (shared with
// the decks drag). These three are CardView-specific tuning layered on top.
const SPRING_C_SCALE = 60; // scale-spring damping (game.lua:2619)
// Idle/reorder rotation damping — between Balatro's drag value (20) and a
// critically damped settle, so siblings sliding into new slots tilt with less
// wobble than a full drag.
const SPRING_C_ROT_IDLE = 45;
// Velocity-driven tilt is damped for non-dragged cards: a reorder shift has as
// much X-velocity as a drag, but should read as a hint, not a swing.
const IDLE_VELOCITY_TILT_SCALE = 0.35;

// Perspective tilt — Balatro's vertex shader (resources/shaders/dissolve.fs)
// modifies clip-space W by:
//   scale = 0.2*F*hovering*|mouse_offset|²/(2 - mid_dist)
// with F = -0.03 - 0.3*max(0, 0.3 - mid_dist). For a card whose centre sits
// in the busy middle of the screen, mid_dist ≈ 0.1–0.3 → F ≈ −0.07 and the
// denominator ≈ 1.8, so the constant gain works out to ~−0.0078. We bake
// those into a single K below and scale by intensity (1 when actively
// hovered, smaller while idle). |mouse_offset| is the per-corner pixel
// distance to the cursor, divided by one "tile size" (= one card width in
// Balatro). The displacement is radial: each corner moves outward from the
// projection origin by `1/(1+scale_i)`, so the corner farthest from the
// cursor moves the most.
const TILT_F = -0.07;
const TILT_D = 1.8;
const TILT_K = (0.2 * TILT_F) / TILT_D; // ≈ -0.0078, matches Balatro near centre

// Mesh subdivision — Balatro's quad uses GPU-side perspective-correct
// interpolation across 4 vertices, but Pixi's PerspectiveMesh approximates
// the homography by tessellating into a grid and doing affine interp inside
// each cell. Too few cells (e.g. 8×8) leaves visible cell seams that swim
// around the texture as the warp updates ("watery" feel); 24×24 makes the
// seams imperceptibly small at the cost of ~600 vertices per card. We
// still pay only one homography solve + per-vertex matmul per frame.
const TILT_VERTICES_X = 24;
const TILT_VERTICES_Y = 24;

// Ambient tilt — card.lua:16/4380-4383. The virtual cursor orbits inside
// the card at radius 0.5*ambient_tilt*card_size, animated at the per-card
// frequency time*(1.56 + ID factor). ambient_tilt = 0.2 in Balatro.
const AMBIENT_TILT = 0.2;

// Directional hover lift — how far an edge card slides outward when
// hovered. Cards near the playmat centre barely move; cards at the
// corners reach this magnitude in screen pixels. Hand cards opt out
// (computeHoverOffset returns {0,0} for them).
const HOVER_LIFT_MAX_PX = 12;

// Back-card placements (deck pile + prize cards) live at the far edges
// of the playmat, which would push them out the full HOVER_LIFT_MAX_PX.
// That made them feel showier than the playable cards, which mostly sit
// closer to centre. Scale their radial lift down so the magnitude reads
// in the same register as the bench cards.
const BACK_HOVER_LIFT_SCALE = 0.4;

const textureCache = new Map<string, Promise<Texture>>();

export interface CardViewTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  placement: CardPlacement;
}

export type HoverMode = "full" | "juice-only";

export interface CardViewPresentationOptions {
  // "juice-only" suppresses the emphasis scale, radial lift, and mesh tilt
  // when hovered, keeping just the juice pop. Used for attached tool/energy
  // cards, where the host Pokémon already owns the hover gesture.
  hoverMode?: HoverMode;
  // Keep cards that have visible DOM slots (deck/prizes) squarely aligned to
  // those slots instead of applying idle float/rotation or mesh warp.
  slotLocked?: boolean;
  // Clips the card to a strip at the top/bottom of its own local card space.
  // This crops away the part that should be hidden behind the host Pokémon
  // instead of relying on the host texture to cover it perfectly at
  // corners/warped edges.
  clipTopFraction?: number | null;
  clipBottomFraction?: number | null;
}

export interface CardViewOptions extends CardViewPresentationOptions {
  id: string;
  name: string;
  textureUrl: string;
  seed: number;
  reducedMotion: boolean;
}

export interface ReleaseVelocity {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function targetAspectHeight(width: number) {
  return width * CARD_ASPECT_RATIO;
}

async function fetchBitmap(textureUrl: string): Promise<ImageBitmap> {
  const response = await fetch(textureUrl, {
    mode: "cors",
    credentials: "omit",
    // Don't leak the app URL to the third-party card-image CDN.
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    throw new Error(`Unable to load card texture: ${textureUrl} (${response.status})`);
  }
  const blob = await response.blob();
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function loadTexture(textureUrl: string) {
  // Synthetic card-back URLs (`back://<design>/<tone>`, e.g. `back://rays/blue`)
  // bypass the fetch→blob→createImageBitmap path because createImageBitmap on
  // SVG blobs is unreliable; cardBackTexture decodes via an <img> instead.
  const back = parseBackUrl(textureUrl);
  if (back) {
    return cardBackTexture(back.design, back.tone);
  }

  const cached = textureCache.get(textureUrl);

  if (cached) {
    return cached;
  }

  // Mipmaps + linear filtering give crisp downscaling at small sizes.
  // The card renders at ~140 CSS px (≤ 280 device px @ DPR 2) from a
  // 733×1024 source — without mipmaps, default linear filter alone produces
  // muddy >2× downsampling. With auto-generated mipmaps Pixi samples from
  // the right level. NOTE: autoGenerateMipmaps is a no-op unless
  // mipLevelCount > 1, so we set the level count explicitly.
  const promise = fetchBitmap(textureUrl).then((bitmap) => {
    const mipLevelCount = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
    const source = new ImageSource({
      resource: bitmap,
      autoGenerateMipmaps: true,
      scaleMode: "linear",
      mipLevelCount,
    });
    return new Texture({ source });
  });

  textureCache.set(textureUrl, promise);
  return promise.catch((error) => {
    textureCache.delete(textureUrl);
    throw error;
  });
}

export class CardView {
  readonly container = new Container();

  readonly id: string;

  private readonly lift = new Container();

  private readonly emphasisScale = new Container();

  private readonly pressSquash = new Container();

  private readonly juice = new Container();

  private readonly cardLayer = new Container();

  private readonly placeholder = new Graphics();

  private readonly clipMask = new Graphics();

  private readonly cardMesh: PerspectiveMesh;

  private readonly seed: number;

  private reducedMotion: boolean;

  private hoverMode: HoverMode;

  private slotLocked: boolean;

  private clipTopFraction: number | null;

  private clipBottomFraction: number | null;

  private current = { x: 0, y: 0, rotation: 0, scale: 1 };

  private velocity = { x: 0, y: 0, rotation: 0, scale: 0 };

  private target: CardViewTarget | null = null;

  private textureUrl = "";

  private textureLoadId = 0;

  private destroyed = false;

  private loaded = false;

  private hovered = false;

  private pressed = false;

  private dragging = false;

  private linkedDragging = false;

  private hoverPoint: { x: number; y: number } | null = null;

  private revealOffset = { x: 0, y: 0 };

  private holdTween: gsap.core.Tween | null = null;

  private zIndexReturnTween: gsap.core.Tween | null = null;

  private introCall: gsap.core.Tween | null = null;

  private juiceState: JuiceState | null = null;

  private playmatSize = { width: 0, height: 0 };

  private lastDrawWidth = -1;

  private lastDrawHeight = -1;

  private lastDrawLoaded = false;

  constructor(options: CardViewOptions) {
    this.id = options.id;
    this.seed = options.seed;
    this.reducedMotion = options.reducedMotion;
    this.hoverMode = options.hoverMode ?? "full";
    this.slotLocked = options.slotLocked ?? false;
    this.clipTopFraction = options.clipTopFraction ?? null;
    this.clipBottomFraction = options.clipBottomFraction ?? null;

    this.cardMesh = new PerspectiveMesh({
      texture: Texture.WHITE,
      verticesX: TILT_VERTICES_X,
      verticesY: TILT_VERTICES_Y,
      // Centred on (0,0) in card-local space so container transforms (lift,
      // scale, juice, rotation) apply symmetrically. updateMeshCorners
      // overrides these every frame once a target is set.
      x0: -50,
      y0: -targetAspectHeight(100) / 2,
      x1: 50,
      y1: -targetAspectHeight(100) / 2,
      x2: 50,
      y2: targetAspectHeight(100) / 2,
      x3: -50,
      y3: targetAspectHeight(100) / 2,
    });
    // roundPixels was great for the old Sprite (whole-pixel raster cleanup
    // for the idle float), but on a per-frame-warped mesh it snaps every
    // vertex to integer pixels and that quantisation drifts as corners
    // move sub-pixel amounts → that's the "watery" shimmer. Let the GPU
    // handle sub-pixel sampling; the texture's linear filter + mipmaps
    // give clean rendering even at non-integer offsets.
    this.cardMesh.roundPixels = false;
    this.cardMesh.alpha = 0;

    this.container.addChild(this.lift);
    this.lift.addChild(this.emphasisScale);
    this.emphasisScale.addChild(this.pressSquash);
    this.pressSquash.addChild(this.juice);
    this.juice.addChild(this.cardLayer);
    this.cardLayer.addChild(this.placeholder, this.cardMesh, this.clipMask);

    this.setTextureUrl(options.textureUrl);
    this.redrawCard(options.name, 100, targetAspectHeight(100));
  }

  get placement() {
    return this.target?.placement ?? null;
  }

  get zIndex() {
    return this.container.zIndex;
  }

  get isDragging() {
    return this.dragging || this.linkedDragging;
  }

  getPosition() {
    return { x: this.current.x, y: this.current.y };
  }

  getTargetSnapshot(): CardViewTarget | null {
    return this.target ? { ...this.target, placement: { ...this.target.placement } } : null;
  }

  setPresentationOptions(options: CardViewPresentationOptions) {
    this.hoverMode = options.hoverMode ?? "full";
    this.slotLocked = options.slotLocked ?? false;

    const nextClipTopFraction = options.clipTopFraction ?? null;
    const nextClipBottomFraction = options.clipBottomFraction ?? null;
    if (
      this.clipTopFraction === nextClipTopFraction &&
      this.clipBottomFraction === nextClipBottomFraction
    ) {
      return;
    }

    this.clipTopFraction = nextClipTopFraction;
    this.clipBottomFraction = nextClipBottomFraction;
    const width = this.target?.width ?? 100;
    const height = this.target?.height ?? targetAspectHeight(width);
    this.updateClipMask(width, height);
  }

  setTextureUrl(textureUrl: string) {
    if (this.textureUrl === textureUrl) {
      return;
    }

    // Swapping the texture on an already-loaded card (e.g. cycling the card-back
    // design) earns a gentle juice pop on top of the alpha fade, reusing the
    // exact juice primitive normal cards use — so the change reads as an
    // intentional "flip" rather than a silent repaint. First loads don't pop.
    const isSwap = this.loaded;

    this.textureUrl = textureUrl;
    this.loaded = false;
    this.placeholder.visible = true;
    this.cardMesh.alpha = 0;
    const loadId = ++this.textureLoadId;

    loadTexture(textureUrl)
      .then((texture) => {
        if (this.destroyed || loadId !== this.textureLoadId) {
          return;
        }

        this.cardMesh.texture = texture;
        // The texture swap auto-refreshes the geometry's source dimensions
        // (PerspectiveMesh.textureUpdated). Re-apply our current corners so
        // the warp stays put across the swap rather than snapping to the
        // texture's native pixel rect.
        this.refreshMeshCornersAfterTextureSwap();
        this.loaded = true;
        this.placeholder.visible = false;
        gsap.to(this.cardMesh, {
          duration: this.reducedMotion ? 0 : 0.16,
          ease: "power2.out",
          pixi: { alpha: 1 },
        });
        if (isSwap && !this.reducedMotion) {
          this.juiceUp(0.03, (this.seed > 0.5 ? 1 : -1) * 0.05);
        }
      })
      .catch((error) => {
        if (!this.destroyed) {
          this.loaded = false;
          this.placeholder.visible = true;
          // Keep the graceful grey placeholder, but make the failure observable
          // instead of swallowing it (a CDN/CORS outage is otherwise invisible).
          console.warn(`CardView: texture failed to load for "${this.id}" (${textureUrl})`, error);
        }
      });
  }

  setTarget(target: CardViewTarget) {
    const isFirstTarget = !this.target;
    this.target = target;
    this.container.visible = true;
    this.container.zIndex = this.dragging ? 10_000 : target.zIndex;
    this.redrawCard(this.id, target.width, target.height);

    if (isFirstTarget) {
      const skipIntroMotion = this.reducedMotion || this.slotLocked;
      const introOffset = skipIntroMotion ? 0 : Math.min(100, target.height * 0.55);
      this.current = {
        x: target.x,
        y: target.y + introOffset,
        rotation: target.rotation + (skipIntroMotion ? 0 : 0.16),
        scale: skipIntroMotion ? 1 : 0.86,
      };
      this.velocity = { x: 0, y: 0, rotation: 0, scale: 0 };
      this.applyCurrentTransform();

      if (!skipIntroMotion) {
        // Subtle entrance pop — matches Balatro's hover juice register
        // (card.lua:4307 -> 0.02 scale_amt after Card scaling).
        this.introCall = gsap.delayedCall(0.04 + this.seed * 0.08, () => this.juiceUp(0.02, 0.012));
      }
    } else if (this.slotLocked) {
      // Deck/prize backs are visual stand-ins for fixed DOM slots. They
      // should stay glued to those slots during layout changes instead of
      // springing from their previous measurement like draggable cards do.
      this.current = {
        x: target.x,
        y: target.y,
        rotation: target.rotation,
        scale: 1,
      };
      this.velocity = { x: 0, y: 0, rotation: 0, scale: 0 };
      this.applyCurrentTransform();
    }
  }

  hide() {
    this.container.visible = false;
  }

  setPlaymatSize(width: number, height: number) {
    this.playmatSize = { width, height };
  }

  setReducedMotion(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
  }

  setHovered(hovered: boolean) {
    if (this.hovered === hovered || this.isDragging) {
      return;
    }

    this.hovered = hovered;
    if (!hovered) {
      this.hoverPoint = null;
    }

    // juice-only suppresses lift/scale/tilt entirely (attached tools/energies
    // shouldn't fight their host for the hover gesture). Only the juice
    // pop fires below.
    if (this.hoverMode !== "juice-only") {
      this.applyEmphasisTween();
    }

    if (hovered && !this.reducedMotion && !this.slotLocked) {
      // Balatro card.lua:4307 — hover juice_up(0.05, 0.03), which becomes
      // scale_amt 0.02, rot_amt 0.012 after card.lua:4333-4338 scaling.
      this.juiceUp(0.02, 0.012);
    }
  }

  updateHoverPoint(point: { x: number; y: number }) {
    if (this.hovered && this.hoverMode !== "juice-only") {
      this.hoverPoint = point;
    }
  }

  setRevealOffset(offset: { x: number; y: number }) {
    this.revealOffset = offset;
  }

  startPress() {
    if (this.pressed) {
      return;
    }

    this.pressed = true;
    gsap.killTweensOf(this.pressSquash);
    this.holdTween?.kill();

    // Press squash: very small inward squish then settle. Balatro's press
    // is barely perceptible — most of the feedback comes from the hover
    // scale already being applied. Keep this restrained.
    gsap
      .timeline()
      .to(this.pressSquash, {
        duration: this.reducedMotion ? 0 : 0.05,
        ease: "power2.out",
        pixi: { scaleX: 0.99, scaleY: 1.01, rotation: -0.12 },
      })
      .to(this.pressSquash, {
        duration: this.reducedMotion ? 0 : 0.11,
        ease: "back.out(2)",
        pixi: { scaleX: 1.004, scaleY: 0.996, rotation: 0.06 },
        onComplete: () => this.startHoldTween(),
      });
  }

  stopPress() {
    this.pressed = false;
    this.holdTween?.kill();
    this.holdTween = null;
    gsap.to(this.pressSquash, {
      duration: this.reducedMotion ? 0 : 0.14,
      ease: "power3.out",
      pixi: { scaleX: 1, scaleY: 1, rotation: 0 },
    });
  }

  startDrag() {
    this.dragging = true;
    this.hovered = false;
    this.hoverPoint = null;
    this.zIndexReturnTween?.kill();
    this.container.zIndex = 10_000;
    this.applyEmphasisTween();

    if (!this.reducedMotion) {
      // Pickup pop — between hover (0.02) and a "card_played" pop (0.11);
      // calibrated against typical interactive juice calls in card.lua.
      this.juiceUp(0.04, 0.02);
    }
  }

  startLinkedDrag(zIndex: number) {
    this.linkedDragging = true;
    this.hovered = false;
    this.hoverPoint = null;
    this.zIndexReturnTween?.kill();
    this.container.zIndex = zIndex;
    this.startPress();
    this.applyEmphasisTween();

    if (!this.reducedMotion) {
      this.juiceUp(0.04, 0.02);
    }
  }

  dragTo(x: number, y: number) {
    if (!this.target) {
      return;
    }

    // Drag rotation comes entirely from `velocityRotation` in update() —
    // i.e. the position spring's own velocity, the way Balatro does it
    // (moveable.lua:448: 0.015*vel.x/dt). Feeding raw pointer velocity
    // straight into target.rotation made slow drags shake (the per-event
    // velocity is noisy at low cursor speeds), and the smooth decay of
    // that buffered value left no impulse for the rotation spring to
    // overshoot on. Holding rotation at 0 means the rotation comes only
    // from real spring momentum.
    this.target = { ...this.target, x, y, rotation: 0 };
  }

  release(velocity: ReleaseVelocity, accepted: boolean) {
    this.dragging = false;
    this.hovered = false;
    this.hoverPoint = null;
    this.applyReleaseMotion(velocity, accepted);
  }

  releaseLinkedDrag(velocity: ReleaseVelocity, accepted: boolean) {
    this.linkedDragging = false;
    this.hovered = false;
    this.hoverPoint = null;
    this.stopPress();
    this.applyReleaseMotion(velocity, accepted);
  }

  clickPunch() {
    if (!this.reducedMotion) {
      // Click pop — toned down from Balatro's raw 0.11 default. With the
      // press squash + hover scale already stacking on the click frame, a
      // small juice pulse is enough to register without overshooting.
      this.juiceUp(0.05, (this.seed > 0.5 ? 1 : -1) * 0.08);
    }
  }

  private applyReleaseMotion(velocity: ReleaseVelocity, accepted: boolean) {
    if (accepted) {
      // Accepted drop: tiny velocity nudge gives a little overshoot before
      // the spring settles into the new slot.
      this.velocity.x += clamp(velocity.x * 0.01, -14, 14);
      this.velocity.y += clamp(velocity.y * 0.01, -14, 14);
    }
    // Rejected drop: NO velocity injection — let the spring snap the card
    // straight back to its source slot, the way Balatro does.

    this.applyEmphasisTween();

    if (!this.reducedMotion) {
      if (accepted) {
        // Accepted release — mild pop on land, much less than the raw
        // 0.12 Balatro value once you account for press squash + hover
        // scale already stacking on the same frame.
        this.juiceUp(0.07, clamp(velocity.x * 0.00008, -0.06, 0.06));
      } else {
        // Rejected "no" wobble — slight scale + a brief rotational shake.
        this.juiceUp(0.025, (this.seed > 0.5 ? 1 : -1) * 0.18);
      }
    }

    this.zIndexReturnTween?.kill();
    this.zIndexReturnTween = gsap.delayedCall(this.reducedMotion ? 0 : 0.28, () => {
      if (!this.isDragging && this.target) {
        this.container.zIndex = this.target.zIndex;
      }
    });
  }

  update(dt: number, time: number) {
    if (!this.target || !this.container.visible) {
      return;
    }

    const clampedDt = Math.min(dt, SPRING_MAX_DT);
    const idle = this.idleOffset(time);
    const juice = this.evaluateJuice(time);
    const desired = {
      x: this.target.x + this.revealOffset.x,
      y: this.target.y + this.revealOffset.y + idle.y,
      rotation: this.target.rotation + idle.rotation,
      scale: 1,
    };

    // xy spring — Balatro's exact model: exp(-50*dt) damping, *35 stiffness,
    // velocity capped at 70*dt. Same model whether dragging or settling.
    this.current.x = this.springXY(this.current.x, desired.x, "x", clampedDt);
    this.current.y = this.springXY(this.current.y, desired.y, "y", clampedDt);

    // Rotation spring — Balatro: T.r + 0.015*vel.x/dt drives drag tilt
    // (moveable.lua:448). dragTiltFromVelocity (lib/animation/spring) reads the
    // *uncapped* velocity before clampXyVelocity squashes it — reading the
    // clamped value would peg rotation at <2° regardless of drag speed. Drag
    // tilts fully; reorder siblings tilt at a fraction (IDLE_VELOCITY_TILT_SCALE)
    // so they react to the slide without wobbling.
    const tiltScale = this.isDragging ? 1 : IDLE_VELOCITY_TILT_SCALE;
    const velocityRotation = dragTiltFromVelocity(this.velocity.x, clampedDt, tiltScale);
    this.clampXyVelocity(clampedDt);
    this.current.rotation = this.springScalar(
      this.current.rotation,
      desired.rotation + velocityRotation,
      "rotation",
      clampedDt,
      this.isDragging ? SPRING_C_ROT_DRAG : SPRING_C_ROT_IDLE,
      1,
    );

    // Scale spring — damping coefficient 60 (game.lua:2619).
    this.current.scale = this.springScalar(
      this.current.scale,
      desired.scale,
      "scale",
      clampedDt,
      SPRING_C_SCALE,
      1,
    );

    this.applyCurrentTransform();
    this.applyJuiceTransform(juice);
    this.updateMeshCorners(time);
  }

  hitTest(point: { x: number; y: number }) {
    if (!this.target || !this.container.visible) {
      return false;
    }

    const cos = Math.cos(-this.current.rotation);
    const sin = Math.sin(-this.current.rotation);
    const dx = point.x - this.current.x;
    const dy = point.y - this.current.y;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos - this.lift.y;
    const width = this.target.width * this.current.scale * Math.max(this.emphasisScale.scale.x, 1);
    const height =
      this.target.height * this.current.scale * Math.max(this.emphasisScale.scale.y, 1);

    return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
  }

  destroy() {
    this.destroyed = true;
    this.holdTween?.kill();
    this.zIndexReturnTween?.kill();
    this.introCall?.kill();
    this.juiceState = null;
    gsap.killTweensOf([
      this.container,
      this.lift,
      this.emphasisScale,
      this.pressSquash,
      this.juice,
      this.cardMesh,
    ]);
    this.container.destroy({ children: true });
  }

  private springXY(current: number, desired: number, key: "x" | "y", dt: number) {
    return stepSpringXY(current, desired, dt, this.velocity, key);
  }

  private clampXyVelocity(dt: number) {
    clampVelocity(this.velocity, dt);
  }

  private springScalar(
    current: number,
    desired: number,
    key: keyof typeof this.velocity,
    dt: number,
    coefficient: number,
    stiffness: number,
  ) {
    return stepSpringScalar(current, desired, dt, coefficient, this.velocity, key, stiffness);
  }

  private idleOffset(time: number) {
    if (this.reducedMotion || this.slotLocked) {
      return { y: 0, rotation: 0 };
    }

    const phase = this.seed * Math.PI * 2;
    const xPhase = (this.target?.x ?? 0) * 0.012;

    return {
      y: IDLE_FLOAT_AMOUNT * Math.sin(0.666 * time + xPhase + phase),
      rotation: IDLE_ROTATION_AMOUNT * Math.sin(2 * time + xPhase + phase),
    };
  }

  private applyCurrentTransform() {
    this.container.position.set(this.current.x, this.current.y);
    this.container.rotation = this.current.rotation;
    this.container.scale.set(this.current.scale);
  }

  private updateMeshCorners(time: number) {
    if (!this.target) {
      return;
    }

    const halfW = this.target.width / 2;
    const halfH = this.target.height / 2;

    if (this.reducedMotion || this.slotLocked) {
      this.cardMesh.setCorners(-halfW, -halfH, halfW, -halfH, halfW, halfH, -halfW, halfH);
      return;
    }

    // Balatro's screen_scale (sprite.lua:97) is one TILESIZE * TILESCALE.
    // From globals.lua:269-274, TILESIZE = 20 and CARD_W = 2.049 tiles, so
    // screen_scale ≈ card_width / 2.05 — i.e. roughly half the card width.
    // Using full card width here makes the |mouse_offset|² term ~4x too
    // small and the tilt nearly invisible on our card sizes.
    const screenScale = this.target.width * 0.5;

    // Virtual cursor position in card-local space (origin at card centre).
    // Hover → real cursor. Idle → ambient orbit inside the card (card.lua
    // 4380-4383: 0.5 + 0.5*ambient_tilt*cos(angle) of the card's own size).
    let cursorX: number;
    let cursorY: number;
    let intensity: number;

    if (this.hovered && this.hoverPoint) {
      cursorX = this.hoverPoint.x - this.current.x;
      cursorY = this.hoverPoint.y - this.current.y;
      intensity = 1;
    } else {
      const angle = time * (1.56 + this.seed) + this.seed * 9.7;
      cursorX = AMBIENT_TILT * Math.cos(angle) * halfW;
      cursorY = AMBIENT_TILT * Math.sin(angle) * halfH;
      // Balatro keeps `hovering = 1` in the shader even at rest (card.lua
      // 4343), and the visible idle warp comes purely from the cursor
      // orbiting through the card. Cut intensity a hair so the idle effect
      // reads as quieter than an active hover.
      intensity = 0.6;
    }

    const K = TILT_K * intensity;

    // For each corner: scale_i = K * |corner - cursor|² / screenScale². New
    // local position = corner / (1 + scale_i). Scale is negative so the
    // factor (1+scale)⁻¹ > 1 and the corner pushes outward — most for the
    // corner farthest from the cursor, which is what creates the "lean
    // away from cursor" feel.
    const project = (lx: number, ly: number) => {
      const ox = (lx - cursorX) / screenScale;
      const oy = (ly - cursorY) / screenScale;
      const s = K * (ox * ox + oy * oy);
      const factor = 1 / (1 + s);
      return [lx * factor, ly * factor] as const;
    };

    const [x0, y0] = project(-halfW, -halfH);
    const [x1, y1] = project(halfW, -halfH);
    const [x2, y2] = project(halfW, halfH);
    const [x3, y3] = project(-halfW, halfH);

    this.cardMesh.setCorners(x0, y0, x1, y1, x2, y2, x3, y3);
  }

  private refreshMeshCornersAfterTextureSwap() {
    // PerspectiveMesh.textureUpdated re-runs `updateProjection` against the
    // current corners. If we just swapped textures (1×1 white → real card
    // texture), the geometry now has the right source dimensions but the
    // last per-frame corners are still valid in destination space — the
    // next `update` will overwrite them, but until then we want a sensible
    // default so the card doesn't flash at a stale size.
    if (!this.target) {
      return;
    }
    const halfW = this.target.width / 2;
    const halfH = this.target.height / 2;
    this.cardMesh.setCorners(-halfW, -halfH, halfW, -halfH, halfW, halfH, -halfW, halfH);
  }

  private applyEmphasisTween() {
    // Balatro adds +0.05 scale on hover, +0.10 on drag (moveable.lua:424),
    // so 1.05 / 1.10 are the canonical values. The lift offset is our
    // addition: instead of a constant upward nudge, board cards slide
    // outward radially from the playmat centre so a corner card pushes
    // toward its corner. Hand cards are exempt (computeHoverOffset
    // returns 0/0 for them).
    const offset = this.computeHoverOffset();
    const isPickedUp = this.isDragging;
    const dragLift = this.computeDragLiftOffset();
    const liftX = isPickedUp ? dragLift.x : this.hovered ? offset.x : 0;
    const liftY = isPickedUp ? dragLift.y : this.hovered ? offset.y : 0;
    const scale = isPickedUp ? 1.1 : this.hovered ? 1.03 : 1;
    gsap.to(this.lift, {
      duration: this.reducedMotion ? 0 : 0.16,
      ease: "power3.out",
      pixi: { x: liftX, y: liftY },
    });
    gsap.to(this.emphasisScale, {
      duration: this.reducedMotion ? 0 : 0.16,
      ease: "power3.out",
      pixi: { scale },
    });
  }

  private computeDragLiftOffset(): { x: number; y: number } {
    // `lift` lives inside the rotating card container. Convert the desired
    // screen-space pickup lift (straight up) into card-local coordinates so
    // sideways attached cards pop upward with their host instead of sliding
    // sideways along their own rotated axis.
    const rotation = this.target?.rotation ?? 0;
    return {
      x: -14 * Math.sin(rotation),
      y: -14 * Math.cos(rotation),
    };
  }

  private computeHoverOffset(): { x: number; y: number } {
    if (!this.target || this.target.placement.zone === "hand") {
      return { x: 0, y: 0 };
    }
    const { width, height } = this.playmatSize;
    if (width <= 0 || height <= 0) {
      return { x: 0, y: 0 };
    }
    // Linear radial scaling from playmat centre. A card sitting exactly
    // at the centre gets zero offset; a card at the far edge gets
    // HOVER_LIFT_MAX_PX in its direction. Half-size in each axis is the
    // natural normaliser so the offset reads symmetrically regardless of
    // playmat aspect ratio.
    const halfW = width / 2;
    const halfH = height / 2;
    const dx = this.target.x - halfW;
    const dy = this.target.y - halfH;
    const isBack =
      this.target.placement.zone === "stadium" && this.target.placement.owner !== "global";
    const scale = isBack ? BACK_HOVER_LIFT_SCALE : 1;
    return {
      x: (dx / halfW) * HOVER_LIFT_MAX_PX * scale,
      y: (dy / halfH) * HOVER_LIFT_MAX_PX * scale,
    };
  }

  private startHoldTween() {
    // Skip the breathing yoyo while the card is actively being dragged —
    // pointerdown sets both `pressed` and `dragging`, and the user reads
    // that subtle wobble as the card "fidgeting" in their hand instead
    // of following the cursor cleanly.
    if (!this.pressed || this.isDragging || this.reducedMotion) {
      return;
    }

    this.holdTween?.kill();
    // Subtle breathing while held (not in Balatro, our addition).
    this.holdTween = gsap.to(this.pressSquash, {
      duration: 0.5,
      ease: "sine.inOut",
      repeat: -1,
      yoyo: true,
      pixi: { scaleX: 1.014, scaleY: 0.986, rotation: 0.9 },
    });
  }

  private juiceUp(amount: number, rotationAmount: number) {
    if (this.destroyed) {
      return;
    }
    // Match Balatro's move_juice envelope (moveable.lua:267-276):
    //   scale = scale_amt * sin(50.8*t) * (remaining/total)^3
    //   rot   = r_amt    * sin(40.8*t) * (remaining/total)^2
    // Initial squish: VT.scale = 1 - 0.6*amount (moveable.lua:264).
    const now = performance.now() / 1000;
    const fallbackRot = this.seed > 0.5 ? amount * 0.6 : -amount * 0.6;
    this.juiceState = startJuice(amount, rotationAmount || fallbackRot, now);
    // Apply the initial squish synchronously so the first frame already
    // looks pressed; the oscillating decay takes over from there.
    this.juice.scale.set(initialSquish(amount));
    this.juice.rotation = 0;
  }

  private evaluateJuice(time: number) {
    const value = evaluateJuiceEnvelope(this.juiceState, time);
    if (!value) {
      this.juiceState = null;
    }
    return value;
  }

  private applyJuiceTransform(juice: { scale: number; rotation: number } | null) {
    if (!juice) {
      this.juice.scale.set(1);
      this.juice.rotation = 0;
      return;
    }
    this.juice.scale.set(1 + juice.scale);
    // Match move_r's juice multiplier (juice.r*2 in moveable.lua:448).
    this.juice.rotation = juice.rotation * 2;
  }

  private redrawCard(label: string, width: number, height: number) {
    this.cardLayer.label = label;

    // The placeholder geometry only depends on size + load state, and
    // setTarget calls redrawCard on every layout/drag frame. Card size is
    // constant except on resize, so skip the roundRect re-tessellation and
    // clip-mask rebuild when nothing changed — for loaded cards this is
    // almost always a no-op. (Clip-fraction-only changes go through
    // setPresentationOptions -> updateClipMask directly, not through here.)
    if (
      width === this.lastDrawWidth &&
      height === this.lastDrawHeight &&
      this.loaded === this.lastDrawLoaded
    ) {
      return;
    }
    this.lastDrawWidth = width;
    this.lastDrawHeight = height;
    this.lastDrawLoaded = this.loaded;

    const radius = Math.max(3, width * 0.055);

    // The mesh's destination corners are set every frame by
    // updateMeshCorners — no need to size it here.

    this.placeholder
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, radius)
      .fill({ color: 0x161621, alpha: this.loaded ? 0 : 0.92 })
      .stroke({ color: 0xffffff, alpha: 0.08, width: 1 });

    this.updateClipMask(width, height);
  }

  private updateClipMask(width: number, height: number) {
    const topFraction = this.clipTopFraction;
    const bottomFraction = this.clipBottomFraction;

    if (topFraction == null && bottomFraction == null) {
      this.placeholder.mask = null;
      this.cardMesh.mask = null;
      this.clipMask.clear();
      return;
    }

    // A 1px pad avoids a sub-pixel seam along the cropped edge while still
    // leaving the visible strip effectively the same size as the CSS offset.
    const pad = 1;
    const fraction = clamp(topFraction ?? bottomFraction ?? 1, 0, 1);
    const clipHeight = height * fraction;
    const y = topFraction != null ? -height / 2 - pad : height / 2 - clipHeight - pad;
    this.clipMask
      .clear()
      .rect(-width / 2 - pad, y, width + pad * 2, clipHeight + pad * 2)
      .fill({ color: 0xffffff, alpha: 1 });
    this.placeholder.mask = this.clipMask;
    this.cardMesh.mask = this.clipMask;
  }
}
