import * as THREE from 'three';

type SkyPixel = readonly [number, number, number, number];
type SkyColor = readonly [number, number, number];

const WIDTH = 512, HEIGHT = 256, TAU = Math.PI * 2;
const NADIR: SkyColor = [28, 40, 37];
const HORIZON: SkyColor = [176, 146, 155];
const HIGH_DUSK: SkyColor = [132, 137, 150];
const ZENITH: SkyColor = [110, 126, 144];
const WISP_CENTERS = [.515, .55, .602, .665, .75, .835] as const;
const WISP_WIDTHS = [.009, .012, .016, .023, .026, .032] as const;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Sample a static, landmark-free dusk sky as opaque sRGB bytes.
 * u wraps around longitude; v runs from nadir (0) through horizon (.5)
 * to zenith (1), matching an unflipped equirectangular DataTexture. */
export function sampleWalkingSky(u: number, v: number): SkyPixel {
  const longitude = Number.isFinite(u) ? u - Math.floor(u) : 0;
  const latitude = Number.isFinite(v) ? clamp(v) : .5;
  const phi = longitude * TAU;
  let from: SkyColor, to: SkyColor, blend: number;
  if (latitude <= .5) {
    from = NADIR; to = HORIZON; blend = smooth(0, .5, latitude);
  } else if (latitude <= .64) {
    from = HORIZON; to = HIGH_DUSK; blend = smooth(.5, .64, latitude);
  } else {
    from = HIGH_DUSK; to = ZENITH; blend = smooth(.64, 1, latitude);
  }

  // Integer longitude frequencies close the seam. The envelope removes all
  // longitude variation at both poles, where every direction meets.
  const envelope = smooth(.485, .525, latitude) * (1 - smooth(.80, .95, latitude));
  const broad = .55 * Math.sin(2 * phi + 12 * latitude + 1.3)
    + .3 * Math.sin(5 * phi - 21 * latitude + .8)
    + .15 * Math.sin(9 * phi + 38 * latitude - 1.1);
  let wisps = 0, undersides = 0;
  for (let band = 0; band < WISP_CENTERS.length; band++) {
    const center = WISP_CENTERS[band]
      + .008 * Math.sin(2 * phi + band * 1.7)
      + .005 * Math.sin(5 * phi - band * .8);
    const width = WISP_WIDTHS[band];
    const distance = (latitude - center) / width;
    const underside = (latitude - center + width * .85) / (width * 1.25);
    const coverage = .5 + .25 * Math.sin(2 * phi + band * 1.6)
      + .25 * Math.sin(5 * phi - band * .9);
    wisps += Math.exp(-distance * distance) * coverage;
    undersides += Math.exp(-underside * underside) * coverage;
  }
  // Warm cloud tops and cooler undersides give the exposed background depth.
  // Most layers sit just above the horizon, where the walking SPZ has gaps;
  // their soft color remains distant sky, without inventing missing geometry.
  const light = envelope * (.35 * smooth(-.2, .9, broad) + .75 * clamp(wisps));
  const shade = envelope * (.28 * smooth(-.8, .45, -broad) + .6 * clamp(undersides));
  const red = from[0] + (to[0] - from[0]) * blend + light * 24 - shade * 24;
  const green = from[1] + (to[1] - from[1]) * blend + light * 14 - shade * 12;
  const blue = from[2] + (to[2] - from[2]) * blend + light * 17 + shade * 3;
  return [Math.round(clamp(red, 0, 255)), Math.round(clamp(green, 0, 255)), Math.round(clamp(blue, 0, 255)), 255];
}

/** Distant sky only: generated cloud color adds no fixed buildings or image
 * landmarks behind a translated SPZ. Each viewer owns and disposes its texture.
 * No animation or clock is needed, including with reduced motion enabled. */
export function createWalkingSky(): THREE.DataTexture {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row++) {
    for (let column = 0; column < WIDTH; column++) {
      data.set(sampleWalkingSky((column + .5) / WIDTH, row / (HEIGHT - 1)), (row * WIDTH + column) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'walking-dusk-sky';
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false; texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}
