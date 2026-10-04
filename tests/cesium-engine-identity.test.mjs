import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

test('Cesium exports and widgets resolve the same engine for geometry instanceof checks', () => {
  const application = createRequire(import.meta.url);
  const cesium = createRequire(application.resolve('cesium/package.json'));
  const widgets = createRequire(cesium.resolve('@cesium/widgets/package.json'));
  // A widgets semver update once installed another engine alongside Cesium's.
  // Rectangle from one copy then failed the other copy's instanceof check and
  // camera navigation treated the geographic rectangle as an invalid Cartesian.
  // Check installed module identity, not versions: compatible upgrades remain possible.
  const exportedEngine = cesium.resolve('@cesium/engine');
  const widgetEngine = widgets.resolve('@cesium/engine');
  assert.equal(widgetEngine, exportedEngine,
    'Cesium and its widgets must resolve one engine module; duplicate geometry constructors break camera navigation.');
});
