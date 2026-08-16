/**
 * Blender-style infinite fade grid. 1 unit = 1 m (SI).
 * Shader plane — not a new npm. Marked forgeInternal so pick/frame skip it.
 */
import * as THREE from "three";

export interface InfiniteGridOptions {
  cellSize?: number;
  sectionSize?: number;
  cellColor?: number;
  sectionColor?: number;
  fadeDistance?: number;
}

export function createInfiniteGrid(opts: InfiniteGridOptions = {}): THREE.Mesh {
  const cellSize = opts.cellSize ?? 1;
  const sectionSize = opts.sectionSize ?? 10;
  const cellColor = new THREE.Color(opts.cellColor ?? 0x1c2a55);
  const sectionColor = new THREE.Color(opts.sectionColor ?? 0xffc62a);
  const fadeDistance = opts.fadeDistance ?? 48;

  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uCell: { value: cellSize },
      uSection: { value: sectionSize },
      uColorCell: { value: cellColor },
      uColorSection: { value: sectionColor },
      uFade: { value: fadeDistance },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        // Cover the XZ plane far beyond the camera
        vec3 pos = position.xzy * 400.0;
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      uniform float uCell;
      uniform float uSection;
      uniform vec3 uColorCell;
      uniform vec3 uColorSection;
      uniform float uFade;

      float line(vec2 coord, float size) {
        vec2 c = coord / size;
        vec2 fw = max(abs(vec2(dFdx(c.x), dFdy(c.y))), vec2(1e-4));
        vec2 g = abs(fract(c - 0.5) - 0.5) / fw;
        return 1.0 - min(min(g.x, g.y), 1.0);
      }

      void main() {
        vec2 p = vWorld.xz;
        float dist = length(p);
        float fade = 1.0 - smoothstep(uFade * 0.45, uFade, dist);
        float minor = line(p, uCell);
        float major = line(p, uSection);
        vec3 col = mix(uColorCell, uColorSection, clamp(major, 0.0, 1.0));
        float alpha = max(minor * 0.35, major * 0.7) * fade;
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "GrudgeInfiniteGrid";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.userData.forgeInternal = true;
  return mesh;
}

export function setInfiniteGridCellSize(grid: THREE.Object3D, cell: number, section?: number): void {
  const mat = (grid as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
  if (!mat?.uniforms) return;
  mat.uniforms.uCell.value = Math.max(0.01, cell);
  if (section != null) mat.uniforms.uSection.value = Math.max(cell, section);
}
