import * as THREE from 'three';

export interface KeepsakeAtmosphereOptions { focus: THREE.Vector3; cameraPosition: THREE.Vector3; reduced: boolean }
/** Lighting for the actual sponsor keepsake. No authored backdrop geometry,
 * particles or animation; the caller retains its single on-demand renderer. */
export function mountKeepsakeAtmosphere(scene: THREE.Scene, options: KeepsakeAtmosphereOptions) {
  const group = new THREE.Group(); group.name = 'Keepsake studio lighting'; scene.add(group);
  const previousBackground = scene.background, previousFog = scene.fog;
  scene.background = new THREE.Color('#f8f6f0'); scene.fog = null;
  let dead = false;
  const ambient = new THREE.HemisphereLight('#fffaf0', '#b9cad3', 2.1);
  ambient.name = 'Soft keepsake ambient light';
  const key = new THREE.DirectionalLight('#fff7e6', 3);
  key.name = 'Gentle keepsake key';
  const rim = new THREE.DirectionalLight('#d8e9f5', 1.8);
  rim.name = 'Cool keepsake rim light';
  group.add(ambient, key, key.target, rim, rim.target);
  function setComposition(focus: THREE.Vector3, cameraPosition: THREE.Vector3) {
    if (dead) return;
    const front = cameraPosition.clone().sub(focus); front.y = 0;
    if (front.lengthSq() < .001) front.set(0, 0, 1);
    front.normalize();
    const side = new THREE.Vector3(front.z, 0, -front.x);
    key.position.copy(focus).addScaledVector(front, 3.4).addScaledVector(side, 2.7); key.position.y += 3.2;
    key.target.position.copy(focus);
    rim.position.copy(focus).addScaledVector(front, -1.8).addScaledVector(side, 3.5); rim.position.y += 2.2;
    rim.target.position.copy(focus);
  }
  setComposition(options.focus, options.cameraPosition);
  return {
    group,
    get animated() { return false; },
    setComposition,
    setReduced(_value: boolean) {},
    update(_delta: number) { return false; },
    destroy() {
      if (dead) return;
      dead = true; group.removeFromParent(); key.dispose(); rim.dispose(); ambient.dispose(); group.clear();
      scene.background = previousBackground; scene.fog = previousFog;
    },
  };
}