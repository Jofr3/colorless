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
//   - engine/moveable.lua:424  hover adds +0.05 scale, drag +0.10 → 1.05/1.10.
//   - game.lua:2618-2624  exp_times constants (50/60/190) driving move_xy,
//     move_scale, move_r damping respectively.
import { Container, Graphics, ImageSource, Sprite, Texture } from "pixi.js";
import { gsap } from "../../../lib/animation/gsapPixi";
import type { CardPlacement } from "../types";

const CARD_ASPECT_RATIO = 3.5 / 2.5;

// Idle/ambient — Balatro's ambient_tilt = 0.2 (card.lua:16); we add a tiny
// Y-float (not in Balatro) but keep it small to stay in the same register.
const IDLE_ROTATION_AMOUNT = 0.012;
const IDLE_FLOAT_AMOUNT = 1.6;

// Spring damping coefficients (moveable.lua + game.lua:2618-2624).
const SPRING_C_XY = 50;
const SPRING_C_SCALE = 60;
const SPRING_C_ROT = 190;
// Spring stiffness (moveable.lua:408 — the *35 factor).
const SPRING_K_XY = 35;
// max_vel per frame (moveable.lua:410 + game.lua:2624 — 70*dt).
const SPRING_MAX_VEL = 70;
// Drag rotation tilt coefficient (moveable.lua:448 — 0.015*vel.x/dt).
const DRAG_ROTATION_FACTOR = 0.015;

// Juice (moveable.lua:250-276). 0.4s duration with sinusoidal decay.
const JUICE_DURATION = 0.4;
const JUICE_SCALE_FREQ = 50.8;
const JUICE_ROT_FREQ = 40.8;
const JUICE_INITIAL_SQUISH = 0.6; // VT.scale = 1 - 0.6*amount

const SPRING_MAX_DT = 1 / 30;

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

export interface CardViewOptions {
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
  const response = await fetch(textureUrl, { mode: "cors", credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Unable to load card texture: ${textureUrl} (${response.status})`);
  }
  const blob = await response.blob();
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function loadTexture(textureUrl: string) {
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

interface JuiceState {
  scaleAmt: number;
  rotAmt: number;
  startTime: number;
  endTime: number;
}

export class CardView {
  readonly container = new Container();

  readonly id: string;

  private readonly lift = new Container();

  private readonly emphasisScale = new Container();

  private readonly pressSquash = new Container();

  private readonly juice = new Container();

  private readonly tilt = new Container();

  private readonly cardLayer = new Container();

  private readonly placeholder = new Graphics();

  private readonly sprite = new Sprite(Texture.EMPTY);

  private readonly seed: number;

  private readonly reducedMotion: boolean;

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

  private hoverPoint: { x: number; y: number } | null = null;

  private holdTween: gsap.core.Tween | null = null;

  private zIndexReturnTween: gsap.core.Tween | null = null;

  private juiceState: JuiceState | null = null;

  constructor(options: CardViewOptions) {
    this.id = options.id;
    this.seed = options.seed;
    this.reducedMotion = options.reducedMotion;

    this.container.addChild(this.lift);
    this.lift.addChild(this.emphasisScale);
    this.emphasisScale.addChild(this.pressSquash);
    this.pressSquash.addChild(this.juice);
    this.juice.addChild(this.tilt);
    this.tilt.addChild(this.cardLayer);
    this.cardLayer.addChild(this.placeholder, this.sprite);

    this.sprite.anchor.set(0.5);
    this.sprite.alpha = 0;
    // Snap rasterization to whole device pixels — the idle float runs at
    // sub-pixel amplitudes, and without this the linear filter blurs the
    // image every frame.
    this.sprite.roundPixels = true;

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
    return this.dragging;
  }

  getPosition() {
    return { x: this.current.x, y: this.current.y };
  }

  setTextureUrl(textureUrl: string) {
    if (this.textureUrl === textureUrl) {
      return;
    }

    this.textureUrl = textureUrl;
    this.loaded = false;
    this.placeholder.visible = true;
    this.sprite.alpha = 0;
    const loadId = ++this.textureLoadId;

    loadTexture(textureUrl)
      .then((texture) => {
        if (this.destroyed || loadId !== this.textureLoadId) {
          return;
        }

        this.sprite.texture = texture;
        this.loaded = true;
        this.placeholder.visible = false;
        gsap.to(this.sprite, {
          duration: this.reducedMotion ? 0 : 0.16,
          ease: "power2.out",
          pixi: { alpha: 1 },
        });
      })
      .catch(() => {
        if (!this.destroyed) {
          this.loaded = false;
          this.placeholder.visible = true;
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
      const introOffset = this.reducedMotion ? 0 : Math.min(100, target.height * 0.55);
      this.current = {
        x: target.x,
        y: target.y + introOffset,
        rotation: target.rotation + (this.reducedMotion ? 0 : 0.16),
        scale: this.reducedMotion ? 1 : 0.86,
      };
      this.velocity = { x: 0, y: 0, rotation: 0, scale: 0 };
      this.applyCurrentTransform();

      if (!this.reducedMotion) {
        // Subtle entrance pop — matches Balatro's hover juice register
        // (card.lua:4307 -> 0.02 scale_amt after Card scaling).
        gsap.delayedCall(0.04 + this.seed * 0.08, () => this.juiceUp(0.02, 0.012));
      }
    }
  }

  hide() {
    this.container.visible = false;
  }

  setHovered(hovered: boolean) {
    if (this.hovered === hovered || this.dragging) {
      return;
    }

    this.hovered = hovered;
    if (!hovered) {
      this.hoverPoint = null;
    }

    this.applyEmphasisTween();

    if (hovered && !this.reducedMotion) {
      // Balatro card.lua:4307 — hover juice_up(0.05, 0.03), which becomes
      // scale_amt 0.02, rot_amt 0.012 after card.lua:4333-4338 scaling.
      this.juiceUp(0.02, 0.012);
    }
  }

  updateHoverPoint(point: { x: number; y: number }) {
    if (this.hovered) {
      this.hoverPoint = point;
    }
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

  dragTo(x: number, y: number, pointerVelocity: ReleaseVelocity) {
    if (!this.target) {
      return;
    }

    // Drag rotation: Balatro uses 0.015*vel/dt directly (moveable.lua:448);
    // we receive pointer velocity in px/s, so map roughly to that scale.
    this.target = {
      ...this.target,
      x,
      y,
      rotation: clamp(pointerVelocity.x * 0.0003, -0.22, 0.22),
    };
  }

  release(velocity: ReleaseVelocity, accepted: boolean) {
    this.dragging = false;
    this.hovered = false;
    this.hoverPoint = null;

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
      if (!this.dragging && this.target) {
        this.container.zIndex = this.target.zIndex;
      }
    });
  }

  clickPunch() {
    if (!this.reducedMotion) {
      // Click pop — toned down from Balatro's raw 0.11 default. With the
      // press squash + hover scale already stacking on the click frame, a
      // small juice pulse is enough to register without overshooting.
      this.juiceUp(0.05, (this.seed > 0.5 ? 1 : -1) * 0.08);
    }
  }

  update(dt: number, time: number) {
    if (!this.target || !this.container.visible) {
      return;
    }

    const clampedDt = Math.min(dt, SPRING_MAX_DT);
    const idle = this.idleOffset(time);
    const juice = this.evaluateJuice(time);
    const desired = {
      x: this.target.x,
      y: this.target.y + idle.y,
      rotation: this.target.rotation + idle.rotation,
      scale: 1,
    };

    // xy spring — Balatro's exact model: exp(-50*dt) damping, *35 stiffness,
    // velocity capped at 70*dt. Same model whether dragging or settling.
    this.current.x = this.springXY(this.current.x, desired.x, "x", clampedDt);
    this.current.y = this.springXY(this.current.y, desired.y, "y", clampedDt);
    this.clampXyVelocity(clampedDt);

    // Rotation spring — Balatro: T.r + 0.015*vel.x/dt drives drag tilt
    // (moveable.lua:448). Damping coefficient 190 makes it nearly instant.
    const velocityRotation = clamp(
      (this.velocity.x / Math.max(clampedDt, 0.001)) * DRAG_ROTATION_FACTOR * 0.012,
      -0.22,
      0.22,
    );
    this.current.rotation = this.springScalar(
      this.current.rotation,
      desired.rotation + velocityRotation,
      "rotation",
      clampedDt,
      SPRING_C_ROT,
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
    this.updateTilt(time);
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
    this.juiceState = null;
    gsap.killTweensOf([
      this.container,
      this.lift,
      this.emphasisScale,
      this.pressSquash,
      this.juice,
      this.tilt,
      this.sprite,
    ]);
    this.container.destroy({ children: true });
  }

  private springXY(current: number, desired: number, key: "x" | "y", dt: number) {
    const damping = Math.exp(-SPRING_C_XY * dt);
    this.velocity[key] = damping * this.velocity[key] + (1 - damping) * (desired - current) * SPRING_K_XY * dt;
    const next = current + this.velocity[key];

    if (Math.abs(next - desired) < 0.01 && Math.abs(this.velocity[key]) < 0.01) {
      this.velocity[key] = 0;
      return desired;
    }

    return next;
  }

  private clampXyVelocity(dt: number) {
    const maxVel = SPRING_MAX_VEL * dt;
    const vx = this.velocity.x;
    const vy = this.velocity.y;
    const magSq = vx * vx + vy * vy;

    if (magSq > maxVel * maxVel) {
      const mag = Math.sqrt(magSq);
      this.velocity.x = (vx / mag) * maxVel;
      this.velocity.y = (vy / mag) * maxVel;
    }
  }

  private springScalar(
    current: number,
    desired: number,
    key: keyof typeof this.velocity,
    dt: number,
    coefficient: number,
    stiffness: number,
  ) {
    const damping = Math.exp(-coefficient * dt);
    this.velocity[key] = damping * this.velocity[key] + (1 - damping) * (desired - current) * stiffness;
    const next = current + this.velocity[key];

    if (Math.abs(next - desired) < 0.001 && Math.abs(this.velocity[key]) < 0.001) {
      this.velocity[key] = 0;
      return desired;
    }

    return next;
  }

  private idleOffset(time: number) {
    if (this.reducedMotion || this.dragging) {
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

  private updateTilt(time: number) {
    if (!this.target || this.reducedMotion) {
      this.tilt.rotation = 0;
      this.tilt.skew.set(0, 0);
      return;
    }

    if (this.hoverPoint && this.hovered) {
      // Pointer-driven pseudo-3D tilt. Balatro uses a vertex shader
      // (card.lua:4374-4378) with tilt_factor = 0.3 that rotates the card
      // plane around the perpendicular to the cursor-from-center vector.
      // The 2D equivalent is a pure skew: skew.x leans verticals, skew.y
      // leans horizontals — together they read as a plane tilting toward
      // the cursor edge. No rotation/axial twist (that's the part that
      // felt wrong).
      const dx = clamp((this.hoverPoint.x - this.current.x) / (this.target.width / 2), -1, 1);
      const dy = clamp((this.hoverPoint.y - this.current.y) / (this.target.height / 2), -1, 1);
      const tiltFactor = 0.18;
      this.tilt.rotation = 0;
      this.tilt.skew.set(dy * tiltFactor, -dx * tiltFactor);
      return;
    }

    // Ambient tilt — Balatro uses ambient_tilt = 0.2 with frequency
    // time*(1.56 + per-card ID factor), card.lua:16 + 4380.
    const ambient = 0.2;
    const angle = time * (1.56 + this.seed) + this.seed * 9.7;
    this.tilt.rotation = ambient * 0.018 * Math.sin(angle);
    this.tilt.skew.set(ambient * 0.018 * Math.cos(angle), ambient * 0.014 * Math.sin(angle * 0.83));
  }

  private applyEmphasisTween() {
    // Balatro adds +0.05 scale on hover, +0.10 on drag (moveable.lua:424),
    // so 1.05 / 1.10 are the canonical values. Lift Y is our addition
    // (Balatro stays in-plane); kept modest to read as "card raised".
    const liftY = this.dragging ? -14 : this.hovered ? -8 : 0;
    const scale = this.dragging ? 1.1 : this.hovered ? 1.05 : 1;
    gsap.to(this.lift, {
      duration: this.reducedMotion ? 0 : 0.16,
      ease: "power3.out",
      pixi: { y: liftY },
    });
    gsap.to(this.emphasisScale, {
      duration: this.reducedMotion ? 0 : 0.16,
      ease: "power3.out",
      pixi: { scale },
    });
  }

  private startHoldTween() {
    if (!this.pressed || this.reducedMotion) {
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
    // Match Balatro's move_juice envelope (moveable.lua:267-276):
    //   scale = scale_amt * sin(50.8*t) * (remaining/total)^3
    //   rot   = r_amt    * sin(40.8*t) * (remaining/total)^2
    // Initial squish: VT.scale = 1 - 0.6*amount (moveable.lua:264).
    const now = performance.now() / 1000;
    const fallbackRot = this.seed > 0.5 ? amount * 0.6 : -amount * 0.6;
    this.juiceState = {
      scaleAmt: amount,
      rotAmt: rotationAmount || fallbackRot,
      startTime: now,
      endTime: now + JUICE_DURATION,
    };
    // Apply the initial squish synchronously so the first frame already
    // looks pressed; the oscillating decay takes over from there.
    this.juice.scale.set(1 - JUICE_INITIAL_SQUISH * amount);
    this.juice.rotation = 0;
  }

  private evaluateJuice(time: number) {
    const state = this.juiceState;
    if (!state) {
      return null;
    }

    if (time >= state.endTime) {
      this.juiceState = null;
      return null;
    }

    const elapsed = time - state.startTime;
    const total = state.endTime - state.startTime;
    const remaining = Math.max(0, (state.endTime - time) / total);

    const scaleEnvelope = remaining * remaining * remaining;
    const rotEnvelope = remaining * remaining;

    return {
      scale: state.scaleAmt * Math.sin(JUICE_SCALE_FREQ * elapsed) * scaleEnvelope,
      rotation: state.rotAmt * Math.sin(JUICE_ROT_FREQ * elapsed) * rotEnvelope,
    };
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
    const radius = Math.max(3, width * 0.055);
    this.sprite.width = width;
    this.sprite.height = height;

    this.placeholder
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, radius)
      .fill({ color: 0x161621, alpha: this.loaded ? 0 : 0.92 })
      .stroke({ color: 0xffffff, alpha: 0.08, width: 1 });

    this.cardLayer.label = label;
  }
}
