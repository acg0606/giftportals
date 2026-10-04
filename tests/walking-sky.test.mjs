import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import ts from 'typescript';

const source = await readFile(new URL('../src/walking-sky.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from 'three'/, `from '${import.meta.resolve('three')}'`);
const { createWalkingSky, sampleWalkingSky } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const rowColors = (data, width, row) => Array.from({ length: width }, (_, column) => Array.from(data.slice((row * width + column) * 4, (row * width + column) * 4 + 3)));
const average = colors => [0, 1, 2].map(channel => colors.reduce((sum, pixel) => sum + pixel[channel], 0) / colors.length);
const difference = (a, b) => Math.max(...a.map((value, channel) => Math.abs(value - b[channel])));

test('a bounded opaque equirectangular sky uses sRGB and seam-safe linear sampling', () => {
  const sky = createWalkingSky();
  try {
    assert.ok(sky instanceof THREE.DataTexture);
    assert.equal(sky.mapping, THREE.EquirectangularReflectionMapping);
    assert.equal(sky.colorSpace, THREE.SRGBColorSpace);
    assert.equal(sky.format, THREE.RGBAFormat); assert.equal(sky.type, THREE.UnsignedByteType);
    assert.equal(sky.wrapS, THREE.RepeatWrapping); assert.equal(sky.wrapT, THREE.ClampToEdgeWrapping);
    assert.equal(sky.minFilter, THREE.LinearFilter); assert.equal(sky.magFilter, THREE.LinearFilter);
    assert.equal(sky.generateMipmaps, false); assert.equal(sky.flipY, false);
    const { data, width, height } = sky.image;
    assert.ok(data instanceof Uint8Array); assert.ok(width <= 512 && height <= 256);
    assert.ok(width >= 128 && height >= 64, 'Cloud color retains enough angular detail without a large asset');
    assert.equal(data.byteLength, width * height * 4);
    for (let pixel = 0; pixel < data.length; pixel += 4) assert.equal(data[pixel + 3], 255);
    assert.equal(sky.version, 1, 'The static texture is marked for exactly one initial upload');
  } finally { sky.dispose(); }
});

test('longitude wraps continuously and all longitudes meet without streaking at both poles', () => {
  for (const v of [0, .1, .46, .5, .58, .645, .735, .825, .96, 1]) {
    assert.deepEqual(sampleWalkingSky(0, v), sampleWalkingSky(1, v));
    assert.deepEqual(sampleWalkingSky(-.25, v), sampleWalkingSky(.75, v));
    assert.deepEqual(sampleWalkingSky(.125, v), sampleWalkingSky(3.125, v));
    assert.ok(difference(sampleWalkingSky(-1e-6, v), sampleWalkingSky(1e-6, v)) <= 1);
  }
  for (const v of [0, 1]) {
    const reference = sampleWalkingSky(0, v);
    for (let column = 0; column < 64; column++) assert.deepEqual(sampleWalkingSky(column / 64, v), reference);
  }
  for (const [u, v] of [[NaN, Infinity], [Infinity, NaN], [-Infinity, -Infinity], [0, -1], [0, 2]]) {
    const pixel = sampleWalkingSky(u, v);
    assert.equal(pixel.length, 4); assert.equal(pixel[3], 255);
    assert.ok(pixel.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
  }
});

test('a rose horizon fades into layered blue-gray dusk within the visible middle sky', () => {
  const sky = createWalkingSky();
  try {
    const { data, width, height } = sky.image;
    const band = v => average(rowColors(data, width, Math.round(v * (height - 1))));
    const bottom = band(0), horizon = band(.5), lowerClouds = band(.54), middle = band(.64), top = band(1);
    assert.ok(bottom.every(channel => channel < 50), 'The lower hemisphere remains dark behind the ground');
    assert.ok(horizon[0] > horizon[1] + 20 && horizon[0] > horizon[2] + 10);
    assert.ok(lowerClouds[0] > lowerClouds[1] + 15, 'Warm light stays close to the horizon');
    assert.ok(middle[2] > middle[0] + 10 && Math.abs(middle[1] - middle[0]) < 12, 'The large visible cloud gap includes cooler blue-gray light rather than an uninterrupted rose fill');
    assert.ok(horizon[0] > top[0] + 40 && horizon[1] > top[1] + 8);
    assert.ok(top[2] > top[0] && top[2] - top[0] <= 35);
    assert.ok(top[1] - top[0] < 20 && top[0] >= 110, 'Upper sky avoids the darker saturated turquoise of the old backing');
  } finally { sky.dispose(); }
});

test('clouds vary softly across longitude and the wrapped seam has no sharp color edge', () => {
  const sky = createWalkingSky();
  try {
    const { data, width, height } = sky.image;
    let largestRange = 0, largestHorizontalStep = 0, largestVerticalStep = 0, largestSeamStep = 0;
    for (let row = 0; row < height; row++) {
      const colors = rowColors(data, width, row);
      for (let channel = 0; channel < 3; channel++) {
        const values = colors.map(color => color[channel]);
        largestRange = Math.max(largestRange, Math.max(...values) - Math.min(...values));
      }
      for (let column = 0; column < width; column++) {
        const step = difference(colors[column], colors[(column + 1) % width]);
        largestHorizontalStep = Math.max(largestHorizontalStep, step);
        if (column === width - 1) largestSeamStep = Math.max(largestSeamStep, step);
        if (row > 0) {
          const prior = Array.from(data.slice(((row - 1) * width + column) * 4, ((row - 1) * width + column) * 4 + 3));
          largestVerticalStep = Math.max(largestVerticalStep, difference(colors[column], prior));
        }
      }
    }
    assert.ok(largestRange >= 24, 'Cloud highlights and shaded undersides remain visible in exposed portions of the sky');
    assert.ok(largestRange <= 60, 'Cloud color stays within a restrained dusk palette');
    assert.ok(largestHorizontalStep <= 4 && largestSeamStep <= 4, 'Both interior and wrapped neighboring texels stay smooth');
    assert.ok(largestVerticalStep <= 8, 'Cloud bands and the horizon have soft vertical transitions');
  } finally { sky.dispose(); }
});

test('every view direction includes visible cloud shading just above the horizon', () => {
  for (let sector = 0; sector < 4; sector++) {
    let strongestLayer = 0;
    for (const v of [.52, .55, .58, .602, .64, .665]) {
      const red = Array.from({ length: 64 }, (_, column) => sampleWalkingSky((sector + column / 63) / 4, v)[0]);
      strongestLayer = Math.max(strongestLayer, Math.max(...red) - Math.min(...red));
    }
    assert.ok(strongestLayer >= 16, `Longitude sector ${sector} must retain readable cloud shading in the latitude band exposed by the walking SPZ`);
    assert.ok(strongestLayer <= 60, 'The local cloud pattern remains within the overall dusk contrast bound');
  }
});

test('generation is deterministic and each viewer owns an independent disposable texture', () => {
  const first = createWalkingSky(), second = createWalkingSky();
  let firstDisposals = 0, secondDisposals = 0;
  first.addEventListener('dispose', () => firstDisposals++);
  second.addEventListener('dispose', () => secondDisposals++);
  assert.notEqual(first, second); assert.notEqual(first.image, second.image); assert.notEqual(first.image.data, second.image.data);
  assert.deepEqual(first.image.data, second.image.data);
  const original = second.image.data[0]; first.image.data[0] = 255;
  assert.equal(second.image.data[0], original, 'One viewer cannot mutate another viewer sky');
  first.dispose(); assert.equal(firstDisposals, 1); assert.equal(secondDisposals, 0);
  assert.equal(second.version, 1); assert.equal(second.image.data[0], original);
  const pixel = sampleWalkingSky(.33, .66); pixel[0] = 0;
  assert.notEqual(sampleWalkingSky(.33, .66)[0], 0, 'The pure sampler returns fresh values without shared mutable palette state');
  second.dispose(); assert.equal(secondDisposals, 1);
});
