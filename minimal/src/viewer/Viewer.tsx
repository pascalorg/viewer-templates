import { Canvas, useFrame } from '@react-three/fiber'
import { useCallback, useRef, useState } from 'react'
import { type DirectionalLight, NoToneMapping, Vector3 } from 'three'
import type { SceneGraph } from '../pascal'
import { AxoControls } from './AxoControls'
import { GLAZING_LAYER, InkPass, OBJECT_LAYER, OWN_INK_LAYER } from './InkPass'
import { MeasureTool } from './MeasureTool'
import { type FocusProps, Model, type ModelInfo, type ModelSource } from './Model'
import { STYLE } from './style'

export type ViewerProps = FocusProps & {
  /** The baked file, or a scene captured from Pascal's runtime (`LiveViewer`). */
  source: ModelSource
  graph: SceneGraph
  label: string
  onReady: (info: ModelInfo) => void
  onError: (error: unknown) => void
}

/**
 * The 3D canvas as a line drawing: an orthographic camera, flat near-white surfaces under
 * soft light, and screen-space ink for every edge. Swap this file to restyle.
 */
export function Viewer({ label, onReady, ...modelProps }: ViewerProps) {
  const [model, setModel] = useState<ModelInfo | null>(null)
  const handleReady = useCallback(
    (info: ModelInfo) => {
      setModel(info)
      onReady(info)
    },
    [onReady],
  )

  return (
    <Canvas
      aria-label={label}
      camera={{ position: [20, 20, 20], zoom: 20, near: 0.01, far: 200 }}
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ antialias: true }}
      orthographic
      onCreated={({ gl, camera, raycaster }) => {
        gl.toneMapping = NoToneMapping
        // The room cutaway clips walls per material.
        gl.localClippingEnabled = true
        for (const layer of [GLAZING_LAYER, OWN_INK_LAYER, OBJECT_LAYER]) {
          camera.layers.enable(layer)
          raycaster.layers.enable(layer)
        }
      }}
    >
      <color args={[STYLE.background]} attach="background" />
      <Lights />
      <Model {...modelProps} onReady={handleReady} />
      <AxoControls bounds={model?.bounds ?? null} />
      <MeasureTool />
      <InkPass />
    </Canvas>
  )
}

/**
 * Where the key light comes from: mostly from above, so floors and tops stay the lightest in
 * every view (plan included), plus a little from the camera's left and front, so the two wall
 * faces you see read as two tones.
 */
const KEY_UP = 1
const KEY_LEFT = 0.55
const KEY_FRONT = 0.35

const right = new Vector3()
const back = new Vector3()

/** Soft, shadowless light that turns with the camera, like an illustrator's shading. */
function Lights() {
  const light = useRef<DirectionalLight>(null)
  useFrame(({ camera }) => {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    back.set(0, 0, 1).applyQuaternion(camera.quaternion)
    light.current?.position
      .set(0, KEY_UP, 0)
      .addScaledVector(right, -KEY_LEFT)
      .addScaledVector(back, KEY_FRONT)
      .normalize()
  })
  return (
    <>
      <ambientLight intensity={STYLE.ambient} />
      <directionalLight intensity={STYLE.key} ref={light} />
    </>
  )
}
