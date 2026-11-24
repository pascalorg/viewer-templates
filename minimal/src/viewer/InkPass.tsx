import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  Color,
  DepthTexture,
  DoubleSide,
  LinearFilter,
  type Material,
  Mesh,
  MeshNormalMaterial,
  NoBlending,
  type OrthographicCamera,
  OrthographicCamera as QuadCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three'
import { OBJECT_TAG, STYLE } from './style'

/** Layer for see-through surfaces (glass): drawn, but left out of the ink's normal pass. */
export const GLAZING_LAYER = 2

/**
 * Layer for meshes the ink's normal pass draws with their own material, from `inkMaterials`:
 * leaves whose texture cuts their outline, walls cut open by the room cutaway.
 */
export const OWN_INK_LAYER = 3

/** Layer for objects (furniture, doors, windows): the normal pass tags them, for lighter lines. */
export const OBJECT_LAYER = 4

/** The normal-pass material of each mesh on `OWN_INK_LAYER`. */
export const inkMaterials = new Map<Mesh, Material>()

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Screen-space ink, the line drawing's lines, in three weights:
 * - silhouettes and cuts, where depth steps: depth from an orthographic camera is linear, so a
 *   flat surface has no second derivative at any angle and only real steps draw. Structure's
 *   draw on both sides of the step (heaviest); an object's or a leaf's on its own side only.
 * - object outlines (furniture, doors, windows): their tag in the normal pass, `objectInk`.
 * - creases, where neighbouring normals turn by more than ~30° without a step, at `creaseInk`:
 *   two pixels on structure, one (on one side) on objects, fading as the drawing zooms out
 *   (`creaseFade`), so fine repeating lines (slats, planks) don't shimmer.
 * Leaves draw their silhouette only: a step between two leaves draws nothing.
 */
const fragmentShader = /* glsl */ `
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float depthRange;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float busyRadius;
uniform float busyFade;
uniform float ghostInk;
uniform float siteInk;
uniform float objectInk;
uniform float leafInk;
uniform float creaseInk;
uniform float creaseFade;
varying vec2 vUv;

float depthAt(vec2 uv) { return texture2D(tDepth, uv).x * depthRange; }
vec4 normalAt(vec2 uv) {
  vec4 encoded = texture2D(tNormal, uv);
  return vec4(encoded.xyz * 2.0 - 1.0, encoded.a);
}

// Tags in alpha (style.ts): 1 structure, 0.97 an object, 0.94 a leaf, 0.9 the floor pointed at
// (structure too), 0.8 the site, 0.6 what a selected room fades, 0 the background.
bool isObject(float a) { return a > 0.955 && a < 0.985; }
bool isLeaf(float a) { return a > 0.92 && a <= 0.955; }
bool isPointedAt(float a) { return a > 0.85 && a <= 0.92; }
bool isStructure(float a) { return a >= 0.985 || isPointedAt(a); }
bool isGhost(float a) { return a > 0.25 && a <= 0.7; }

// How dark a line on a surface with this tag draws, relative to the ink.
float weightOf(float a) {
  if (isStructure(a)) return 1.0;
  if (isObject(a)) return objectInk;
  if (isLeaf(a)) return leafInk;
  if (a > 0.7) return siteInk;
  if (a > 0.25) return ghostInk;
  return 0.0;
}

// How far two surfaces' normals turn apart; nothing against the background (depth draws that).
float turn(vec4 a, vec4 b) {
  if (a.a < 0.25 || b.a < 0.25) return 0.0;
  return 1.0 - dot(a.xyz, b.xyz);
}

void main() {
  vec2 dx = vec2(texel.x, 0.0);
  vec2 dy = vec2(0.0, texel.y);
  float dc = depthAt(vUv);
  float dl = depthAt(vUv - dx);
  float dr = depthAt(vUv + dx);
  float dd = depthAt(vUv - dy);
  float du = depthAt(vUv + dy);
  vec4 nc = normalAt(vUv);
  vec4 nl = normalAt(vUv - dx);
  vec4 nr = normalAt(vUv + dx);
  vec4 nd = normalAt(vUv - dy);
  vec4 nu = normalAt(vUv + dy);

  // A step's sign says which side of it this pixel is on: positive, in front (the near side).
  float lapX = dl + dr - 2.0 * dc;
  float lapY = du + dd - 2.0 * dc;
  float nearSide = smoothstep(depthThreshold, depthThreshold * 2.0, max(lapX, lapY));
  float farSide = smoothstep(depthThreshold, depthThreshold * 2.0, max(-lapX, -lapY));
  // The neighbours nearest and farthest from the camera, and what they are.
  float dn = dl; float tn = nl.a; float df = dl; float tf = nl.a;
  if (dr < dn) { dn = dr; tn = nr.a; } if (dr > df) { df = dr; tf = nr.a; }
  if (dd < dn) { dn = dd; tn = nd.a; } if (dd > df) { df = dd; tf = nd.a; }
  if (du < dn) { dn = du; tn = nu.a; } if (du > df) { df = du; tf = nu.a; }
  // Near side: this surface's own outline. A leaf in front of a leaf draws nothing.
  float near = nearSide * (isLeaf(nc.a) && isLeaf(tf) ? 0.0 : weightOf(nc.a));
  // Far side: only behind structure (or what a selected room fades), so walls, slabs and cuts
  // draw two pixels wide and an object or leaf one.
  float far = farSide * (isStructure(tn) || isGhost(tn) ? weightOf(tn) : 0.0);
  float silhouette = max(near, far);

  // Creases: on structure towards every side, two pixels wide like its silhouettes; on objects
  // towards the right and up only, one pixel, so dense furniture doesn't clump.
  float bend = max(turn(nc, nr), turn(nc, nu));
  if (isStructure(nc.a)) bend = max(bend, max(turn(nc, nl), turn(nc, nd)));
  float creaseEdge = smoothstep(normalThreshold, normalThreshold * 1.6, bend);
  float creaseWeight = isLeaf(nc.a) ? 0.0 : isStructure(nc.a) ? creaseInk : weightOf(nc.a) * creaseInk;
  float crease = creaseEdge * creaseWeight * creaseFade;

  float edge = max(silhouette, crease);

  // Busyness: on a ring a few pixels out, how many surfaces turn away from this one. A crease
  // or corner turns on about half the ring; fine clutter on nearly all of it, and would turn
  // solid black, so ink there fades to a grey hatch. Background doesn't count, so a thin pole
  // or rail against the sky keeps its full line.
  float busy = 0.0;
  if (edge > 0.0 && nc.a > 0.5) {
    for (int i = 0; i < 12; i++) {
      float angle = float(i) * 0.5235988;
      vec2 at = vUv + vec2(cos(angle), sin(angle)) * texel * busyRadius;
      vec4 n = normalAt(at);
      bool turns = 1.0 - dot(nc.xyz, n.xyz) > normalThreshold;
      bool steps = abs(depthAt(at) - dc) > depthThreshold * 3.0;
      if (n.a > 0.5 && (turns || steps)) busy += 1.0 / 12.0;
    }
  }
  edge *= 1.0 - busyFade * smoothstep(0.55, 0.85, busy);

  // The edge of the floor pointed at, where it meets structure (walls, a step, a cut), inks in
  // the accent at full weight, in the second channel. Furniture just sits on it.
  bool hc = isPointedAt(nc.a);
  bool structureAround = nl.a >= 0.985 || nr.a >= 0.985 || nd.a >= 0.985 || nu.a >= 0.985;
  bool pointedAround = isPointedAt(nl.a) || isPointedAt(nr.a) || isPointedAt(nd.a) || isPointedAt(nu.a);
  float rim = 0.0;
  if ((hc && structureAround) || (nc.a >= 0.985 && pointedAround)) {
    rim = max(max(nearSide, farSide), creaseEdge);
    edge = max(edge, rim);
  }

  gl_FragColor = vec4(edge, rim, 0.0, 1.0);
}
`

/**
 * The ink onto the drawing, smoothed. The edge test is per pixel, so a sloping line comes out
 * stepped; FXAA (the compact variant) blends each pixel along the line's direction, so roof
 * hips and diagonals in an axonometric draw clean. It reads the ink alone, a single channel,
 * and the surfaces keep the canvas's own multisampling.
 */
const smoothShader = /* glsl */ `
uniform sampler2D tInk;
uniform vec2 texel;
uniform vec3 inkColor;
uniform vec3 rimColor;
uniform float opacity;
varying vec2 vUv;

// The ink in x, the share of it on the edge of the floor pointed at in y.
vec2 sampleAt(vec2 uv) { return texture2D(tInk, uv).rg; }
float inkAt(vec2 uv) { return texture2D(tInk, uv).r; }

void main() {
  // The four diagonal neighbours; dir runs along the line, across the ink's gradient.
  float nw = inkAt(vUv + vec2(-1.0, -1.0) * texel);
  float ne = inkAt(vUv + vec2(1.0, -1.0) * texel);
  float sw = inkAt(vUv + vec2(-1.0, 1.0) * texel);
  float se = inkAt(vUv + vec2(1.0, 1.0) * texel);
  float m = inkAt(vUv);
  float lo = min(m, min(min(nw, ne), min(sw, se)));
  float hi = max(m, max(max(nw, ne), max(sw, se)));
  vec2 dir = vec2((sw + se) - (nw + ne), (nw + sw) - (ne + se));
  float reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  float scale = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * scale, -8.0, 8.0) * texel;
  vec2 a = 0.5 * (sampleAt(vUv - dir / 6.0) + sampleAt(vUv + dir / 6.0));
  vec2 b = 0.5 * a + 0.25 * (sampleAt(vUv - dir * 0.5) + sampleAt(vUv + dir * 0.5));
  vec2 ink = (b.x < lo || b.x > hi) ? a : b;
  vec3 color = mix(inkColor, rimColor, clamp(ink.y / max(ink.x, 0.001), 0.0, 1.0));
  gl_FragColor = vec4(color, ink.x * opacity);
  #include <colorspace_fragment>
}
`

/** Whether WebGL runs on the CPU (no GPU, or one the browser blocks): every pixel then costs. */
function isSoftwareRenderer(context: WebGLRenderingContext | WebGL2RenderingContext) {
  const info = context.getExtension('WEBGL_debug_renderer_info')
  const name = String(context.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER))
  return /swiftshader|llvmpipe|softpipe|software/i.test(name)
}

/**
 * Takes over rendering: a normal and depth pass of the opaque scene into a target, the scene
 * itself, then the ink composited on top. Needs an orthographic camera.
 */
export function InkPass() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera) as OrthographicCamera
  const size = useThree((state) => state.size)
  const software = useMemo(() => isSoftwareRenderer(gl.getContext()), [gl])

  const resources = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1) })
    // The ink before smoothing: one channel, filtered, so FXAA can read between pixels.
    const inkTarget = new WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter })
    const normals = new MeshNormalMaterial({ side: DoubleSide })
    // No blending, so three writes the opacity into alpha: the object tag.
    const objectNormals = new MeshNormalMaterial({ side: DoubleSide, opacity: OBJECT_TAG, blending: NoBlending })
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tNormal: { value: target.texture },
        tDepth: { value: target.depthTexture },
        texel: { value: new Vector2() },
        depthRange: { value: 1 },
        depthThreshold: { value: 0.05 },
        normalThreshold: { value: 0.12 },
        busyRadius: { value: 4 },
        busyFade: { value: STYLE.busyFade },
        ghostInk: { value: STYLE.ghostInk },
        siteInk: { value: STYLE.siteInk },
        objectInk: { value: STYLE.objectInk },
        leafInk: { value: STYLE.leafInk },
        creaseInk: { value: STYLE.creaseInk },
        creaseFade: { value: 1 },
      },
    })
    const smooth = new ShaderMaterial({
      vertexShader,
      fragmentShader: smoothShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tInk: { value: inkTarget.texture },
        texel: { value: new Vector2() },
        inkColor: { value: new Color(STYLE.line) },
        rimColor: { value: new Color(STYLE.accent) },
        opacity: { value: STYLE.lineOpacity },
      },
    })
    const quad = new Mesh(new PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    const overlay = new Scene()
    overlay.add(quad)
    return { target, inkTarget, normals, objectNormals, material, smooth, quad, overlay, quadCamera: new QuadCamera() }
  }, [])

  useEffect(
    () => () => {
      resources.target.depthTexture?.dispose()
      resources.target.dispose()
      resources.inkTarget.dispose()
      resources.normals.dispose()
      resources.objectNormals.dispose()
      resources.material.dispose()
      resources.smooth.dispose()
      resources.quad.geometry.dispose()
    },
    [resources],
  )

  useFrame(() => {
    const { target, inkTarget, normals, objectNormals, material, smooth, quad, overlay, quadCamera } = resources
    // The lines are found per pixel, so they render at least at `inkResolution` pixels to the
    // CSS pixel, whatever the screen: on a 1x monitor at twice its resolution, then scaled
    // down by the smoothing pass, as a 2x screen gets for free. Otherwise a 1x screen's lines
    // are one coarse pixel, stepped on every diagonal and broken on thin frames. Without a GPU
    // (a software renderer) four times the pixels would slow every frame: the screen's own.
    const ratio = software ? gl.getPixelRatio() : Math.max(gl.getPixelRatio(), STYLE.inkResolution)
    const width = Math.max(1, Math.floor(size.width * ratio))
    const height = Math.max(1, Math.floor(size.height * ratio))
    const screenRatio = gl.getPixelRatio()
    if (target.width !== width || target.height !== height) {
      target.setSize(width, height)
      inkTarget.setSize(width, height)
    }

    // Normals and depth of the opaque scene: most of it with one shared material, then the
    // meshes that bring their own (leaf cutouts, walls cut open).
    const background = scene.background
    const layers = camera.layers.mask
    const autoClear = gl.autoClear
    camera.layers.set(0)
    scene.background = null
    scene.overrideMaterial = normals
    gl.setRenderTarget(target)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(scene, camera)
    // Objects (furniture, doors, windows): tagged, for their lighter lines.
    camera.layers.set(OBJECT_LAYER)
    scene.overrideMaterial = objectNormals
    gl.autoClear = false
    gl.render(scene, camera)
    gl.autoClear = autoClear
    scene.overrideMaterial = null
    if (inkMaterials.size) {
      const drawn = new Map<Mesh, Material | Material[]>()
      for (const [mesh, ink] of inkMaterials) {
        drawn.set(mesh, mesh.material)
        mesh.material = ink
      }
      camera.layers.set(OWN_INK_LAYER)
      gl.autoClear = false
      gl.render(scene, camera)
      gl.autoClear = autoClear
      for (const [mesh, material] of drawn) mesh.material = material
    }
    scene.background = background
    camera.layers.mask = layers
    gl.setRenderTarget(null)

    // The drawing's surfaces.
    gl.render(scene, camera)

    // The ink. A step must be a few pixels deep, and at least a few centimetres.
    const pixel = 1 / (camera.zoom * ratio)
    material.uniforms.texel!.value.set(1 / width, 1 / height)
    material.uniforms.depthRange!.value = camera.far - camera.near
    material.uniforms.depthThreshold!.value = Math.max(0.03, pixel * 4)
    material.uniforms.busyRadius!.value = 2 * ratio
    // Zoomed out (few pixels to the metre), fine creases fade towards `creaseFar`.
    const [near, far] = STYLE.creaseFadeZoom
    material.uniforms.creaseFade!.value =
      STYLE.creaseFar + (1 - STYLE.creaseFar) * Math.min(1, Math.max(0, (camera.zoom - far) / (near - far)))
    quad.material = material
    gl.setRenderTarget(inkTarget)
    gl.render(overlay, quadCamera)
    gl.setRenderTarget(null)

    // Smoothed, over the drawing, one screen pixel at a time: where the lines rendered finer,
    // each screen pixel's filtered read averages the finer pixels under it.
    smooth.uniforms.texel!.value.set(1 / Math.max(1, size.width * screenRatio), 1 / Math.max(1, size.height * screenRatio))
    quad.material = smooth
    gl.autoClear = false
    gl.render(overlay, quadCamera)
    gl.autoClear = autoClear
  }, 1)

  return null
}
