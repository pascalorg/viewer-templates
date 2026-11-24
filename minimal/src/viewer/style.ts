import {
  Color,
  DoubleSide,
  FrontSide,
  LineBasicMaterial,
  type Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshNormalMaterial,
  NoBlending,
  NormalBlending,
  Plane,
  ShaderMaterial,
  type Side,
  type Texture,
  Vector2,
  Vector3,
} from 'three'

/**
 * The drawing's look in one place. Surfaces are flat, near-white and lit just enough to tell
 * faces apart; the ink pass draws every crease and silhouette on top. Change these to restyle.
 */
export const STYLE = {
  /** The paper. Keep it in step with `--bg` in styles.css. */
  background: '#f6f6f3',
  /** The ink. */
  line: '#26282d',
  lineOpacity: 1,
  /** How much ink fades where lines crowd together (foliage, fine clutter): 0 keeps it all. */
  busyFade: 0.75,
  /** What hover lights up. */
  accent: '#3550e0',
  /**
   * The one tint for what is pointed at: the floor of the room under the pointer takes it
   * (`hoverTint` of it: all), its boundary inks in `accent`. Keep `--highlight-soft` in step.
   */
  hover: '#dce3ff',
  hoverTint: 1,
  /** The fill of a wall cut open by the room cutaway: one mid grey for every cut, like a section's poché. */
  section: '#a9abb1',
  /** Where the cutaway cuts walls, above the room's floor (m). */
  cutHeight: 0.3,
  /** How far what lies outside a selected room fades towards the paper (0–1): its shading goes, its lines stay. */
  ghost: 1,
  /**
   * How far past a selected room's outline a shared wall or slab stays in focus (m): its outline
   * runs down the middle of the walls around it, so this keeps their outer half.
   */
  focusReach: 0.3,
  /** The ink's opacity on faded things, relative to `lineOpacity`: enough to keep the house. */
  ghostInk: 0.38,
  /** Line weights, relative to `lineOpacity`: silhouettes and cuts are 1. Objects' outlines (furniture, doors, windows). */
  objectInk: 0.9,
  /** Leaves: their silhouette only. */
  leafInk: 0.55,
  /** Creases inside a surface (a wall's corner, a step), the lightest. */
  creaseInk: 0.9,
  /** The lines render at least at this many pixels to the CSS pixel, so a 1x screen draws them as a 2x one does. */
  inkResolution: 2,
  /** Zoomed out, creases fade to this share, so fine repeating lines (slats, planks) don't shimmer… */
  creaseFar: 0.55,
  /** …between these zooms, in screen pixels to the metre: full at the first, `creaseFar` at the second. */
  creaseFadeZoom: [70, 25] as const,
  /** The ink's opacity on the site (the parcel's edge, the ground), relative to `lineOpacity`. */
  siteInk: 0.3,
  /** The level pointed at with every floor shown: `hover` mixed into its surfaces by this much. */
  levelTint: 0.7,
  /** Surface tone by role; close to Pascal's own "white" preset, so baked and live match. */
  surfaces: {
    wall: '#efeee9',
    floor: '#f7f6f2',
    ceiling: '#efeee9',
    roof: '#e4e2db',
    joinery: '#e8e6df',
    glazing: '#dfe8ec',
    furnishing: '#ecebe6',
    ground: '#f2f1ec',
  },
  /** Fill light: almost all of it, so the drawing stays flat. */
  ambient: 2.6,
  /** Key light: just enough to separate a wall's two faces. */
  key: 0.8,
} as const

export type SurfaceRole = keyof typeof STYLE.surfaces

/** The role a Pascal node kind is drawn as. */
export function roleOfKind(kind: string | undefined): SurfaceRole {
  switch (kind) {
    case 'slab':
    case 'stair':
    case 'stair-segment':
      return 'floor'
    case 'ceiling':
      return 'ceiling'
    case 'roof':
    case 'roof-segment':
      return 'roof'
    case 'door':
    case 'window':
      return 'joinery'
    case 'item':
    case 'cabinet':
    case 'cabinet-module':
    case 'shelf':
    case 'procedural-item':
      return 'furnishing'
    case 'site':
      return 'ground'
    default:
      return 'wall'
  }
}

type ShaderPatch = Parameters<Material['onBeforeCompile']>[0]
type Patch = (shader: ShaderPatch) => void

/**
 * A copy of a material with one more shader patch. Patches stack (a wall can be masked by the
 * selected room and cut by the cutaway at once), and the program cache key names them all.
 */
function patched(material: Material, key: string, patch: Patch): Material {
  const patches: Patch[] = [...((material.userData.patches as Patch[] | undefined) ?? []), patch]
  const keys = `${(material.userData.patchKeys as string | undefined) ?? ''}|${key}`
  const copy = material.clone()
  copy.userData.drawing = true
  copy.userData.patches = patches
  copy.userData.patchKeys = keys
  copy.onBeforeCompile = (shader) => {
    for (const each of patches) each(shader)
  }
  copy.customProgramCacheKey = () => keys
  return copy
}

/** Most outline points a room mask holds; longer outlines are thinned. */
const MASK_POINTS = 64

/**
 * The room masks, one set of uniforms for the whole page. `focus` is the selected room: what
 * lies beyond its outline (plus `focusReach`) on a masked mesh fades like a ghost, so a slab or
 * wall it shares with other rooms is in focus only where it is the room's. `hover` is the room
 * under the pointer: the up-facing surfaces inside it take `STYLE.hover`.
 */
export const ROOM_MASK = {
  focus: maskUniforms(),
  hover: maskUniforms(),
}

function maskUniforms() {
  return {
    points: Array.from({ length: MASK_POINTS }, () => new Vector2()),
    count: 0,
  }
}

/** Sets a mask to a world x/z outline, or clears it (`null`). */
export function setRoomMask(mask: ReturnType<typeof maskUniforms>, outline: readonly [number, number][] | null) {
  const points = outline ?? []
  const step = Math.max(1, Math.ceil(points.length / MASK_POINTS))
  let count = 0
  for (let i = 0; i < points.length && count < MASK_POINTS; i += step) {
    mask.points[count++]!.set(points[i]![0], points[i]![1])
  }
  mask.count = count
}

const maskVertex = /* glsl */ `
varying vec3 vMaskWorld;
varying float vMaskUp;
`
const maskVertexMain = /* glsl */ `
  {
    vec4 maskPoint = vec4(transformed, 1.0);
    vec3 maskNormal = objectNormal;
    #ifdef USE_INSTANCING
      maskPoint = instanceMatrix * maskPoint;
      maskNormal = mat3(instanceMatrix) * maskNormal;
    #endif
    vMaskWorld = (modelMatrix * maskPoint).xyz;
    vMaskUp = normalize(mat3(modelMatrix) * maskNormal).y;
  }
`
const maskFragment = /* glsl */ `
#define MASK_POINTS ${MASK_POINTS}
uniform vec2 focusPoints[MASK_POINTS];
uniform int focusCount;
uniform float focusReach;
varying vec3 vMaskWorld;
varying float vMaskUp;

// How far a point lies outside an outline: 0 inside it.
float outside(vec2 p, vec2 points[MASK_POINTS], int count) {
  bool inside = false;
  float nearest = 1e6;
  for (int i = 0; i < MASK_POINTS; i++) {
    if (i >= count) break;
    vec2 a = points[i];
    vec2 b = points[i + 1 == count ? 0 : i + 1];
    if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    nearest = min(nearest, length(p - a - ab * t));
  }
  return inside ? 0.0 : nearest;
}

uniform vec2 hoverPoints[MASK_POINTS];
uniform int hoverCount;

// 1 on the up-facing part of a floor inside the room pointed at, else 0.
float inHover() {
  return hoverCount > 2 && vMaskUp > 0.7 && outside(vMaskWorld.xz, hoverPoints, hoverCount) == 0.0 ? 1.0 : 0.0;
}

// 1 where a masked surface belongs to the selected room (or none is selected), else 0.
float inFocus() {
  if (focusCount < 3) return 1.0;
  // A floor's top is the room's only inside its outline; walls and edges keep their outer half.
  #ifdef MASK_FLOOR
    float reach = vMaskUp > 0.7 ? 0.005 : focusReach;
  #else
    float reach = focusReach;
  #endif
  return outside(vMaskWorld.xz, focusPoints, focusCount) <= reach ? 1.0 : 0.0;
}
`

function maskUniformsOf(shader: ShaderPatch) {
  shader.uniforms.focusPoints = { value: ROOM_MASK.focus.points }
  shader.uniforms.focusCount = {
    get value() {
      return ROOM_MASK.focus.count
    },
  }
  shader.uniforms.focusReach = { value: STYLE.focusReach }
  shader.uniforms.hoverPoints = { value: ROOM_MASK.hover.points }
  shader.uniforms.hoverCount = {
    get value() {
      return ROOM_MASK.hover.count
    },
  }
}

function maskVertexPatch(shader: ShaderPatch) {
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', `${maskVertex}\nvoid main() {`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${maskVertexMain}`)
}

const maskedCache = { wall: new WeakMap<Material, Material>(), floor: new WeakMap<Material, Material>() }

/**
 * A surface the room masks apply to: walls and floors, which run on from one room into the
 * next. Beyond the selected room it fades towards the paper. A floor's top fades right at the
 * outline, and inside the room under the pointer it takes the hover tint; a wall keeps
 * `focusReach` all round (its top included) and takes no tint.
 */
export function maskedMaterial(material: Material, structure: 'wall' | 'floor'): Material {
  let masked = maskedCache[structure].get(material)
  if (!masked) {
    const floor = structure === 'floor'
    const paperColor = new Color(STYLE.background)
    const hoverColor = new Color(STYLE.hover)
    masked = patched(material, `room-mask-${structure}`, (shader) => {
      maskUniformsOf(shader)
      if (floor) shader.fragmentShader = `#define MASK_FLOOR\n${shader.fragmentShader}`
      shader.uniforms.paperColor = { value: paperColor }
      shader.uniforms.hoverColor = { value: hoverColor }
      shader.uniforms.ghostAmount = { value: STYLE.ghost }
      shader.uniforms.hoverTint = { value: STYLE.hoverTint }
      maskVertexPatch(shader)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `${maskFragment}
uniform vec3 paperColor;
uniform vec3 hoverColor;
uniform float ghostAmount;
uniform float hoverTint;
void main() {`,
        )
        .replace(
          '#include <opaque_fragment>',
          `// After the light: faded parts lose their shading, and the floor pointed at shows its tint exactly.
  outgoingLight = mix(outgoingLight, paperColor, ghostAmount * (1.0 - inFocus()));
  // After the fade, so a faded room still shows it is pointed at.
  if (${floor ? 'true' : 'false'}) outgoingLight = mix(outgoingLight, hoverColor, hoverTint * inHover());
#include <opaque_fragment>`,
        )
    })
    maskedCache[structure].set(material, masked)
  }
  return masked
}

let hairline: LineBasicMaterial | null = null

/** Lines the file draws itself (a site's property line): the ink, as light as the site's edge. */
export function hairlineMaterial(): LineBasicMaterial {
  if (!hairline) {
    hairline = new LineBasicMaterial({
      color: new Color(STYLE.line),
      transparent: true,
      opacity: STYLE.lineOpacity * STYLE.siteInk,
      depthWrite: false,
    })
    hairline.userData.drawing = true
  }
  return hairline
}

const cache = new Map<string, MeshLambertMaterial>()

/** One shared material per role and side; glazing stays see-through. */
export function surfaceMaterial(role: SurfaceRole, side: Side = FrontSide): MeshLambertMaterial {
  const key = `${role}:${side}`
  let material = cache.get(key)
  if (!material) {
    const glazing = role === 'glazing'
    material = new MeshLambertMaterial({
      color: new Color(STYLE.surfaces[role]),
      side,
      transparent: glazing,
      opacity: glazing ? 0.35 : 1,
      depthWrite: !glazing,
    })
    material.userData.drawing = true
    cache.set(key, material)
  }
  return material
}

let accent: MeshLambertMaterial | null = null

/** The hover fill, the one colour in the drawing; a cutout keeps its outline. */
export function accentMaterial(surface?: Material): Material {
  const map = (surface as { map?: Texture | null } | undefined)?.map
  if (surface && map) return cutoutMaterial(STYLE.accent, map, surface.alphaTest, surface.side)
  if (!accent) {
    accent = new MeshLambertMaterial({ color: new Color(STYLE.accent), side: DoubleSide })
    accent.userData.drawing = true
  }
  return accent
}

/**
 * The cutaway's plane: walls cut open keep what lies below it. One plane for the whole page,
 * since one room is open at a time; `Model` moves it to that room's floor plus `cutHeight`.
 */
export const CUT_PLANE = new Plane(new Vector3(0, -1, 0), 0)

const clippedCache = new WeakMap<Material, Material>()

/**
 * A surface's material cut by `CUT_PLANE`. Both sides draw, and the back faces take the
 * section colour, so looking down into a cut wall reads as a solid filled section.
 */
export function clippedMaterial(material: Material): Material {
  let clipped = clippedCache.get(material)
  if (!clipped) {
    const section = new Color(STYLE.section)
    clipped = patched(material, 'clipped-section', (shader) => {
      shader.uniforms.sectionColor = { value: section }
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 sectionColor;\nvoid main() {')
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor = linearToOutputTexel(vec4(sectionColor, 1.0));',
        )
    })
    clipped.side = DoubleSide
    clipped.clippingPlanes = [CUT_PLANE]
    clippedCache.set(material, clipped)
  }
  return clipped
}

const cutoutCache = new Map<string, MeshLambertMaterial>()

/**
 * A flat tone for leaves and other textured cutouts: the texture is kept for its alpha only, so
 * the outline of each leaf survives while its colour does not.
 */
export function cutoutMaterial(color: string, map: Texture, alphaTest: number, side: Side): MeshLambertMaterial {
  const key = `${color}:${map.uuid}:${alphaTest}:${side}`
  let material = cutoutCache.get(key)
  if (!material) {
    material = new MeshLambertMaterial({ color: new Color(color), map, alphaTest, side })
    material.userData.drawing = true
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#ifdef USE_MAP\n  diffuseColor.a *= texture2D(map, vMapUv).a;\n#endif',
      )
    }
    material.customProgramCacheKey = () => 'alpha-only-map'
    cutoutCache.set(key, material)
  }
  return material
}

/**
 * What the ink's normal pass writes in alpha: 1 for structure in focus, `OBJECT_TAG` for objects
 * (lighter outlines), `LEAF_TAG` for leaves (silhouette only), `HOVER_TAG` for the floor of the
 * room pointed at (its edge inks in the accent), `SOFT_TAG` for the site, `GHOST_TAG` for what a
 * selected room fades; 0 is the background. Keep the tiers in step with the ink shader in
 * `InkPass.tsx`; they sit apart by more than 8-bit rounding.
 */
export const OBJECT_TAG = 0.97
export const LEAF_TAG = 0.94
export const HOVER_TAG = 0.9
export const SOFT_TAG = 0.8
export const GHOST_TAG = 0.6

export type Cutout = { map: Texture; alphaTest: number }

const normalsCache = new Map<string, Material>()

/**
 * A mesh's own material for the ink's normal pass: cut by the cutaway, faded by a selected
 * room, or keeping a leaf's outline. View-space normals in RGB, the focus tag in alpha.
 */
export function inkNormalMaterial({ clipped = false, ghost = false, soft = false, object = false, masked = false, cutout }: {
  clipped?: boolean
  ghost?: boolean
  /** The site: inked lightly. A faded mesh stays faded. */
  soft?: boolean
  /** An object (furniture, a door, a window): outlined lighter than structure. */
  object?: boolean
  /** Tagged per fragment by the selected room's mask, like `maskedMaterial`. */
  masked?: 'wall' | 'floor' | false
  cutout?: Cutout
}): Material {
  const tag = ghost ? GHOST_TAG : soft ? SOFT_TAG : cutout ? LEAF_TAG : object ? OBJECT_TAG : 1
  const key = `${clipped}:${tag}:${masked}:${cutout ? `${cutout.map.uuid}:${cutout.alphaTest}` : ''}`
  let material = normalsCache.get(key)
  if (material) return material
  if (cutout) {
    material = new ShaderMaterial({
      side: DoubleSide,
      uniforms: {
        alphaSource: { value: cutout.map },
        alphaCut: { value: cutout.alphaTest },
        tag: { value: tag },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vViewNormal;
        void main() {
          vUv = uv;
          vec3 objectNormal = normal;
          vec4 local = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            objectNormal = mat3(instanceMatrix) * objectNormal;
            local = instanceMatrix * local;
          #endif
          vViewNormal = normalize(normalMatrix * objectNormal);
          gl_Position = projectionMatrix * modelViewMatrix * local;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D alphaSource;
        uniform float alphaCut;
        uniform float tag;
        varying vec2 vUv;
        varying vec3 vViewNormal;
        void main() {
          if (texture2D(alphaSource, vUv).a < alphaCut) discard;
          vec3 n = normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          gl_FragColor = vec4(n * 0.5 + 0.5, tag);
        }
      `,
    })
  } else {
    // No blending, so three writes the opacity into alpha instead of forcing it to 1.
    material = new MeshNormalMaterial({
      side: DoubleSide,
      opacity: tag,
      blending: tag < 1 || masked ? NoBlending : NormalBlending,
      clippingPlanes: clipped ? [CUT_PLANE] : null,
    })
    if (masked) {
      const floor = masked === 'floor'
      material = patched(material, `room-mask-normal-${masked}`, (shader) => {
        maskUniformsOf(shader)
        if (floor) shader.fragmentShader = `#define MASK_FLOOR\n${shader.fragmentShader}`
        maskVertexPatch(shader)
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', `${maskFragment}\nvoid main() {`)
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>\n  diffuseColor.a = mix(${GHOST_TAG.toFixed(2)}, 1.0, inFocus());${
              floor ? `\n  diffuseColor.a = mix(diffuseColor.a, ${HOVER_TAG.toFixed(2)}, inHover());` : ''
            }`,
          )
      })
    }
  }
  material.userData.drawing = true
  normalsCache.set(key, material)
  return material
}

const ghostCache = new WeakMap<Material, Material>()
const paper = new Color(STYLE.background)

const tintCache = new WeakMap<Material, Material>()

/** A surface washed with the hover colour: the floor pointed at while every floor shows. */
export function tintMaterial(material: Material): Material {
  let tinted = tintCache.get(material)
  if (!tinted) {
    const color = new Color(STYLE.hover)
    tinted = patched(material, 'level-tint', (shader) => {
      shader.uniforms.tintColor = { value: color }
      shader.uniforms.tintAmount = { value: STYLE.levelTint }
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 tintColor;\nuniform float tintAmount;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, tintColor, tintAmount);',
        )
    })
    tintCache.set(material, tinted)
  }
  return tinted
}

/**
 * A surface faded towards the paper, for what lies outside a selected room: unlit, so only its
 * (lighter) lines say where it is. A leaf keeps its outline.
 */
export function ghostMaterial(material: Material): Material {
  let ghost = ghostCache.get(material)
  if (!ghost) {
    const color = (material as MeshLambertMaterial).color?.clone().lerp(paper, STYLE.ghost)
    const map = (material as { map?: Texture | null }).map
    if (map && color) {
      ghost = cutoutMaterial(`#${color.getHexString()}`, map, material.alphaTest, material.side)
    } else {
      ghost = new MeshBasicMaterial({ color: color ?? paper, side: material.side })
      ghost.userData.drawing = true
    }
    ghostCache.set(material, ghost)
  }
  return ghost
}
