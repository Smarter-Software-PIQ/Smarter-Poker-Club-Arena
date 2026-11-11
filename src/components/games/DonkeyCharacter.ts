import * as THREE from 'three';
import { mediaUrl } from '../../utils/mediaBase';
import { CROSSING_CAMERA } from '../../utils/crossingScene';

/** The approved reward mascot, articulated in world space without rebuilding its face from primitives. */
interface CharacterKit {
  own<T extends THREE.BufferGeometry>(geometry: T): T;
  keep<T extends THREE.Material>(material: T): T;
  texture<T extends THREE.Texture>(texture: T): T;
}
const WIDTH = 4.35;
const HEIGHT = 2.9;
const PITCH = (CROSSING_CAMERA.pitch * Math.PI) / 180;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Original 1536×1024 artwork coordinates. Each leg remains attached at its own hip/shoulder. */
const FEET = [410, 650, 1095, 808];
const HIPS = [590, 720, 1000, 900];
export function poseDonkeyArtwork(
  geometry: THREE.BufferGeometry,
  strides: readonly number[],
  ears: readonly number[],
  tail: number,
  scarf: number
) {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const px = uv.getX(i) * 1536;
    const py = (1 - uv.getY(i)) * 1024;
    let x = px;
    let y = py;
    // Soft skin weights only below the pelvis. The skull, eyes and smile are invariant.
    if (py > 660) {
      const extension = smooth((py - 660) / 275);
      let nearest = 0;
      let distance = Infinity;
      for (let leg = 0; leg < 4; leg++) {
        const center = THREE.MathUtils.lerp(HIPS[leg], FEET[leg], extension);
        const next = Math.abs(px - center);
        if (next < distance) {
          nearest = leg;
          distance = next;
        }
      }
      const stride = strides[nearest] ?? 0;
      x += stride * 92 * extension;
      y -= Math.max(0, stride) * 58 * extension;
    }
    // Ears flex from their roots; none of the mask reaches the goggles or face.
    if (py < 190) {
      const ear = px < 990 ? 0 : 1;
      const flex = smooth((190 - py) / 160);
      x += (ears[ear] ?? 0) * 50 * flex;
      y += (ears[ear] ?? 0) * 12 * flex;
    }
    if (px < 530 && py > 455 && py < 725) {
      const flex = smooth((530 - px) / 245);
      x += tail * 25 * flex;
      y += tail * 95 * flex;
    }
    // The trailing silk moves, the scarf collar stays seated on the neck.
    if (px < 805 && py < 455 && py > 195) {
      const flex = smooth((805 - px) / 530);
      y += Math.sin(scarf + px / 155) * 13 * flex;
    }
    const upright = (1 - y / 1024) * HEIGHT;
    positions.setXYZ(
      i,
      (x / 1536 - 0.5) * WIDTH,
      upright * Math.cos(PITCH),
      -upright * Math.sin(PITCH)
    );
  }
  positions.needsUpdate = true;
}

export function createDonkeyCharacter(kit: CharacterKit) {
  const animal = new THREE.Group();
  const map = kit.texture(
    new THREE.TextureLoader().load(mediaUrl('assets/diamond-spins/donkey-mascot-v1.webp'))
  );
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const geometry = kit.own(new THREE.PlaneGeometry(WIDTH, HEIGHT, 80, 54));
  const material = kit.keep(
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'donkey-mascot';
  animal.add(mesh);
  // Pose handles retain the scene's established gait and anticipation clocks.
  const legs = Array.from({ length: 4 }, (_, i) => {
    const leg = new THREE.Group();
    leg.name = `walking-leg-${i}`;
    leg.add(new THREE.Group());
    animal.add(leg);
    return leg;
  });
  const knees = legs.map((leg) => leg.children[0] as THREE.Group);
  const ears = [0, 1].map((i) => {
    const ear = new THREE.Group();
    ear.name = `ear-${i}`;
    animal.add(ear);
    return ear;
  });
  const tail = new THREE.Group();
  tail.name = 'donkey-tail';
  animal.add(tail);
  poseDonkeyArtwork(geometry, [0, 0, 0, 0], [0, 0], 0, 0);
  const ghost = new THREE.Mesh(
    kit.own(geometry.clone()),
    kit.keep(
      new THREE.MeshBasicMaterial({
        map,
        color: 0x73bfff,
        transparent: true,
        opacity: 0.38,
        alphaTest: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    )
  );
  ghost.name = 'donkey-mascot-ghost';
  return {
    animal,
    legs,
    knees,
    ears,
    tail,
    ghost,
    pose(time: number, reduced: boolean) {
      poseDonkeyArtwork(
        geometry,
        legs.map((leg) => leg.rotation.z / 0.53),
        ears.map((ear) => ear.rotation.x),
        tail.rotation.x,
        reduced ? 0 : time / 240
      );
    },
    poseGhost(progress: number, reduced: boolean) {
      const stride = reduced || progress >= 1 ? 0 : Math.sin(progress * Math.PI * 12);
      poseDonkeyArtwork(
        ghost.geometry,
        [stride, -stride, -stride, stride],
        [0, 0],
        0,
        reduced ? 0 : progress * 24
      );
    },
  };
}
