// Drives every Riley on the page from one WebGL context. Each placement owns
// a plain 2D canvas; the shared renderer draws Riley offscreen and blits the
// frame across, so adding another Riley costs a rig, not a GL context.
import {
  CanvasTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HemisphereLight,
  NoToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from 'three';
import { buildRiley, FACE, HIP_Y, type RileyRig } from './model';

const REST = {
  // 0..1: how much Riley tracks the pointer.
  attend: 1,
  headYaw: 0,
  // Chin tucked a little, so the top of the head shows as it does in the book.
  headPitch: 0.07,
  // And cocked a touch to one side, as on the cover.
  headRoll: 0.05,
  torsoYaw: 0,
  torsoPitch: 0,
  torsoRoll: 0,
  // Arms are named for the side of the screen they appear on.
  lRaise: 0.16,
  lFwd: 0,
  lElbow: 0.12,
  lElbowFwd: 0.2,
  // Wrist turn: 0 hangs palm-in with the thumb forward, a quarter turn
  // (PI / 2) faces the palm at the viewer, negative shows the back of the hand.
  lTwist: -0.35,
  rRaise: 0.16,
  rFwd: 0,
  rElbow: 0.12,
  rElbowFwd: 0.2,
  rTwist: -0.35,
  eyeOpen: 1,
  eyeSize: 1,
  lookX: 0,
  lookY: 0,
  browLY: 0,
  browRY: 0,
  // Positive tilts the inner end up (worried), negative down (skeptical).
  browLTilt: 0.28,
  browRTilt: 0.28,
  smile: 0.75,
  mouthOpen: 0.7,
  mouthWide: 0.72,
  mouthWave: 0,
  hop: 0,
  squash: 0,
  glow: 1,
  question: 0,
  zzz: 0,
};

type Pose = typeof REST;
type PoseKey = keyof Pose;
const KEYS = Object.keys(REST) as PoseKey[];

const MOODS = {
  idle: {},
  happy: { smile: 1, mouthOpen: 1, mouthWide: 1, browLY: 0.05, browRY: 0.05, eyeSize: 1.05, glow: 1.5 },
  curious: { headRoll: -0.1, browLY: 0.05, browRY: 0.06, smile: 0.5, mouthOpen: 0, mouthWide: 0.4, eyeSize: 1.06 },
  confused: {
    headRoll: -0.19,
    headPitch: -0.03,
    torsoRoll: 0.04,
    browLY: 0.075,
    browLTilt: 0.12,
    browRY: -0.045,
    browRTilt: -0.42,
    smile: -0.12,
    mouthOpen: 0,
    mouthWide: 0.4,
    mouthWave: 1,
    lookX: 0.25,
    lookY: 0.3,
    // Hands loose and a little open, ready for the next try.
    lRaise: 0.22,
    lElbow: 0.35,
    lElbowFwd: 0.45,
    lTwist: 0.2,
    rRaise: 0.22,
    rElbow: 0.35,
    rElbowFwd: 0.45,
    rTwist: 0.2,
    question: 1,
    glow: 0.85,
  },
  sleep: {
    attend: 0,
    headPitch: 0.26,
    headRoll: 0.1,
    torsoPitch: 0.07,
    eyeOpen: 0.07,
    browLY: -0.03,
    browRY: -0.03,
    browLTilt: 0.12,
    browRTilt: 0.12,
    smile: 0.3,
    mouthOpen: 0,
    mouthWide: 0.26,
    lRaise: 0.08,
    rRaise: 0.08,
    glow: 0.25,
    zzz: 1,
  },
} satisfies Record<string, Partial<Pose>>;

export type Mood = keyof typeof MOODS;

interface EmoteDef {
  dur: number;
  pose?: Partial<Pose>;
  /** Adjusts the target pose each frame; t in seconds, u in 0..1. */
  tick?: (p: Pose, t: number, u: number) => void;
  /** Mood to settle into afterwards. */
  then?: Mood;
  /** Riley speaks: fires `riley:say` on the element so the page can show the words; `detail.auto` is true when she spoke up on her own. */
  say?: boolean;
}

// Right hand up beside the ear lens, fingers up, for a scratch.
const EAR = { rRaise: 1.9, rFwd: -0.4, rElbow: 0.9, rElbowFwd: 0.1, rTwist: 2.4 } satisfies Partial<Pose>;
// Further out and forward, cupped toward the viewer: "say that again?"
const LISTEN = { rRaise: 2.2, rFwd: -0.4, rElbow: 0.3, rElbowFwd: 0.3, rTwist: 1.8 } satisfies Partial<Pose>;

const hops = (t: number, period: number, count: number) => (t < period * count ? Math.abs(Math.sin((t / period) * Math.PI)) : 0);

const EMOTES = {
  wave: {
    dur: 2.3,
    pose: {
      // Out to the side and up, so the hand clears that big head.
      lRaise: 2.05,
      lTwist: Math.PI / 2,
      smile: 1,
      mouthOpen: 1,
      mouthWide: 1,
      mouthWave: 0,
      browLY: 0.05,
      browRY: 0.05,
      browLTilt: 0,
      browRTilt: 0,
      headRoll: -0.09,
      torsoRoll: 0.04,
      question: 0,
      glow: 1.5,
    },
    tick: (p, t) => {
      p.lElbow = 0.55 + 0.4 * Math.sin(t * 12);
    },
  },
  talk: {
    dur: 0.75,
    say: true,
    tick: (p, t, u) => {
      p.mouthOpen = 0.3 + 0.7 * Math.abs(Math.sin(t * 13));
      p.mouthWide = 0.6;
      p.mouthWave *= 0.4;
      p.hop = 0.1 * hops(t, 0.3, 1);
      p.squash = u < 0.1 ? 0.05 : 0;
      p.glow = 1.6;
    },
  },
  celebrate: {
    dur: 1.9,
    pose: {
      // Arms flung wide, like the "hello" spread in the book.
      lRaise: 2.1,
      rRaise: 2.1,
      lElbow: 0.2,
      rElbow: 0.2,
      lFwd: 0,
      rFwd: 0,
      lElbowFwd: 0,
      rElbowFwd: 0,
      lTwist: Math.PI / 2,
      rTwist: Math.PI / 2,
      smile: 1,
      mouthOpen: 1.1,
      mouthWide: 1,
      mouthWave: 0,
      browLY: 0.07,
      browRY: 0.07,
      browLTilt: 0,
      browRTilt: 0,
      headRoll: 0,
      headPitch: -0.08,
      torsoRoll: 0,
      eyeSize: 1.08,
      question: 0,
      glow: 2,
    },
    tick: (p, t) => {
      p.hop = 0.3 * hops(t, 0.42, 3);
      p.lElbow = p.rElbow = 0.2 + 0.18 * Math.sin(t * 15);
    },
  },
  surprise: {
    dur: 0.9,
    pose: {
      eyeSize: 1.2,
      eyeOpen: 1,
      browLY: 0.1,
      browRY: 0.1,
      browLTilt: 0.1,
      browRTilt: 0.1,
      smile: 0.1,
      mouthOpen: 0.7,
      mouthWide: 0.3,
      mouthWave: 0,
      lRaise: 0.7,
      rRaise: 0.7,
      rFwd: 0,
      rElbowFwd: 0.2,
      headPitch: -0.06,
      headRoll: 0,
      question: 0,
      zzz: 0,
      glow: 1.8,
    },
    tick: (p, t) => {
      p.hop = 0.16 * hops(t, 0.32, 1);
    },
  },
  nod: {
    dur: 0.9,
    pose: { smile: 1, mouthOpen: 0.8, mouthWide: 0.9, mouthWave: 0, question: 0 },
    tick: (p, t) => {
      p.headPitch += 0.2 * Math.sin(t * 14);
    },
  },
  // The acts below are what a confused Riley gets up to on her own, trying to
  // find the hello that's yours. Any of them can be played as an emote too.
  hello: {
    dur: 3.1,
    say: true,
    pose: {
      lookX: 0,
      lookY: 0,
      browLY: 0.06,
      browRY: 0.06,
      browLTilt: 0,
      browRTilt: 0,
      mouthWave: 0,
      smile: 0.9,
      mouthWide: 0.75,
      question: 0,
      headRoll: -0.04,
      torsoRoll: 0,
      eyeSize: 1.06,
      glow: 1.6,
    },
    tick: (p, t) => {
      if (t < 1.3) {
        // Brightly, with a little wave by the face.
        p.mouthOpen = 0.25 + 0.75 * Math.abs(Math.sin(t * 11));
        p.hop = 0.12 * hops(t - 0.1, 0.34, 1);
        p.lRaise = 1.95;
        p.lElbow = 0.55 + 0.35 * Math.sin(t * 13);
        p.lElbowFwd = 0.1;
        p.lTwist = Math.PI / 2;
      } else {
        // Then lean in, a hand cupped by the ear, and wait to hear back.
        const k = Math.min(1, (t - 1.3) / 0.4);
        Object.assign(p, LISTEN);
        p.mouthOpen = 0;
        p.mouthWide = 0.45;
        p.smile = 0.55;
        p.torsoPitch = 0.07 * k;
        p.headPitch = REST.headPitch + 0.06 * k;
        p.headRoll = -0.04 - 0.14 * k;
        p.browLY = p.browRY = 0.08;
        p.eyeSize = 1.12;
        p.glow = 1.2;
      }
    },
  },
  // Hmm: fingers tapping the chin, eyes up in thought.
  ponder: {
    dur: 3.4,
    pose: {
      rRaise: 0,
      rFwd: 1.1,
      rElbow: -0.6,
      rElbowFwd: 1.3,
      rTwist: 1.6,
      headRoll: 0.12,
      headPitch: -0.04,
      lookX: -0.55,
      lookY: 0.6,
      browLY: 0.06,
      browLTilt: 0.05,
      browRY: -0.04,
      browRTilt: -0.45,
      smile: -0.1,
      mouthWave: 1,
      mouthWide: 0.32,
      mouthOpen: 0,
      question: 1,
    },
    tick: (p, t) => {
      if (t > 0.6 && t < 2.8) p.rElbowFwd += 0.07 * Math.sin(t * 15);
      p.headRoll += 0.04 * Math.sin(t * 2.2);
    },
  },
  // A sheepish scratch beside the ear lens.
  scratch: {
    dur: 2.6,
    pose: {
      ...EAR,
      headRoll: -0.1,
      lookX: -0.4,
      lookY: 0.45,
      eyeOpen: 0.85,
      browLY: 0.07,
      browLTilt: 0.3,
      browRY: 0.02,
      browRTilt: 0.3,
      smile: 0.15,
      mouthWave: 0.7,
      mouthWide: 0.4,
      mouthOpen: 0,
      question: 1,
    },
    tick: (p, t) => {
      if (t > 0.45 && t < 2.1) p.rElbow += 0.14 * Math.sin(t * 22);
    },
  },
  // Palms up and a shake of the head: not that one, then?
  shrug: {
    dur: 2.3,
    pose: {
      lRaise: 0.32,
      lElbow: 1.6,
      lElbowFwd: 0,
      lTwist: Math.PI - 0.55,
      rRaise: 0.4,
      rElbow: 1.75,
      rElbowFwd: 0,
      rTwist: Math.PI - 0.55,
      browLY: 0.07,
      browRY: 0.07,
      browLTilt: 0.32,
      browRTilt: 0.32,
      smile: -0.15,
      mouthWave: 1,
      mouthWide: 0.4,
      mouthOpen: 0,
      lookX: 0,
      lookY: 0.1,
      question: 1,
    },
    tick: (p, t) => {
      // Shoulders up on the shrug, then the head shake.
      p.squash = t > 0.15 && t < 0.55 ? -0.035 : 0;
      if (t > 0.5 && t < 1.6) p.headYaw += 0.2 * Math.sin((t - 0.5) * 11) * (1.6 - t);
    },
  },
  // Who said that? A look one way, then the other.
  lookAround: {
    dur: 2.6,
    pose: {
      browLY: 0.07,
      browRY: 0.07,
      browLTilt: 0.15,
      browRTilt: 0.15,
      eyeSize: 1.08,
      mouthWave: 0.5,
      mouthOpen: 0.15,
      mouthWide: 0.3,
      smile: 0,
      question: 1,
    },
    tick: (p, t) => {
      const side = t < 0.25 ? 0 : t < 1.2 ? -1 : t < 2.2 ? 1 : 0;
      p.headYaw = 0.42 * side;
      p.torsoYaw = 0.1 * side;
      p.lookX = 0.9 * side;
      p.lookY = 0.1;
      p.headRoll = 0.05 * side;
    },
  },
} satisfies Record<string, EmoteDef>;

// What Riley does on her own in a mood, between your taps: every other act is
// the first, picked from the rest otherwise. Moods without one just idle.
const ROUTINES: Partial<Record<Mood, Emote[]>> = {
  confused: ['hello', 'ponder', 'shrug', 'scratch', 'lookAround'],
};

// Ambient motion layered on a mood, so Riley never freezes between acts.
const AMBIENT: Partial<Record<Mood, (p: Pose, t: number) => void>> = {
  confused: (p, t) => {
    p.headRoll += 0.06 * Math.sin(t * 0.85);
    p.headPitch += 0.025 * Math.sin(t * 0.55 + 1);
    p.lElbow += 0.08 * Math.sin(t * 1.1);
    p.rElbow += 0.08 * Math.sin(t * 1.1 + 2);
  },
};

const WAKE: EmoteDef = { ...EMOTES.surprise, pose: { ...EMOTES.surprise.pose, attend: 1 }, then: 'idle' };

export type Emote = keyof typeof EMOTES;

// Per-second approach rates; anything unlisted eases at DEFAULT_RATE.
const DEFAULT_RATE = 9;
const RATES: Partial<Record<PoseKey, number>> = {
  eyeOpen: 38,
  lookX: 15,
  lookY: 15,
  hop: 26,
  squash: 26,
  mouthOpen: 22,
  lElbow: 20,
  rElbow: 20,
  attend: 3,
  zzz: 3,
  question: 6,
  glow: 5,
};

interface Instance {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  grain: CanvasPattern | null;
  rig: RileyRig;
  pose: Pose;
  mood: Mood;
  emote?: { def: EmoteDef; start: number };
  visible: boolean;
  hover: boolean;
  drawn: boolean;
  turn: number;
  seed: number;
  nextBlink: number;
  blinkUntil: number;
  wander: { x: number; y: number; next: number };
  sleepy: boolean;
  awakeUntil: number;
  greet: boolean;
  inView: boolean;
  rect: DOMRect;
  /** When the routine plays its next act, and how far along it is. */
  nextAct: number;
  act: number;
  lastAct?: Emote;
}

const FRAME_H = 4.1;
const FRAME_W = 3.5;
const FRAME_Y = 1.86;

/** A whisper of paper tooth and pencil strokes over every frame, so Riley reads as pencil and pastel like the book. */
const GRAIN = 384;
let grain: HTMLCanvasElement | undefined;
function getGrain() {
  if (grain) return grain;
  grain = document.createElement('canvas');
  grain.width = grain.height = GRAIN;
  const ctx = grain.getContext('2d')!;
  const img = ctx.createImageData(GRAIN, GRAIN);
  // Seeded, so the texture is the same on every visit.
  let s = 1337;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rand() + rand() + rand()) / 3 - 0.5;
    const c = v < 0 ? 12 : 255;
    img.data[i] = img.data[i + 1] = c;
    img.data[i + 2] = v < 0 ? 30 : 240;
    img.data[i + 3] = Math.min(255, Math.abs(v) * (v < 0 ? 30 : 22));
  }
  ctx.putImageData(img, 0, 0);
  // Short hatching, all leaning the same way. Each stroke is drawn on every
  // neighbouring tile too, so the pattern repeats without a seam.
  ctx.lineCap = 'round';
  for (let i = 0; i < 900; i++) {
    const x = rand() * GRAIN;
    const y = rand() * GRAIN;
    const angle = -0.95 + (rand() - 0.5) * 0.7;
    const len = 4 + rand() * 9;
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    ctx.strokeStyle = rand() < 0.7 ? `rgb(14 24 44 / ${0.015 + rand() * 0.03})` : `rgb(255 248 232 / ${0.01 + rand() * 0.018})`;
    ctx.lineWidth = 0.7 + rand() * 1.1;
    ctx.beginPath();
    for (const ox of [-GRAIN, 0, GRAIN]) {
      for (const oy of [-GRAIN, 0, GRAIN]) {
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + dx, y + oy + dy);
      }
    }
    ctx.stroke();
  }
  return grain;
}
const FOV = 32;

const instances: Instance[] = [];
const pointer = { x: 0, y: 0, active: false, touch: false, at: 0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let renderer: WebGLRenderer | undefined;
let scene: Scene;
let env: Texture | undefined;
let camera: PerspectiveCamera;
let failed = false;
let raf = 0;
let last = 0;
let cheer = false;

function setup() {
  if (renderer || failed) return;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    failed = true;
    return;
  }
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  // No tone mapping: the palette is sampled from the cover and should land as painted.
  renderer.toneMapping = NoToneMapping;
  renderer.setScissorTest(true);

  scene = new Scene();
  // Lit like the cover: warm sunset light low from the viewer's left, cool
  // evening sky from above, and the far side left in shadow.
  // Balanced so a surface facing the viewer lands on its painted colour.
  // Surfaces facing up catch the sky, as the top of Riley's head does on the cover.
  const key = new DirectionalLight(0xffffff, 1.75);
  key.position.set(-3, 2, 6);
  const sky = new DirectionalLight(0xbfe6ff, 2.4);
  sky.position.set(0.5, 6, 1);
  const fill = new DirectionalLight(0xa9c6e4, 0.35);
  fill.position.set(5, 1, 2);
  // The sunset, low on the viewer's left: it warms the undersides.
  const rim = new DirectionalLight(0xffc48a, 0.55);
  rim.position.set(-4, -3, 3);
  scene.add(key, sky, fill, rim, new HemisphereLight(0xe3edf6, 0xd6ccc0, 0.8));

  camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
  env = skyReflection(renderer);

  renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());

  addEventListener(
    'pointermove',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      pointer.touch = e.pointerType === 'touch';
      pointer.at = performance.now();
    },
    { passive: true },
  );
  addEventListener(
    'pointerdown',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      pointer.touch = e.pointerType === 'touch';
      pointer.at = performance.now();
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', () => (pointer.active = false));
  addEventListener('blur', () => (pointer.active = false));
  document.addEventListener('visibilitychange', kick);
  // The reader covers the page; no point animating underneath it.
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Anything marked data-riley-cheer makes Riley light up while it's hovered.
  const cheering = (e: Event) => (e.target as Element | null)?.closest?.('[data-riley-cheer]');
  document.addEventListener('pointerover', (e) => cheering(e) && (cheer = true));
  document.addEventListener('pointerout', (e) => cheering(e) && (cheer = false));
  document.addEventListener('focusin', (e) => (cheer = !!cheering(e)));
  document.addEventListener('focusout', () => (cheer = false));

  // Page-wide reactions: every Riley on screen joins in.
  addEventListener('riley:emote', (e) => {
    const name = (e as CustomEvent).detail;
    for (const inst of instances) if (inst.visible && inst.mood !== 'sleep') play(inst, name);
  });
}

/**
 * What Riley's metal reflects: the cover's evening, painted as a tiny
 * panorama. Cool sky overhead, a band of sunset on the horizon (brightest to
 * the viewer's left), dark ground, and a soft window of light for highlights.
 */
function skyReflection(gl: WebGLRenderer) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#c9dcec');
  sky.addColorStop(0.3, '#8fa9c4');
  sky.addColorStop(0.47, '#aab4bf');
  sky.addColorStop(0.53, '#4a4c52');
  sky.addColorStop(1, '#23242a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 256, 128);
  const glow = (x: number, y: number, rx: number, ry: number, color: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgb(0 0 0 / 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };
  // Straight ahead of Riley is x = 192; the viewer's left is toward x = 128.
  for (const dx of [-256, 0, 256]) {
    glow(150 + dx, 60, 46, 14, 'rgb(255 205 150 / 0.95)');
    glow(40 + dx, 40, 34, 22, 'rgb(190 220 255 / 0.5)');
    // Two soft windows, high in front: these are the streaks on arms and legs.
    glow(172 + dx, 24, 15, 20, 'rgb(255 255 255 / 1)');
    glow(214 + dx, 30, 9, 16, 'rgb(225 240 255 / 0.9)');
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.mapping = EquirectangularReflectionMapping;
  const pmrem = new PMREMGenerator(gl);
  const out = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return out;
}

function play(inst: Instance, name: unknown, auto = false) {
  const def = typeof name === 'string' ? (EMOTES as Record<string, EmoteDef>)[name] : undefined;
  if (!def) return;
  const now = performance.now() / 1000;
  inst.emote = { def, start: now };
  // Give a tap its moment before the routine carries on.
  if (!auto) inst.nextAct = now + def.dur + 2.5;
  if (def.say) inst.el.dispatchEvent(new CustomEvent('riley:say', { bubbles: true, detail: { auto } }));
}

/** The next act in this mood's routine, if it has one and Riley's free. */
function routine(inst: Instance, now: number) {
  const acts = ROUTINES[inst.mood];
  if (!acts || inst.emote || now < inst.nextAct) return;
  let next = acts[0];
  if (inst.act % 2) {
    const others = acts.slice(1).filter((a) => a !== inst.lastAct);
    next = others[Math.floor(Math.random() * others.length)] ?? acts[0];
    inst.lastAct = next;
  }
  inst.act++;
  play(inst, next, true);
  inst.nextAct = now + EMOTES[next].dur + 0.5 + Math.random() * 0.9;
}

function wake(inst: Instance, now: number) {
  inst.awakeUntil = now + 9;
  if (inst.mood !== 'sleep') return;
  inst.mood = 'idle';
  inst.emote = { def: WAKE, start: now };
}

function resize(inst: Instance) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(inst.el.clientWidth * dpr));
  const h = Math.max(1, Math.round(inst.el.clientHeight * dpr));
  if (inst.canvas.width !== w || inst.canvas.height !== h) {
    inst.canvas.width = w;
    inst.canvas.height = h;
  }
  if (!renderer) return;
  const gl = renderer.domElement;
  if (gl.width < w || gl.height < h) renderer.setSize(Math.max(gl.width, w), Math.max(gl.height, h), false);
}

function kick() {
  if (raf || document.hidden || document.body.classList.contains('reader-open') || !instances.some((i) => i.visible)) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function frame(ms: number) {
  raf = 0;
  const dt = Math.min(0.05, Math.max(0.001, (ms - last) / 1000));
  last = ms;
  const now = ms / 1000;
  if (pointer.touch && ms - pointer.at > 2500) pointer.active = false;
  for (const inst of instances) if (inst.visible) update(inst, now, dt);
  kick();
}

const target = { ...REST };

function update(inst: Instance, now: number, dt: number) {
  const { rig, pose } = inst;
  const calm = reducedMotion.matches;
  const rect = (inst.rect = inst.el.getBoundingClientRect());
  if (!rect.width || !rect.height || !renderer) return;

  // Where is the pointer relative to Riley's face?
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height * 0.36;
  const reach = Math.max(rect.width * 1.1, 260);
  let gx = 0;
  let gy = 0;
  if (pointer.active) {
    const dx = (pointer.x - cx) / reach;
    const dy = (cy - pointer.y) / reach;
    gx = dx / Math.sqrt(1 + dx * dx);
    gy = dy / Math.sqrt(1 + dy * dy);
    const near = Math.abs(pointer.x - cx) < rect.width && Math.abs(pointer.y - (rect.top + rect.height / 2)) < rect.height;
    if (inst.sleepy && near && now - pointer.at / 1000 < 0.25) wake(inst, now);
  } else if (!calm) {
    // Nobody to look at: glance around now and then.
    if (now > inst.wander.next) {
      const away = Math.random() < 0.6;
      inst.wander = { x: away ? Math.random() * 1.4 - 0.7 : 0, y: away ? Math.random() * 0.5 - 0.2 : 0, next: now + 1.4 + Math.random() * 3 };
    }
    gx = inst.wander.x;
    gy = inst.wander.y;
  }

  if (inst.sleepy && inst.mood !== 'sleep' && !inst.emote && now > inst.awakeUntil) inst.mood = 'sleep';

  if (!calm && !cheer) routine(inst, now);

  // Build this frame's target: rest pose, mood, then any emote on top.
  Object.assign(target, REST, MOODS[inst.mood]);
  if (!calm) AMBIENT[inst.mood]?.(target, now + inst.seed);
  if (cheer && inst.mood !== 'sleep') Object.assign(target, MOODS.happy, { question: 0, mouthWave: 0 });
  if (inst.hover && inst.mood !== 'sleep') {
    target.browLY += 0.025;
    target.browRY += 0.025;
    target.eyeSize += 0.04;
    target.glow += 0.35;
  }
  if (inst.emote) {
    const { def, start } = inst.emote;
    const t = now - start;
    if (t >= def.dur) {
      inst.emote = undefined;
      if (def.then) inst.mood = def.then;
    } else {
      if (def.pose) Object.assign(target, def.pose);
      def.tick?.(target, t, t / def.dur);
      if (calm) target.hop = target.squash = 0;
    }
  }

  const attend = pose.attend;
  target.lookX += gx * attend;
  target.lookY += gy * attend;
  target.headYaw += gx * 0.42 * attend;
  target.headPitch -= gy * 0.24 * attend;
  target.torsoYaw += gx * 0.12 * attend;
  target.lookX = Math.max(-1, Math.min(1, target.lookX));
  target.lookY = Math.max(-1, Math.min(1, target.lookY));

  if (now > inst.nextBlink) {
    inst.blinkUntil = now + 0.12;
    inst.nextBlink = now + (Math.random() < 0.15 ? 0.3 : 2 + Math.random() * 4);
  }
  if (now < inst.blinkUntil) target.eyeOpen = Math.min(target.eyeOpen, 0.06);

  for (const k of KEYS) pose[k] += (target[k] - pose[k]) * (1 - Math.exp(-(RATES[k] ?? DEFAULT_RATE) * dt));

  // Pose the rig.
  const p = pose;
  const asleep = 1 - p.attend;
  const tt = now + inst.seed;
  const breath = calm ? 0 : Math.sin(tt * (1.7 - asleep * 0.7));
  const sway = calm ? 0 : Math.sin(tt * 0.9);

  rig.root.rotation.y = inst.turn;
  rig.body.position.y = p.hop;
  rig.body.scale.set(1 + p.squash * 0.5, 1 - p.squash, 1 + p.squash * 0.5);
  rig.torso.position.y = HIP_Y + breath * 0.012;
  rig.torso.rotation.set(p.torsoPitch + breath * 0.012 * (1 + asleep * 2), p.torsoYaw, p.torsoRoll + sway * 0.012);
  rig.head.rotation.set(p.headPitch - breath * 0.012 + asleep * breath * 0.03, p.headYaw, p.headRoll + sway * 0.015);

  rig.armL.shoulder.rotation.set(-p.lFwd, 0, -p.lRaise - breath * 0.02);
  rig.armL.elbow.rotation.set(-p.lElbowFwd, 0, -p.lElbow);
  rig.armL.hand.rotation.y = -Math.PI / 2 - p.lTwist;
  rig.armR.shoulder.rotation.set(-p.rFwd, 0, p.rRaise + breath * 0.02);
  rig.armR.elbow.rotation.set(-p.rElbowFwd, 0, p.rElbow);
  rig.armR.hand.rotation.y = Math.PI / 2 + p.rTwist;

  // The eyes are drawn on a screen, so looking around slides them across it.
  for (const eye of [rig.eyeL, rig.eyeR]) {
    eye.position.x = eye.userData.x + p.lookX * 0.06;
    eye.position.y = FACE.eyeY + p.lookY * 0.05;
    eye.scale.set(p.eyeSize, p.eyeSize * p.eyeOpen, 1);
  }
  for (const glint of [rig.glintL, rig.glintR]) glint.position.set(-0.09 + p.lookX * 0.045, 0.05 + p.lookY * 0.06, 0.003);
  rig.browL.position.y = FACE.browY + p.browLY;
  rig.browR.position.y = FACE.browY + p.browRY;
  rig.browL.rotation.z = p.browLTilt;
  rig.browR.rotation.z = -p.browRTilt;
  rig.setMouth({ smile: p.smile, open: p.mouthOpen, wide: p.mouthWide, wave: p.mouthWave });

  const glow = p.glow * (1 + (calm ? 0 : 0.08 * Math.sin(tt * 2.3)));
  rig.glowMaterial.color.setScalar(Math.min(1.25, 0.62 + 0.38 * glow));
  for (const h of rig.halos) {
    h.scale.setScalar(h.userData.size * (0.7 + 0.3 * glow));
    h.material.opacity = Math.min(0.9, 0.42 * glow);
  }
  rig.shadow.scale.setScalar(1 - p.hop * 0.7);
  (rig.shadow.material as { opacity: number }).opacity = 1 - p.hop * 1.4;

  const q = rig.question;
  q.visible = p.question > 0.01;
  q.material.opacity = Math.min(1, p.question);
  q.material.rotation = 0.22 + (calm ? 0 : 0.09 * Math.sin(tt * 1.4));
  q.position.set(-0.98, 3.42 + (calm ? 0 : 0.05 * Math.sin(tt * 2.1)), 0.4);
  q.scale.setScalar(0.3 + 0.3 * Math.min(1, p.question));

  rig.zzz.forEach((z, i) => {
    const phase = calm ? 0.25 + i * 0.25 : (tt * 0.3 + i / 3) % 1;
    z.visible = p.zzz > 0.01;
    z.material.opacity = p.zzz * Math.sin(Math.PI * phase);
    z.position.set(0.85 + phase * 0.45 + 0.07 * Math.sin(phase * 9), 3.05 + phase * 0.6, 0.4);
    z.scale.setScalar(0.2 + phase * 0.26);
  });

  // Render into the shared buffer, then copy to this Riley's canvas.
  const { width: w, height: h } = inst.canvas;
  const aspect = w / h;
  const frameH = Math.max(FRAME_H, FRAME_W / aspect);
  const dist = frameH / 2 / Math.tan((FOV * Math.PI) / 360);
  camera.aspect = aspect;
  // A little above, so the top of the head shows as it does in the book.
  camera.position.set(0, FRAME_Y + 1.3, dist);
  camera.lookAt(0, FRAME_Y - (frameH - FRAME_H) / 2, 0);
  camera.updateProjectionMatrix();

  for (const other of instances) other.rig.root.visible = other === inst;
  const gl = renderer.domElement;
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  renderer.clear();
  renderer.render(scene, camera);
  const ctx = inst.ctx;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(gl, 0, gl.height - h, w, h, 0, 0, w, h);
  if (inst.grain) {
    // Scale the strokes with Riley, so a small Riley isn't drawn with a fat pencil.
    const k = Math.max(0.45, Math.min(2, h / 900));
    inst.grain.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = inst.grain;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (!inst.drawn) {
    inst.drawn = true;
    inst.el.classList.remove('riley3d-loading');
    inst.el.classList.add('riley3d-ready');
  }

  // Wave hello each time Riley comes properly into view.
  if (inst.greet) {
    const inView = rect.top + rect.height * 0.55 < innerHeight && rect.bottom > rect.height * 0.5;
    if (inView && !inst.inView && inst.mood !== 'sleep') play(inst, 'wave');
    inst.inView = inView;
  }
}

export interface RileyHandle {
  emote(name: Emote): void;
  setMood(mood: Mood): void;
}

/** Bring a `[data-riley]` placeholder to life. Safe to call more than once. */
export function mount(el: HTMLElement): RileyHandle | undefined {
  setup();
  const canvas = el.querySelector('canvas');
  const ctx = canvas?.getContext('2d');
  if (!renderer || !canvas || !ctx || el.dataset.rileyMounted) return;
  el.dataset.rileyMounted = '';

  const mood = (el.dataset.mood && el.dataset.mood in MOODS ? el.dataset.mood : 'idle') as Mood;
  const rig = buildRiley(env);
  rig.root.visible = false;
  scene.add(rig.root);

  const now = performance.now() / 1000;
  const inst: Instance = {
    el,
    canvas,
    ctx,
    grain: ctx.createPattern(getGrain(), 'repeat'),
    rig,
    pose: { ...REST, ...MOODS[mood] },
    mood,
    visible: false,
    hover: false,
    drawn: false,
    turn: (Number(el.dataset.turn) || 0) * (Math.PI / 180),
    seed: Math.random() * 100,
    nextBlink: now + 1 + Math.random() * 3,
    blinkUntil: 0,
    wander: { x: 0, y: 0, next: now + 2 },
    sleepy: mood === 'sleep',
    awakeUntil: 0,
    greet: 'greet' in el.dataset,
    inView: false,
    rect: el.getBoundingClientRect(),
    nextAct: now + 1.2,
    act: 0,
  };
  instances.push(inst);

  resize(inst);
  new ResizeObserver(() => resize(inst)).observe(el);
  new IntersectionObserver(
    ([entry]) => {
      inst.visible = entry.isIntersecting;
      kick();
    },
    { rootMargin: '80px' },
  ).observe(el);

  // Taps land on the nearest button when Riley is wrapped in one.
  const hit = el.closest<HTMLElement>('button, a') ?? el;
  hit.addEventListener('pointerenter', () => {
    inst.hover = true;
    if (inst.sleepy) wake(inst, performance.now() / 1000);
  });
  hit.addEventListener('pointerleave', () => (inst.hover = false));
  hit.addEventListener('focus', () => inst.sleepy && wake(inst, performance.now() / 1000));
  hit.addEventListener('click', () => {
    const t = performance.now() / 1000;
    if (inst.mood === 'sleep') return wake(inst, t);
    if (inst.sleepy) inst.awakeUntil = t + 9;
    if (el.dataset.tap) play(inst, el.dataset.tap);
  });
  el.addEventListener('riley:emote', (e) => {
    e.stopPropagation();
    play(inst, (e as CustomEvent).detail);
  });
  el.addEventListener('riley:mood', (e) => {
    const next = (e as CustomEvent).detail;
    if (next in MOODS) inst.mood = next;
  });

  return {
    emote: (name) => play(inst, name),
    setMood: (next) => (inst.mood = next),
  };
}
