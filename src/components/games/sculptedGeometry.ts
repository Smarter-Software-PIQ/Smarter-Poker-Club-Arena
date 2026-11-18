import * as THREE from 'three';

/** A rounded cross section along a body: axial position, underside, crown, half-width. */
export type BodySection = readonly [number, number, number, number];

/** Smooth, closed surface through anatomical or aerodynamic cross sections. */
export function sculptedGeometry(sections: readonly BodySection[], radial = 32) {
  const centers = sections.map(([x, bottom, top]) => new THREE.Vector3(x, (bottom + top) / 2, 0));
  const center = new THREE.CatmullRomCurve3(centers, false, 'centripetal');
  const radius = new THREE.CatmullRomCurve3(
    sections.map(([, bottom, top, width]) => new THREE.Vector3(width, (top - bottom) / 2, 0)),
    false,
    'centripetal'
  );
  const rings = Math.max(48, sections.length * 8);
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const point = new THREE.Vector3(),
    extent = new THREE.Vector3();
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    center.getPoint(t, point);
    radius.getPoint(t, extent);
    for (let side = 0; side <= radial; side++) {
      const angle = (side / radial) * Math.PI * 2;
      positions.push(
        point.x,
        point.y + Math.cos(angle) * Math.max(0, extent.y),
        Math.sin(angle) * Math.max(0, extent.x)
      );
      uvs.push(t, side / radial);
      if (ring < rings && side < radial) {
        const a = ring * (radial + 1) + side,
          b = a + radial + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
