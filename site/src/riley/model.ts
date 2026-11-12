// Riley, built from primitives and modelled on the book's cover illustration:
// a boxy cream-framed screen for a head, a face drawn on that screen, big
// glowing ear lenses and a small slate-blue body. No model file to download,
// and every joint can be posed.
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Path,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Sampled from the cover art.
const COLOR = {
  shell: 0x2a4e6c,
  shellDark: 0x1e3751,
  limb: 0x234361,
  joint: 0x18293a,
  ring: 0x2b6078,
  frame: 0xffffff,
  screen: 0xffffff,
  outline: 0x13202f,
  ink: '#16222f',
  tongue: '#8a5a3c',
  glow: 0x59bdcb,
};

/** Layout of the face on the screen, in head space; measured off the cover. */
export const FACE = { z: 0.745, eyeX: 0.41, eyeY: 0, browX: 0.47, browY: 0.45, mouthY: -0.5 };

/** The head is modelled at full size, then scaled to the book's proportions. */
export const HEAD_SCALE = 0.85;
/** Height of the hips above the ground. */
export const HIP_Y = 0.95;

export interface Arm {
  shoulder: Group;
  elbow: Group;
  hand: Group;
}

export interface MouthShape {
  smile: number;
  open: number;
  wide: number;
  wave: number;
}

export interface RileyRig {
  root: Group;
  /** Everything above the ground; hops and squashes. */
  body: Group;
  /** Pivot at the hips; leans and twists. */
  torso: Group;
  /** Pivot at the neck. */
  head: Group;
  /** Arm on the viewer's left / right. */
  armL: Arm;
  armR: Arm;
  eyeL: Group;
  eyeR: Group;
  /** The glint in each eye; slides to aim the gaze. */
  glintL: Mesh;
  glintR: Mesh;
  browL: Group;
  browR: Group;
  mouth: Mesh;
  shadow: Mesh;
  question: Sprite;
  zzz: Sprite[];
  glowMaterial: MeshBasicMaterial;
  halos: Sprite[];
  setMouth(shape: MouthShape): void;
}

function roundedRect<T extends Path>(target: T, w: number, h: number, r: number): T {
  const x = w / 2 - r;
  const y = h / 2 - r;
  target.absarc(x, y, r, 0, Math.PI / 2);
  target.absarc(-x, y, r, Math.PI / 2, Math.PI);
  target.absarc(-x, -y, r, Math.PI, Math.PI * 1.5);
  target.absarc(x, -y, r, Math.PI * 1.5, Math.PI * 2);
  target.closePath();
  return target;
}

// A finger: a capsule hanging from its knuckle (at the origin) down -y, curled
// toward the palm (-z) by `curl` radians along its length and narrowing by
// `taper` towards the tip. One mesh, so the outline doesn't ring the joints.
function digit(radius: number, length: number, curl: number, taper: number) {
  const geo = new CapsuleGeometry(radius, length, 6, 14);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - length / 2;
    const s = Math.min(length, Math.max(0, -y));
    const a = (curl * s) / length;
    const R = length / curl;
    const k = 1 - (taper * s) / length;
    // Offset from the bent spine, turned with it.
    const dx = pos.getX(i) * k;
    const dy = (y + s) * k;
    const dz = pos.getZ(i) * k;
    const c = Math.cos(a);
    const n = Math.sin(a);
    pos.setXYZ(i, dx, -R * n + dy * c - dz * n, -R * (1 - c) + dy * n + dz * c);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    nrm.setXYZ(i, nrm.getX(i), ny * c - nz * n, ny * n + nz * c);
  }
  geo.computeBoundingSphere();
  return geo;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function radialTexture(stops: [number, string][]) {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

function glyphTexture(glyph: string, fill: string) {
  let paint = () => {};
  const tex = canvasTexture(160, 160, (ctx) => {
    paint = () => {
      ctx.clearRect(0, 0, 160, 160);
      ctx.font = '700 128px Fredoka, "Arial Rounded MT Bold", ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 16;
      ctx.strokeStyle = 'rgb(10 20 48 / 0.9)';
      ctx.strokeText(glyph, 80, 86);
      ctx.fillStyle = fill;
      ctx.fillText(glyph, 80, 86);
    };
    paint();
  });
  // The display face usually arrives after first paint; redraw once it has.
  document.fonts?.load('700 128px Fredoka').then(
    () => {
      paint();
      tex.needsUpdate = true;
    },
    () => {},
  );
  return tex;
}

/**
 * Years of wear, baked into two small tiling textures: `color` darkens grime
 * and lightens scuffs; `surface` packs height (R), roughness (G) and
 * metalness (B), so scratches catch the light as bare metal.
 */
function wearTextures() {
  const N = 256;
  let s = 4242;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  // Tiling value noise.
  const lattice = (cells: number) => {
    const g = Float32Array.from({ length: cells * cells }, rand);
    return (x: number, y: number) => {
      const fx = (x / N) * cells;
      const fy = (y / N) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const broad = [lattice(3), lattice(7), lattice(15)];
  const fine = lattice(48);

  // Scratches and chips are drawn with the 2D canvas, then read back as a mask.
  const mask = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, N, N);
    ctx.strokeStyle = ctx.fillStyle = '#fff';
    ctx.lineCap = 'round';
    draw(ctx);
    return ctx.getImageData(0, 0, N, N).data;
  };
  // Everything is repeated on the neighbouring tiles so the texture has no seam.
  const tiled = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) fn(ox, oy);
  };
  const scratches = mask((ctx) => {
    for (let i = 0; i < 150; i++) {
      const x = rand() * N;
      const y = rand() * N;
      const a = rand() * Math.PI;
      const len = 5 + rand() * rand() * 44;
      ctx.globalAlpha = 0.25 + rand() * 0.6;
      ctx.lineWidth = 0.6 + rand() * 0.7;
      ctx.beginPath();
      tiled((ox, oy) => {
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      });
      ctx.stroke();
    }
  });
  const chips = mask((ctx) => {
    for (let i = 0; i < 80; i++) {
      const x = rand() * N;
      const y = rand() * N;
      const r = 0.5 + rand() * rand() * 2.6;
      ctx.globalAlpha = 0.4 + rand() * 0.6;
      ctx.beginPath();
      tiled((ox, oy) => {
        ctx.moveTo(x + ox + r, y + oy);
        ctx.ellipse(x + ox, y + oy, r, r * (0.6 + rand() * 0.4), 0, 0, Math.PI * 2);
      });
      ctx.fill();
    }
  });

  const color = new ImageData(N, N);
  const surface = new ImageData(N, N);
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const n = broad[0](x, y) * 0.55 + broad[1](x, y) * 0.3 + broad[2](x, y) * 0.15;
      // Grime gathers in patches; polish survives in others.
      const grime = Math.max(0, Math.min(1, (n - 0.5) / 0.22));
      const polish = Math.max(0, Math.min(1, (0.46 - n) / 0.2));
      const mottle = fine(x, y) - 0.5;
      const scratch = scratches[i] / 255;
      const chip = chips[i] / 255;
      const v = 0.86 - 0.15 * grime + 0.05 * polish + 0.035 * mottle + 0.22 * scratch + 0.14 * chip;
      // Scuffs go pale and steely rather than just lighter.
      color.data[i] = byte(v + 0.1 * scratch + 0.08 * chip);
      color.data[i + 1] = byte(v + 0.05 * scratch + 0.04 * chip);
      color.data[i + 2] = byte(v - 0.02 * grime);
      color.data[i + 3] = 255;
      surface.data[i] = byte(0.5 + 0.05 * mottle - 0.4 * scratch - 0.45 * chip);
      surface.data[i + 1] = byte(0.5 + 0.3 * grime - 0.16 * polish + 0.06 * mottle - 0.22 * scratch - 0.14 * chip);
      surface.data[i + 2] = byte(0.62 - 0.3 * grime + 0.12 * polish + 0.38 * scratch + 0.38 * chip);
      surface.data[i + 3] = 255;
    }
  }
  const texture = (data: ImageData, srgb: boolean) => {
    const t = canvasTexture(N, N, (ctx) => ctx.putImageData(data, 0, 0));
    if (!srgb) t.colorSpace = NoColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  return { color: texture(color, true), surface: texture(surface, false) };
}

/** Geometry and materials shared by every Riley on the page. */
interface Kit {
  geo: Record<string, BufferGeometry>;
  mat: Record<string, Material>;
  shadowTex: CanvasTexture;
  haloTex: CanvasTexture;
  lensTex: CanvasTexture;
  questionTex: CanvasTexture;
  zTex: CanvasTexture;
}

let kit: Kit | undefined;

// The head box, face-on.
const HEAD_W = 2.02;
const HEAD_H = 1.78;
const HEAD_R = 0.3;

function getKit(env?: Texture): Kit {
  if (kit) return kit;

  // Only the front face of the head is cream: a thin bezel with a rounded
  // edge, stuck on the front of the blue box.
  const frameShape = roundedRect(new Shape(), HEAD_W, HEAD_H, HEAD_R);
  frameShape.holes.push(roundedRect(new Path(), 1.56, 1.36, 0.19));
  const frame = new ExtrudeGeometry(frameShape, {
    depth: 0.07,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.1,
    bevelOffset: -0.1,
    bevelSegments: 8,
    curveSegments: 16,
  });
  // The box behind it: a straight sleeve up to the bezel, rounded off at the back.
  const sleeve = new ExtrudeGeometry(roundedRect(new Shape(), HEAD_W, HEAD_H, HEAD_R), { depth: 0.43, bevelEnabled: false, curveSegments: 16 });
  // Paint the cream parts by position, so the gradient runs straight down the face.
  const planarUV = <T extends BufferGeometry>(g: T, w: number, h: number) => {
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return g;
  };
  planarUV(frame, HEAD_W, HEAD_H);
  // On the cover the head is a touch wider at the top than at the chin.
  const taper = <T extends BufferGeometry>(g: T) => {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (1 + 0.06 * (pos.getY(i) / (HEAD_H / 2))));
    return g;
  };
  taper(frame);
  taper(sleeve);
  const frameTex = canvasTexture(64, 256, (ctx) => {
    // Cool evening sky on top, warm sunset glow underneath, as on the cover.
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    // The top edge faces the sky light, so it starts darker to land where the cover does.
    g.addColorStop(0, '#727b7d');
    g.addColorStop(0.07, '#a9b1aa');
    g.addColorStop(0.3, '#c9c2a9');
    g.addColorStop(0.7, '#d8c69f');
    g.addColorStop(1, '#e6cb9e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
  });
  // Panel seams that run right round the box.
  const seamShape = roundedRect(new Shape(), HEAD_W + 0.012, HEAD_H + 0.012, HEAD_R + 0.006);
  seamShape.holes.push(roundedRect(new Path(), HEAD_W - 0.1, HEAD_H - 0.1, HEAD_R - 0.05));
  const seamRing = new ExtrudeGeometry(seamShape, { depth: 0.016, bevelEnabled: false, curveSegments: 16 });
  taper(seamRing);
  // The dark line where the screen meets its frame.
  const lineShape = roundedRect(new Shape(), 1.6, 1.4, 0.21);
  lineShape.holes.push(roundedRect(new Path(), 1.535, 1.335, 0.178));

  const browArc = 1.15;
  const brow = new TorusGeometry(0.2, 0.032, 8, 16, browArc);
  brow.rotateZ(Math.PI / 2 - browArc / 2);
  brow.translate(0, -0.2, 0);

  const screenTex = canvasTexture(256, 224, (ctx) => {
    // Sampled across the cover's screen: cool up by the far corner, warm near the hand.
    const g = ctx.createLinearGradient(230, 0, 50, 224);
    g.addColorStop(0, '#93abb5');
    g.addColorStop(0.3, '#bbc0b3');
    g.addColorStop(0.62, '#d6ccb0');
    g.addColorStop(1, '#f6d9aa');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 224);
    ctx.strokeStyle = 'rgb(38 58 78 / 0.07)';
    for (const w of [44, 30, 18, 9]) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.roundRect(0, 0, 256, 224, 38);
      ctx.stroke();
    }
  });

  const sideways = <T extends BufferGeometry>(g: T) => g.rotateZ(Math.PI / 2);
  const faceOut = <T extends BufferGeometry>(g: T) => g.rotateY(Math.PI / 2);

  // Old painted metal: worn, scuffed and a little shiny where hands have
  // polished it. `repeat` keeps the wear the same size on big and small parts.
  const wear = wearTextures();
  const metal = (color: number, repeat = 1, sheen = 1) => {
    const [map, surface] = [wear.color, wear.surface].map((t) => {
      if (repeat === 1) return t;
      const c = t.clone();
      c.repeat.set(repeat, repeat);
      c.needsUpdate = true;
      return c;
    });
    const m = new MeshStandardMaterial({
      color,
      map,
      roughness: 0.74 / sheen,
      roughnessMap: surface,
      metalness: 0.9,
      metalnessMap: surface,
      bumpMap: surface,
      bumpScale: 0.35,
      envMap: env ?? null,
      envMapIntensity: 1.25,
    });
    // The wear map darkens on average; lift the paint so it lands on the cover's colour.
    m.color.multiplyScalar(1.38);
    return m;
  };
  // Rubber and cloth: no shine at all.
  const matte = (color: number, roughness = 0.9) => new MeshStandardMaterial({ color, roughness, metalness: 0 });

  // On the cover the chest is broad at the shoulders and narrows to the waist.
  const chestGeo = new RoundedBoxGeometry(0.86, 0.72, 0.66, 6, 0.3);
  {
    const pos = chestGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (1 + 0.12 * (pos.getY(i) / 0.36)));
  }
  // A band with soft shoulders, for the waist and the cuffs.
  const band = (r: number, h: number, round: number) => {
    const pts: Vector2[] = [new Vector2(r - round, -h / 2)];
    for (let i = 0; i <= 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      pts.push(new Vector2(r - round + Math.cos(a) * round, -h / 2 + round + Math.sin(a) * round));
    }
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new Vector2(r - round + Math.cos(a) * round, h / 2 - round + Math.sin(a) * round));
    }
    pts.push(new Vector2(r - round, h / 2));
    return new LatheGeometry(pts, 40).rotateY(Math.PI);
  };
  // The hips are a rounded bowl, like a pair of briefs, that the legs come out from under.
  const pelvis = new LatheGeometry(
    [
      [0, -0.235],
      [0.09, -0.228],
      [0.18, -0.2],
      [0.265, -0.15],
      [0.335, -0.075],
      [0.38, 0.01],
      [0.395, 0.08],
      [0.385, 0.12],
      [0.35, 0.152],
      [0.28, 0.165],
      [0, 0.165],
    ].map(([x, y]) => new Vector2(x, y)),
    40,
  );
  // Seam to the back, then flattened front to back.
  pelvis.rotateY(Math.PI);
  pelvis.scale(1, 1, 0.76);

  // Pencil outline: the same mesh again, pushed out along its normals and
  // drawn inside-out so only a rim shows.
  // Riley's chest plate has a seam that dips through the light and climbs to
  // each shoulder. Drawn in the shader so it follows the surface exactly.
  const chest = metal(COLOR.shell);
  chest.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float seam = smoothstep( 0.02, 0.011, abs( vObj.y + 0.06 - 1.05 * vObj.x * vObj.x ) ) * step( 0.0, vObj.z );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.006, 0.014, 0.03 ), seam );`,
      );
  };

  const outline = new MeshBasicMaterial({ color: COLOR.outline, side: BackSide, toneMapped: false });
  outline.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = position + normalize( normal ) * 0.022;',
    );
  };

  kit = {
    geo: {
      shell: taper(new RoundedBoxGeometry(HEAD_W, HEAD_H, 1.4, 8, HEAD_R)),
      sleeve,
      seamRing,
      frame,
      screen: taper(planarUV(new ShapeGeometry(roundedRect(new Shape(), 1.6, 1.4, 0.21), 16), 1.6, 1.4)),
      screenLine: taper(new ShapeGeometry(lineShape, 16)),
      frameSeam: new BoxGeometry(0.02, 0.2, 0.012),
      seamFront: new BoxGeometry(0.02, 0.012, 0.52),
      seamLong: new BoxGeometry(0.02, 0.012, 1.0),
      ear: sideways(new CylinderGeometry(0.46, 0.54, 0.2, 48)),
      earCup: faceOut(new CircleGeometry(0.39, 48)),
      earRing: faceOut(new TorusGeometry(0.38, 0.042, 10, 48)),
      lens: faceOut(new CircleGeometry(0.235, 40)),
      eye: new CircleGeometry(1, 48),
      glint: new CircleGeometry(1, 20),
      dot: new SphereGeometry(1, 12, 8),
      brow,
      mouth: new PlaneGeometry(0.96, 0.6),
      neck: new CylinderGeometry(0.17, 0.21, 0.2, 24),
      collar: new TorusGeometry(0.24, 0.05, 10, 32).rotateX(Math.PI / 2),
      chest: chestGeo,
      waist: band(0.305, 0.095, 0.04).scale(1, 1, 0.8),
      waistGap: new CylinderGeometry(0.27, 0.27, 0.22, 28).scale(1, 1, 0.8),
      pelvis,
      chestLight: new CircleGeometry(0.125, 36),
      chestRing: new TorusGeometry(0.165, 0.047, 12, 40),
      shoulder: new SphereGeometry(0.25, 24, 18),
      upperArm: new CapsuleGeometry(0.13, 0.17, 10, 28),
      joint: new SphereGeometry(0.125, 18, 14),
      forearm: new CapsuleGeometry(0.16, 0.15, 10, 28),
      cuff: band(0.185, 0.12, 0.04),
      // A flattened pill: soft all round, and its rounded end drops the outer
      // knuckles a little below the middle one.
      palm: new CapsuleGeometry(0.14, 0.03, 10, 28).scale(1.15, 1, 0.55),
      fingerIndex: digit(0.058, 0.165, 0.5, 0.16),
      fingerMiddle: digit(0.058, 0.18, 0.5, 0.16),
      fingerLittle: digit(0.056, 0.145, 0.5, 0.16),
      thumb: digit(0.066, 0.12, 0.5, 0.18),
      thigh: new CapsuleGeometry(0.2, 0.16, 10, 28),
      knee: new SphereGeometry(0.19, 28, 20),
      shin: new CapsuleGeometry(0.215, 0.18, 10, 28),
      foot: new RoundedBoxGeometry(0.46, 0.26, 0.62, 5, 0.125),
      shadow: new PlaneGeometry(2.8, 1.6),
    },
    mat: {
      shell: metal(COLOR.shell),
      // The head is far bigger than any other part, so its wear tiles more often.
      headShell: metal(COLOR.shell, 3),
      chest,
      shellDark: metal(COLOR.shellDark),
      joint: matte(COLOR.joint),
      frame: new MeshStandardMaterial({ color: COLOR.frame, roughness: 0.7, metalness: 0, map: frameTex }),
      limb: metal(COLOR.limb),
      // Painted like the cover: cool at the top, warm low down, shaded into the frame.
      screen: new MeshStandardMaterial({ roughness: 1, metalness: 0, map: screenTex }),
      ring: metal(COLOR.ring, 1, 1.25),
      // Softer than ink: on the cover this edge is a smudged pencil line.
      screenLine: new MeshBasicMaterial({ color: 0x3d4b56, toneMapped: false }),
      ink: new MeshBasicMaterial({ color: COLOR.ink, toneMapped: false }),
      eye: new MeshBasicMaterial({
        toneMapped: false,
        // Deep navy, a touch lighter low down, as on the cover.
        map: canvasTexture(128, 192, (ctx) => {
          ctx.fillStyle = '#121d2a';
          ctx.fillRect(0, 0, 128, 192);
          const g = ctx.createRadialGradient(70, 150, 0, 70, 150, 92);
          g.addColorStop(0, 'rgb(58 94 122 / 0.85)');
          g.addColorStop(1, 'rgb(58 94 122 / 0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 128, 192);
        }),
      }),
      glint: new MeshBasicMaterial({ color: 0x8fdcea, toneMapped: false }),
      outline,
    },
    shadowTex: radialTexture([
      [0, 'rgb(0 0 0 / 0.5)'],
      [0.55, 'rgb(0 0 0 / 0.18)'],
      [1, 'rgb(0 0 0 / 0)'],
    ]),
    haloTex: radialTexture([
      [0, 'rgb(255 255 255 / 0.9)'],
      [0.25, 'rgb(255 255 255 / 0.35)'],
      [1, 'rgb(255 255 255 / 0)'],
    ]),
    lensTex: canvasTexture(128, 128, (ctx) => {
      // A glassy cyan lens with a soft highlight, as painted on the cover.
      const g = ctx.createRadialGradient(52, 50, 2, 64, 64, 66);
      g.addColorStop(0, '#d2f3f2');
      g.addColorStop(0.22, '#8fdde2');
      g.addColorStop(0.62, '#55bccb');
      g.addColorStop(1, '#2f879c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }),
    questionTex: glyphTexture('?', '#7fd8ff'),
    zTex: glyphTexture('z', '#b8c3e6'),
  };
  return kit;
}

const MOUTH_W = 288;
const MOUTH_H = 180;

function drawMouth(ctx: CanvasRenderingContext2D, { smile, open, wide, wave }: MouthShape) {
  ctx.clearRect(0, 0, MOUTH_W, MOUTH_H);
  const cx = MOUTH_W / 2;
  const cy = 52;
  const half = 124 * wide;
  // An open mouth is a D: nearly flat on top. A closed one is a curved line.
  const drop = smile * (30 - 19 * Math.min(1, open * 2));
  const N = 28;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * 2 - 1;
    const arch = 1 - u * u;
    const mid = cy + drop * (arch - 0.5) + wave * 9 * Math.sin(u * Math.PI * 1.6);
    top.push([cx + u * half, mid - open * 3 * arch]);
    bottom.push([cx + u * half, mid + open * 88 * Math.pow(arch, 0.5)]);
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = COLOR.ink;
  ctx.beginPath();
  top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (open < 0.06) {
    ctx.lineWidth = 11;
    ctx.stroke();
    return;
  }
  for (let i = N; i >= 0; i--) ctx.lineTo(bottom[i][0], bottom[i][1]);
  ctx.closePath();
  // A fat stroke rounds the corners off, like a pencilled mouth.
  ctx.lineWidth = 13;
  ctx.stroke();
  ctx.fill();
  // Tongue, low and a little off-centre like the cover.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = COLOR.tongue;
  ctx.beginPath();
  ctx.ellipse(cx + half * 0.2, bottom[N / 2][1] + 8, half * 0.42, open * 34, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** `env` is the prefiltered sky the metal reflects. */
export function buildRiley(env?: Texture): RileyRig {
  const k = getKit(env);

  /** A mesh, plus its pencil outline. */
  const part = (geo: BufferGeometry, mat: Material, outlined = true) => {
    const mesh = new Mesh(geo, mat);
    if (outlined) mesh.add(new Mesh(geo, k.mat.outline));
    return mesh;
  };

  const root = new Group();
  const body = new Group();
  root.add(body);

  // Untonemapped so the lenses stay the cover's cyan instead of blowing out to white.
  const glowMaterial = new MeshBasicMaterial({ map: k.lensTex, toneMapped: false });
  const halos: Sprite[] = [];
  const halo = (size: number) => {
    const s = new Sprite(
      new SpriteMaterial({ map: k.haloTex, color: COLOR.glow, blending: AdditiveBlending, depthWrite: false, transparent: true }),
    );
    s.scale.setScalar(size);
    s.userData.size = size;
    halos.push(s);
    return s;
  };

  // Legs
  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.position.set(side * 0.24, HIP_Y, 0);
    leg.rotation.z = side * 0.06;
    const thigh = part(k.geo.thigh, k.mat.limb);
    thigh.position.y = -0.2;
    const knee = part(k.geo.knee, k.mat.shell);
    knee.position.set(0, -0.42, 0.06);
    const shin = part(k.geo.shin, k.mat.limb);
    shin.position.y = -0.62;
    const foot = part(k.geo.foot, k.mat.shell);
    foot.position.set(side * 0.02, -0.82, 0.1);
    foot.rotation.y = side * 0.16;
    leg.add(thigh, knee, shin, foot);
    body.add(leg);
  }

  // Torso
  const torso = new Group();
  torso.position.y = HIP_Y;
  body.add(torso);

  const pelvis = part(k.geo.pelvis, k.mat.shell);
  pelvis.position.y = 0.02;
  // A ribbed band at the waist, with a dark gap either side of it.
  const waistGap = part(k.geo.waistGap, k.mat.joint, false);
  waistGap.position.y = 0.27;
  const waist = part(k.geo.waist, k.mat.limb);
  waist.position.y = 0.272;
  const chest = part(k.geo.chest, k.mat.chest);
  chest.position.y = 0.66;
  const chestRing = part(k.geo.chestRing, k.mat.ring, false);
  chestRing.position.set(0, 0.6, 0.305);
  const chestLight = new Mesh(k.geo.chestLight, glowMaterial);
  chestLight.position.set(0, 0.6, 0.338);
  const chestHalo = halo(0.7);
  chestHalo.position.set(0, 0.6, 0.37);
  const collar = part(k.geo.collar, k.mat.shellDark, false);
  collar.position.y = 0.98;
  const neck = part(k.geo.neck, k.mat.joint, false);
  neck.position.y = 1.02;
  torso.add(pelvis, waistGap, waist, chest, chestRing, chestLight, chestHalo, collar, neck);

  // Arms
  const buildArm = (side: -1 | 1): Arm => {
    const shoulder = new Group();
    shoulder.position.set(side * 0.52, 0.8, 0);
    const pad = part(k.geo.shoulder, k.mat.shell);
    pad.scale.set(1, 0.95, 1.05);
    const upper = part(k.geo.upperArm, k.mat.limb);
    upper.position.y = -0.21;
    shoulder.add(pad, upper);

    const elbow = new Group();
    elbow.position.y = -0.41;
    const forearm = part(k.geo.forearm, k.mat.limb);
    forearm.position.y = -0.2;
    elbow.add(part(k.geo.joint, k.mat.joint), forearm);
    shoulder.add(elbow);

    // Big gloved hands in the same painted metal as the rest of Riley, as on
    // the cover: a cuff at the wrist, a soft palm, three long fingers lying
    // together with a gentle curl, and a thumb off the side. The palm faces -z
    // here and the thumb sits on the body's side; stage.ts turns the wrist so
    // the hands hang palm-in.
    const hand = new Group();
    hand.position.y = -0.44;
    hand.scale.setScalar(1.2);
    const cuff = part(k.geo.cuff, k.mat.shell);
    cuff.position.y = 0.07;
    const palm = part(k.geo.palm, k.mat.shell);
    palm.position.y = -0.1;
    hand.add(cuff, palm);
    // Index finger nearest the thumb, then middle, then little finger.
    [k.geo.fingerIndex, k.geo.fingerMiddle, k.geo.fingerLittle].forEach((geo, i) => {
      const x = -side * (1 - i) * 0.1;
      const finger = part(geo, k.mat.shell);
      // Knuckles follow the palm's rounded end; the fingers lie side by side.
      finger.position.set(x, -0.19 + 3 * x * x, 0);
      finger.rotation.set(0.12, 0, -x * 0.15);
      hand.add(finger);
    });
    const thumb = part(k.geo.thumb, k.mat.shell);
    thumb.position.set(-side * 0.11, -0.09, -0.025);
    thumb.rotation.set(0.25, 0, -side * 0.85);
    hand.add(thumb);
    elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = buildArm(-1);
  const armR = buildArm(1);
  torso.add(armL.shoulder, armR.shoulder);

  // Head: the pivot sits on the neck so tilts swing the whole box.
  const head = new Group();
  head.position.y = 1.04;
  torso.add(head);
  const skull = new Group();
  skull.scale.setScalar(HEAD_SCALE);
  skull.position.set(0, (HEAD_H / 2 - 0.02) * HEAD_SCALE, 0.08);
  head.add(skull);

  const shell = part(k.geo.shell, k.mat.headShell);
  shell.position.z = -0.2;
  const sleeve = part(k.geo.sleeve, k.mat.headShell);
  sleeve.position.z = 0.2;
  const frame = part(k.geo.frame, k.mat.frame);
  frame.position.z = 0.63;
  const screen = new Mesh(k.geo.screen, k.mat.screen);
  screen.position.z = FACE.z - 0.004;
  const screenLine = new Mesh(k.geo.screenLine, k.mat.screenLine);
  screenLine.position.z = FACE.z - 0.002;
  // Panel seams, as drawn on the cover: round the box behind the bezel, a
  // notch up the bezel and over the top, then one more running back.
  const seamA = new Mesh(k.geo.seamRing, k.mat.joint);
  seamA.position.z = 0.56;
  const seamB = new Mesh(k.geo.seamRing, k.mat.joint);
  seamB.position.z = 0.2;
  const frameSeam = new Mesh(k.geo.frameSeam, k.mat.ink);
  frameSeam.position.set(-0.36, HEAD_H / 2 - 0.1, 0.802);
  const seamFront = new Mesh(k.geo.seamFront, k.mat.joint);
  seamFront.position.set(-0.36, HEAD_H / 2, 0.46);
  const seamLong = new Mesh(k.geo.seamLong, k.mat.joint);
  seamLong.position.set(0.3, HEAD_H / 2, -0.3);
  skull.add(shell, sleeve, frame, screen, screenLine, seamA, seamB, frameSeam, seamFront, seamLong);

  for (const side of [-1, 1]) {
    const at = <T extends Mesh | Sprite>(m: T, x: number) => {
      m.position.set(side * x, 0, -0.2);
      if (side < 0 && m instanceof Mesh) m.rotation.y = Math.PI;
      return m;
    };
    const edge = HEAD_W / 2;
    const ear = at(part(k.geo.ear, k.mat.shell), edge + 0.09);
    ear.rotation.set(0, 0, side > 0 ? Math.PI : 0);
    skull.add(
      ear,
      at(new Mesh(k.geo.earCup, k.mat.shellDark), edge + 0.197),
      at(new Mesh(k.geo.earRing, k.mat.joint), edge + 0.197),
      at(new Mesh(k.geo.lens, glowMaterial), edge + 0.202),
      at(halo(0.9), edge + 0.3),
    );
  }

  // Face, drawn flat on the screen.
  const buildEye = (side: -1 | 1) => {
    const eye = new Group();
    eye.position.set(side * FACE.eyeX, FACE.eyeY, FACE.z);
    eye.userData.x = side * FACE.eyeX;
    const oval = new Mesh(k.geo.eye, k.mat.eye);
    oval.scale.set(0.195, 0.262, 1);
    const glint = new Mesh(k.geo.glint, k.mat.glint);
    glint.scale.set(0.034, 0.052, 1);
    glint.rotation.z = 0.2;
    eye.add(oval, glint);
    return { eye, glint };
  };
  const { eye: eyeL, glint: glintL } = buildEye(-1);
  const { eye: eyeR, glint: glintR } = buildEye(1);

  const browL = new Group();
  const browR = new Group();
  browL.position.set(-FACE.browX, FACE.browY, FACE.z + 0.012);
  browR.position.set(FACE.browX, FACE.browY, FACE.z + 0.012);
  for (const b of [browL, browR]) {
    b.add(new Mesh(k.geo.brow, k.mat.ink));
    for (const s of [-1, 1]) {
      const tip = new Mesh(k.geo.dot, k.mat.ink);
      tip.scale.setScalar(0.032);
      tip.position.set(s * 0.2 * Math.sin(0.575), 0.2 * Math.cos(0.575) - 0.2, 0);
      b.add(tip);
    }
  }

  const mouthCanvas = document.createElement('canvas');
  mouthCanvas.width = MOUTH_W;
  mouthCanvas.height = MOUTH_H;
  const mouthCtx = mouthCanvas.getContext('2d')!;
  const mouthTex = new CanvasTexture(mouthCanvas);
  mouthTex.colorSpace = SRGBColorSpace;
  const mouth = new Mesh(k.geo.mouth, new MeshBasicMaterial({ map: mouthTex, transparent: true, depthWrite: false, toneMapped: false }));
  mouth.position.set(0, FACE.mouthY, FACE.z + 0.004);
  // The cover's smile is a little lopsided.
  mouth.rotation.z = 0.05;
  skull.add(eyeL, eyeR, browL, browR, mouth);

  const shadow = new Mesh(k.geo.shadow, new MeshBasicMaterial({ map: k.shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.004, 0.1);
  shadow.renderOrder = -1;
  root.add(shadow);

  const marker = (tex: CanvasTexture) => {
    const s = new Sprite(
      new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, opacity: 0 }),
    );
    s.renderOrder = 2;
    root.add(s);
    return s;
  };
  const question = marker(k.questionTex);
  const zzz = [0, 1, 2].map(() => marker(k.zTex));

  let last: MouthShape = { smile: NaN, open: NaN, wide: NaN, wave: NaN };
  const setMouth = (s: MouthShape) => {
    const same = (a: number, b: number) => Math.abs(a - b) < 0.012;
    if (same(s.smile, last.smile) && same(s.open, last.open) && same(s.wide, last.wide) && same(s.wave, last.wave)) return;
    last = { ...s };
    drawMouth(mouthCtx, s);
    mouthTex.needsUpdate = true;
  };

  return { root, body, torso, head, armL, armR, eyeL, eyeR, glintL, glintR, browL, browR, mouth, shadow, question, zzz, glowMaterial, halos, setMouth };
}
