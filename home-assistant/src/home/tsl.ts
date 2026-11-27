import * as THREE from 'three'
import * as TSL from 'three/tsl'
import * as WebGPU from 'three/webgpu'

/* Shared by every device effect. Effects are written in three's node language (TSL), which the
   Pascal viewer's WebGPU renderer compiles to WGSL, or to GLSL on its WebGL 2 fallback. */

/** three's WebGPU classes and node functions, without the (very strict) node typings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const W: any = WebGPU
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const N: any = TSL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Node = any

const { cameraProjectionMatrix, cameraViewMatrix, modelWorldMatrix, mrt, output, positionGeometry, screenSize, sRGBTransferEOTF, vec4 } = N

export type NodeShader = THREE.Material & { uniforms: Record<string, Node>; [key: string]: unknown }

/** What an effect material is made of: its colour and opacity, and optionally where its vertices go
    (`position` in the mesh's own space, or `vertex` straight to clip space). */
export type ShaderParts = { color: Node; opacity: Node; position?: Node; vertex?: Node }

/**
 * An unlit effect material from nodes; `uniforms` stay readable as `mat.uniforms.uX.value`.
 *
 * It colours through `colorNode`/`opacityNode`, never a whole `fragmentNode`: the Pascal viewer's
 * scene pass draws to several targets (colour, normals, diffuse colour, lighting), and a material
 * with its own fragment output skips them and draws nothing. Like Pascal's own glows and dust it
 * writes only the colour, and alpha 0 into normals and diffuse colour, so the outline ink and the
 * screen-space lighting don't treat a glow's quad as a surface.
 */
export function shader<U extends Record<string, Node>>(uniforms: U, build: (u: U) => ShaderParts, params: Record<string, unknown> = {}): NodeShader & { uniforms: U } {
  const mat = new W.MeshBasicNodeMaterial()
  const { color, opacity, position, vertex } = build(uniforms)
  if (position) mat.positionNode = position
  if (vertex) mat.vertexNode = vertex
  mat.colorNode = color
  mat.opacityNode = opacity
  mat.mrtNode = glowMrt()
  mat.fog = false
  mat.toneMapped = false
  mat.uniforms = uniforms
  Object.assign(mat, params)
  return mat
}

/** The scene-pass outputs of a glow: its colour only, nothing into normals or diffuse colour. */
export const glowMrt = () => mrt({ output, diffuseColor: vec4(0), normal: vec4(0) })

/** This mesh's vertex in world space. */
export const worldPosition = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz
/** A local-space position through this mesh's world matrix, to clip space. */
export const localToClip = (local: Node) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix.mul(vec4(local, 1)))
/** A colour already picked for the screen: undoes the output transform, so it displays exactly as written. */
export const asDisplayed = (color: Node) => sRGBTransferEOTF(color)

/* WebGPU only draws 1 px points, so a particle stream is one instanced quad per particle. */

/** Grows a point's clip position into its quad, `size` device pixels across. */
export const pointQuad = (clip: Node, size: Node) => clip.add(vec4(positionGeometry.xy.mul(size).mul(2).div(screenSize).mul(clip.w), 0, 0))
/** Where this fragment sits in its point, -0.5..0.5. */
export const pointCoord = () => N.varying(positionGeometry.xy)

/** An instanced quad with room for `count` points; the attributes are the per-point data. */
export function quadPoints(count: number, attributes: Record<string, THREE.InstancedBufferAttribute>) {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  for (const [name, a] of Object.entries(attributes)) g.setAttribute(name, a)
  g.instanceCount = count
  return g
}
