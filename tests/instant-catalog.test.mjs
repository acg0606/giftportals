import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const load = async path => { const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText; return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`); };
const { INSTANT_EXAMPLES, instantCatalogCategory } = await load('../shared/instant-examples.ts');
const { CURIOSITY_FACTS, CURIOSITY_REGIONS, selectedCuriosities } = await load('../shared/gift-curiosities.ts');
test('ten selectable inspirations include five iconic cities and five human technology objects without animal examples', () => {
  assert.equal(INSTANT_EXAMPLES.length, 10); assert.equal(new Set(INSTANT_EXAMPLES.map(example => example.id)).size, 10);
  assert.deepEqual(instantCatalogCategory(INSTANT_EXAMPLES, 'cities').map(example => example.id), ['rio','paris','kyoto','new-york','cairo']);
  assert.deepEqual(instantCatalogCategory(INSTANT_EXAMPLES, 'objects').map(example => example.id), ['antikythera','astrolabe','voyager-golden-record','apollo-capsule','printing-press']);
  assert.equal(INSTANT_EXAMPLES.some(example => /bird|animal/i.test(example.id)), false);
});
test('routing preserves city originals for places and isolated technological objects for Tripo', () => {
  for (const example of INSTANT_EXAMPLES) {
    assert.equal(example.imageUrl, `/assets/examples/v13/${example.id}.jpg`); assert.match(example.caption, /Artistic.*inspired by/i);
    assert.ok(example.worldPrompt.length >= 8 && example.worldPrompt.length <= 1600); assert.ok(example.story.length > 20 && example.story.length <= 1200);
    assert.equal(example.worldImageUrl, example.id === 'antikythera' ? '/assets/examples/v13/antikythera-world.jpg' : undefined);
    if (example.category === 'cities') { assert.equal(example.photoIntent, 'place'); assert.ok(CURIOSITY_REGIONS.some(region => region.id === example.regionId)); }
    else { assert.equal(example.photoIntent, 'object'); assert.match(example.worldPrompt, /imaginative|fictional/i); assert.ok(example.objectHint); }
  }
});
test('every catalog entry has source-backed allowlisted inspiration facts with matching place or object context', () => {
  const officialHosts = ['whc.unesco.org','www.nps.gov','www.nyc.gov','www.namuseum.gr','www.rmg.co.uk','science.nasa.gov','airandspace.si.edu','www.loc.gov'];
  for (const example of INSTANT_EXAMPLES) {
    const facts = selectedCuriosities([...example.curiosityIds]); assert.ok(facts.length > 0 && facts.length <= 2);
    for (const fact of facts) {
      assert.ok(CURIOSITY_FACTS.some(known => known.id === fact.id)); const source = new URL(fact.sourceUrl); assert.equal(source.protocol, 'https:'); assert.ok(officialHosts.includes(source.hostname));
      assert.equal(fact.regionId || fact.objectHint, example.regionId || example.objectHint);
      if (example.category === 'objects') assert.match(fact.text, /artistic reference/i);
    }
  }
});
test('category lists are copies and never truncate or change catalog image provenance', () => {
  const before = JSON.stringify(INSTANT_EXAMPLES), cities = instantCatalogCategory(INSTANT_EXAMPLES, 'cities'); cities[0].imageUrl = '/changed.jpg';
  assert.equal(JSON.stringify(INSTANT_EXAMPLES), before); assert.equal(cities.length, 5);
});

test('all five places offer reviewed miniature references while only completed examples expose ready gift links', async () => {
  const cities = instantCatalogCategory(INSTANT_EXAMPLES, 'cities');
  for (const city of cities) {
    assert.equal(city.objectRepresentation, 'souvenir-miniature'); assert.equal(city.objectImageRole, 'miniature-reference');
    assert.notEqual(city.objectImageUrl, city.imageUrl); await readFile(new URL(`../public${city.objectImageUrl}`, import.meta.url));
  }
  assert.deepEqual(INSTANT_EXAMPLES.filter(example => example.readyGiftUrl).map(example => example.id), ['rio', 'paris', 'antikythera']);
  for (const city of cities.filter(example => !['rio','paris'].includes(example.id))) assert.equal(city.readyGiftUrl, undefined);
});
