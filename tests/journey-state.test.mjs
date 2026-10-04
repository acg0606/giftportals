import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { demoFixtureKey, journeyCatalog, journeyProgress, newJourney, nextJourneyMemory, reconcileJourney, reduceJourney } from '../src/journey-state.ts';

async function sourceModule(name, replacements = {}) {
  let js = ts.transpileModule(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [path, target] of Object.entries(replacements)) js = js.replaceAll(`'${path}'`, JSON.stringify(target));
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const art = await sourceModule('art.ts'), places = await sourceModule('map-data.ts');
const { demoWorld, fictionalMemories } = await import(await sourceModule('demo.ts', { './art': art, './map-data': places }));
const ownerScope = { kind: 'owner', actorId: 'owner', epoch: 1 };
const mayaScope = { kind: 'public-demo', persona: 'sender', epoch: 2 };
const noahScope = { kind: 'public-demo', persona: 'recipient', epoch: 2 };
const empty = { object: false, place: false, story: false, kept: false };
function memory(id, placeId = 'tuca', extra = {}) {
  return { id, ownerId: 'owner', ownerName: 'Synthetic owner', title: 'Synthetic memory', story: 'An original synthetic story.',
    location: { placeId, label: 'Synthetic location', latitude: 12.345, longitude: 98.765, source: 'manual', experiencedAt: '2026-09-30' },
    shareLocation: true, aiConsent: false, demo: false, archivedAt: null, createdAt: '2026-09-30T12:00:00Z', artisticNote: 'An artistic interpretation.',
    media: [{ id: 'original', kind: 'gift-photo', url: 'https://offline.invalid/private?token=synthetic', mimeType: 'image/png', bytes: 100, generated: false, expiresAt: 123 }],
    objectStatus: 'not-requested', environmentStatus: 'not-requested', ...extra };
}
function gift(memoryId, extra = {}) { return { id: `gift:${memoryId}`, memoryId, claimedBy: 'owner', revokedAt: null, ...extra }; }
function world(memories = [], received = [], extra = {}) {
  return { user: { id: 'owner', displayName: 'Synthetic owner', demo: false }, memories, received, sent: [], discoveries: [], jobs: [], ...extra };
}
function reveal(current, catalog, id, type) { return reduceJourney(current, catalog, { scopeEpoch: current.scope.epoch, memoryId: id, type }); }
function keep(current, catalog, id) {
  for (const type of ['reveal-object', 'reveal-place', 'reveal-story', 'keep']) current = reveal(current, catalog, id, type);
  return current;
}

test('catalog admits only current own or active claimed memories, never all read-link/public DTOs', () => {
  const data = world([memory('own'), memory('received', 'masp', { ownerId: 'sender' }), memory('revoked', 'masp', { ownerId: 'sender' }),
    memory('foreign', 'masp', { ownerId: 'sender' }), memory('wrong-recipient', 'masp', { ownerId: 'sender' }), memory('archived', 'tuca', { archivedAt: '2026-09-30' })],
  [gift('received'), gift('revoked', { revokedAt: '2026-09-30' }), gift('wrong-recipient', { claimedBy: 'outsider' })]);
  assert.deepEqual(journeyCatalog(data, ownerScope).map(entry => entry.memory.id), ['own', 'received']);
  assert.deepEqual(journeyCatalog(data, { ...ownerScope, actorId: 'outsider' }), []);
  assert.deepEqual(journeyCatalog(data, mayaScope), []);
  assert.deepEqual(journeyCatalog(demoWorld(), { ...ownerScope, actorId: demoWorld().user.id }), []);
});

test('public catalog accepts exact static fixtures only in the selected fictional persona subset', () => {
  const maya = journeyCatalog(demoWorld(), mayaScope), noah = journeyCatalog(demoWorld(fictionalMemories, 'recipient'), noahScope);
  assert.deepEqual(maya.map(entry => demoFixtureKey(entry.memory)), ['bird', 'sea', 'paris']);
  assert.deepEqual(noah.map(entry => demoFixtureKey(entry.memory)), ['bird', 'paris']);
  assert.deepEqual(journeyCatalog(demoWorld(), noahScope), []);
  assert.deepEqual(journeyCatalog(demoWorld(fictionalMemories, 'recipient'), mayaScope), []);
  assert.deepEqual(journeyCatalog({ ...demoWorld(), user: { ...demoWorld().user, id: 'unrelated-demo' } }, mayaScope), []);
  assert.deepEqual(journeyCatalog({ ...demoWorld(), user: { ...demoWorld().user, demo: false } }, mayaScope), []);
});

test('deterministic cloud fixture UUIDs use the same aliases without depending on local user IDs', () => {
  const ids = ['ef287aa8-d3cc-4ed5-a5dc-49898be53105', 'cbf95d13-5952-4c52-a3c1-30e4fa467ff0', '015396be-c9b1-46f3-afda-b93d66eb0e41'];
  const seeded = fictionalMemories.map((item, index) => ({ ...structuredClone(item), id: ids[index], ownerId: index === 2 ? 'cloud-noah' : 'cloud-maya' }));
  assert.deepEqual(journeyCatalog(demoWorld(seeded), mayaScope).map(entry => demoFixtureKey(entry.memory)), ['bird', 'sea', 'paris']);
  assert.deepEqual(journeyCatalog(demoWorld(seeded, 'recipient'), noahScope).map(entry => demoFixtureKey(entry.memory)), ['bird', 'paris']);
});

test('demo flags, place coincidences, missing consent and altered provenance cannot create authored fixtures', () => {
  const known = fictionalMemories[0];
  for (const change of [{ id: 'arbitrary-demo' }, { demo: false }, { shareLocation: false }, { shareLocation: undefined },
    { archivedAt: '2026-09-30' }, { ownerName: 'Unknown author' }, { location: { ...known.location, source: 'manual' } }, { location: { ...known.location, placeId: 'masp' } }]) {
    assert.equal(demoFixtureKey({ ...known, ...change }), undefined);
  }
  const data = demoWorld(); data.memories.push(memory('arbitrary-demo', 'tuca', { ownerId: data.user.id, ownerName: 'Maya', demo: true, shareLocation: true }));
  assert.equal(journeyCatalog(data, mayaScope).some(entry => entry.memory.id === 'arbitrary-demo'), false);
  const hidden = structuredClone(fictionalMemories); hidden[1].shareLocation = false; hidden[2].shareLocation = undefined;
  assert.deepEqual(journeyCatalog(demoWorld(hidden), mayaScope).map(entry => demoFixtureKey(entry.memory)), ['bird']);
});

test('all three explicit reveals are required before digital keep; no DTO or physical/server history changes', () => {
  const data = world([memory('story')], [], { discoveries: [{ id: 'independent-visit', kind: 'physical', placeId: 'masp', memoryId: null }] });
  const before = JSON.stringify(data), catalog = journeyCatalog(data, ownerScope);
  let current = newJourney(ownerScope);
  assert.deepEqual(journeyProgress(current, 'story'), empty);
  current = reveal(current, catalog, 'story', 'keep');
  assert.equal(journeyProgress(current, 'story').kept, false);
  current = reveal(current, catalog, 'story', 'reveal-object');
  current = reveal(current, catalog, 'story', 'reveal-story');
  current = reveal(current, catalog, 'story', 'keep');
  assert.deepEqual(journeyProgress(current, 'story'), { object: true, place: false, story: true, kept: false });
  current = reveal(current, catalog, 'story', 'reveal-place');
  current = reveal(current, catalog, 'story', 'keep');
  assert.deepEqual(journeyProgress(current, 'story'), { object: true, place: true, story: true, kept: true });
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(Object.keys(current).sort(), ['fingerprints', 'progress', 'scope']);
  assert.deepEqual(newJourney(ownerScope).progress, Object.create(null));
});

test('explicit events are idempotent and unknown memories/events never complete a trail', () => {
  const catalog = journeyCatalog(world([memory('story')]), ownerScope);
  const current = keep(newJourney(ownerScope), catalog, 'story');
  for (const type of ['reveal-object', 'reveal-place', 'reveal-story', 'keep']) assert.deepEqual(reveal(current, catalog, 'story', type), current);
  assert.deepEqual(reveal(current, catalog, 'inaccessible', 'reveal-story'), current);
  assert.deepEqual(reveal(current, catalog, 'story', 'invented-auto-completion'), current);
  assert.equal(Object.isFrozen(current), true); assert.equal(Object.isFrozen(current.progress), true);
});

test('stale epoch and unproven/copied catalogs cannot advance another session', () => {
  const data = world([memory('story')]), catalog = journeyCatalog(data, ownerScope);
  const current = reconcileJourney(newJourney(ownerScope), catalog, ownerScope);
  const stale = reduceJourney(current, catalog, { scopeEpoch: 0, memoryId: 'story', type: 'reveal-story' });
  assert.deepEqual(journeyProgress(stale, 'story'), empty);
  assert.deepEqual(reduceJourney(current, [...catalog], { scopeEpoch: 1, memoryId: 'story', type: 'reveal-story' }), current);
  assert.deepEqual(reconcileJourney(current, [...catalog], ownerScope), newJourney(ownerScope));
  const laterScope = { ...ownerScope, epoch: 2 }, laterCatalog = journeyCatalog(data, laterScope);
  assert.equal(nextJourneyMemory(laterCatalog, current, 'other'), undefined);
  assert.deepEqual(reduceJourney(current, laterCatalog, { scopeEpoch: 2, memoryId: 'story', type: 'reveal-story' }), current);
  const mismatch = journeyCatalog(world([memory('foreign')]), { ...ownerScope, actorId: 'outsider' });
  assert.equal(Object.isFrozen(catalog), true); assert.equal(Object.isFrozen(mismatch), true);
  assert.throws(() => mismatch.push({ memory: memory('injected') }), TypeError);
});

test('owner/account, epoch and persona switches reset progress even when a memory ID is reused', () => {
  const catalog = journeyCatalog(world([memory('same-id')]), ownerScope), current = keep(newJourney(ownerScope), catalog, 'same-id');
  const otherScope = { kind: 'owner', actorId: 'other-account', epoch: 1 };
  const otherCatalog = journeyCatalog(world([memory('same-id', 'tuca', { ownerId: 'other-account' })], [], { user: { id: 'other-account', displayName: 'Other account', demo: false } }), otherScope);
  assert.deepEqual(journeyProgress(reconcileJourney(current, otherCatalog, otherScope), 'same-id'), empty);
  const laterScope = { ...ownerScope, epoch: 2 };
  assert.deepEqual(journeyProgress(reconcileJourney(current, journeyCatalog(world([memory('same-id')]), laterScope), laterScope), 'same-id'), empty);
  const mayaCatalog = journeyCatalog(demoWorld(), mayaScope), demoState = keep(newJourney(mayaScope), mayaCatalog, fictionalMemories[0].id);
  const noahCatalog = journeyCatalog(demoWorld(fictionalMemories, 'recipient'), noahScope);
  assert.deepEqual(journeyProgress(reconcileJourney(demoState, noahCatalog, noahScope), fictionalMemories[0].id), empty);
  assert.deepEqual(reconcileJourney(demoState, otherCatalog, otherScope), reconcileJourney(newJourney(otherScope), otherCatalog, otherScope));
});

test('revocation, archive and missing membership remove a kept card instead of granting stale access', () => {
  const received = memory('received', 'tuca', { ownerId: 'sender' }), data = world([received], [gift('received')]);
  const catalog = journeyCatalog(data, ownerScope), current = keep(newJourney(ownerScope), catalog, received.id);
  for (const changed of [world([received], [gift('received', { revokedAt: '2026-09-30' })]), world([received], []),
    world([{ ...received, archivedAt: '2026-09-30' }], [gift('received')]), world([], [gift('received')])]) {
    const fresh = journeyCatalog(changed, ownerScope), next = reconcileJourney(current, fresh, ownerScope);
    assert.deepEqual(journeyProgress(next, received.id), empty);
    assert.deepEqual(Object.keys(next.progress), []); assert.equal(nextJourneyMemory(fresh, current, 'other'), undefined);
  }
});

test('hidden received locations stay readable but unlocated and discard formerly revealed content', () => {
  const received = memory('received', 'tuca', { ownerId: 'sender' }), data = world([received], [gift('received')]);
  const catalog = journeyCatalog(data, ownerScope), current = keep(newJourney(ownerScope), catalog, 'received');
  assert.equal(catalog[0].publicPlaceId, 'tuca');
  for (const shareLocation of [false, undefined]) {
    // Retain a stale real-looking DTO coordinate: consent must still win.
    const hidden = journeyCatalog(world([{ ...received, shareLocation }], [gift('received')]), ownerScope);
    assert.equal(hidden.length, 1); assert.equal(hidden[0].publicPlaceId, undefined);
    assert.deepEqual(journeyProgress(reconcileJourney(current, hidden, ownerScope), 'received'), empty);
  }
  const ownerHidden = journeyCatalog(world([memory('own-hidden', 'tuca', { shareLocation: false })]), ownerScope);
  assert.equal(ownerHidden[0].publicPlaceId, 'tuca');
});

test('changed story, author, place, consent or semantic artifact identity resets all session rewards', () => {
  const original = memory('story'), catalog = journeyCatalog(world([original]), ownerScope), current = keep(newJourney(ownerScope), catalog, 'story');
  const changes = [{ title: 'Edited title' }, { story: 'Changed original story' }, { ownerName: 'Changed author' },
    { artisticNote: 'Changed artistic note' }, { location: { ...original.location, placeId: 'masp' } },
    { location: { ...original.location, source: 'photo-metadata' } }, { location: { ...original.location, latitude: 0 } },
    { location: { ...original.location, experiencedAt: '2026-09-29' } }, { shareLocation: false }, { aiConsent: true },
    { media: [{ ...original.media[0], id: 'replacement-artifact' }] }, { media: [{ ...original.media[0], bytes: 200 }] },
    { objectStatus: 'completed' }, { environmentStatus: 'completed' }];
  for (const change of changes) {
    const fresh = journeyCatalog(world([{ ...original, ...change }]), ownerScope);
    assert.deepEqual(journeyProgress(reconcileJourney(current, fresh, ownerScope), 'story'), empty, JSON.stringify(change));
  }
});

test('routine signed media URL/expiry refresh and media ordering do not erase semantic progress or retain capabilities in fingerprints', () => {
  const original = memory('story', 'tuca', { media: [...memory('story').media,
    { id: 'second', kind: 'audio', url: 'https://offline.invalid/audio?token=old', mimeType: 'audio/ogg', bytes: 20, generated: false, expiresAt: 123 }] });
  const catalog = journeyCatalog(world([original]), ownerScope), current = keep(newJourney(ownerScope), catalog, 'story');
  const renewed = { ...original, media: original.media.map(item => ({ ...item, url: `https://offline.invalid/refreshed?token=new-secret-${item.id}`, expiresAt: 999 })).reverse() };
  const fresh = journeyCatalog(world([renewed]), ownerScope), next = reconcileJourney(current, fresh, ownerScope);
  assert.equal(journeyProgress(next, 'story').kept, true);
  assert.equal(JSON.stringify(next.fingerprints).includes('token='), false);
  assert.equal(JSON.stringify(next.fingerprints).includes('offline.invalid'), false);
  assert.equal(JSON.stringify(next.fingerprints).includes('new-secret'), false);
});

test('duplicate conflicting IDs fail closed, while equal duplicates and prototype-looking IDs are safely handled', () => {
  const conflict = memory('conflict');
  assert.deepEqual(journeyCatalog(world([conflict, { ...conflict, story: 'Other story' }]), ownerScope), []);
  assert.equal(journeyCatalog(world([conflict, structuredClone(conflict)]), ownerScope).length, 1);
  const catalog = journeyCatalog(world([memory('__proto__'), memory('constructor')]), ownerScope);
  let current = keep(newJourney(ownerScope), catalog, '__proto__'); current = keep(current, catalog, 'constructor');
  assert.equal(journeyProgress(current, '__proto__').kept, true); assert.equal(journeyProgress(current, 'constructor').kept, true);
  assert.equal(Object.getPrototypeOf(current.progress), null);
});

test('next story prefers sourced municipality proximity, excludes kept/current and ignores exact private DTO coordinates', () => {
  const data = world([memory('origin', 'tuca'), memory('far-city', 'museu-pele'), memory('near', 'masp'), memory('next-near', 'casa-das-rosas'),
    memory('unlocated', 'paris'), memory('unknown', 'not-in-catalog')]);
  const catalog = journeyCatalog(data, ownerScope);
  let current = keep(newJourney(ownerScope), catalog, 'origin');
  assert.equal(nextJourneyMemory(catalog, current, 'origin').memory.id, 'near');
  current = keep(current, catalog, 'near');
  assert.equal(nextJourneyMemory(catalog, current, 'origin').memory.id, 'next-near');
  current = keep(current, catalog, 'next-near');
  assert.equal(nextJourneyMemory(catalog, current, 'origin').memory.id, 'far-city');
  for (const id of ['far-city', 'unlocated', 'unknown']) current = keep(current, catalog, id);
  assert.equal(nextJourneyMemory(catalog, current, 'origin'), undefined);
  assert.equal(data.memories.every(item => item.location.latitude === 12.345 && item.location.longitude === 98.765), true);
});

test('unknown, hidden, Paris and address-only places have no fabricated anchor or GPS-derived proximity', () => {
  const data = world([memory('paris', 'paris'), memory('japan', 'japan-house'), memory('unknown', 'missing'),
    memory('hidden', 'masp', { ownerId: 'sender', shareLocation: false })], [gift('hidden')]);
  const catalog = journeyCatalog(data, ownerScope);
  assert.equal(catalog.every(entry => entry.publicPlaceId === undefined), true);
  assert.equal(nextJourneyMemory(catalog, newJourney(ownerScope), 'paris').memory.id, 'hidden');
  assert.equal(nextJourneyMemory(catalog, newJourney(ownerScope), 'paris').publicPlaceId, undefined);
});

test('invalid epoch/actor scopes cannot become authorized catalogs or session state', () => {
  for (const scope of [{ ...ownerScope, actorId: '' }, { ...ownerScope, epoch: -1 }, { ...ownerScope, epoch: NaN }, { ...mayaScope, persona: 'invented' }]) {
    assert.deepEqual(journeyCatalog(world([memory('story')]), scope), []);
    assert.throws(() => newJourney(scope), /valid journey session scope/);
  }
});
