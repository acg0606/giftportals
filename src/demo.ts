import type { DiscoveryDTO, GiftDTO, MemoryDTO, WorldDTO } from '../shared/contracts';
import { artUrl } from './art';
import { getPilotPlace } from './map-data';

const tuca = getPilotPlace('tuca')!;
const santos = getPilotPlace('museu-pele')!;
export const fictionalMemories: MemoryDTO[] = [
  {
    id: 'demo-perdizes-cup', ownerId: 'demo-sender', ownerName: 'Maya', title: 'A small bird, a slow afternoon',
    story: 'In this fictional postcard, a small ceramic bird carries the feeling of an afternoon in Perdizes. I thought of all the conversations we still have ahead of us. The physical gift can wait. This little world can arrive today.',
    location: { placeId: 'tuca', label: 'Perdizes · São Paulo', latitude: tuca.lat, longitude: tuca.lon, source: 'fictional-demo', experiencedAt: '2026-09-19' }, createdAt: '2026-09-19T15:00:00Z', demo: true, shareLocation: true,
    artisticNote: 'Fictional people and story. The original input is an AI-generated souvenir illustration, not a personal photograph. Tripo generated the actual 3D bird; World Labs generated the actual 3D environment. Both are artistic interpretations, not a faithful replica of Perdizes.',
    media: [
      { id: 'demo-bird-input', kind: 'gift-photo', url: '/demo/perdizes-input.png', mimeType: 'image/png', bytes: 1260000, generated: true, provider: 'tripo', expiresAt: 0 },
      { id: 'demo-bird-model', kind: 'model', url: '/demo/perdizes-gift.glb', mimeType: 'model/gltf-binary', bytes: 2250000, generated: true, provider: 'tripo', expiresAt: 0 },
      { id: 'demo-generated-world', kind: 'world', url: '/demo/perdizes-world-100k.spz', mimeType: 'application/octet-stream', bytes: 1170000, generated: true, provider: 'worldlabs', expiresAt: 0 },
      { id: 'demo-world-panorama', kind: 'world', url: '/demo/perdizes-world-pano.png', mimeType: 'image/png', bytes: 3370000, generated: true, provider: 'worldlabs', expiresAt: 0 }
    ], objectStatus: 'completed', environmentStatus: 'completed'
  },
  {
    id: 'demo-santos-shell', ownerId: 'demo-sender', ownerName: 'Maya', title: 'The sea, tucked into a pocket',
    story: 'Santos was all salt in the air and soft light. This imagined shell is a reminder to slow down and listen. A fictional postcard for our demonstration, with an original illustrated gift.',
    location: { placeId: 'museu-pele', label: 'Santos · São Paulo state', latitude: santos.lat, longitude: santos.lon, source: 'fictional-demo', experiencedAt: '2026-09-23' }, createdAt: '2026-09-23T16:30:00Z', demo: true, shareLocation: true,
    artisticNote: 'Fictional memory. Original illustrated object; no real person or trip is represented. This illustration has not been reconstructed in 3D.',
    media: [{ id: 'demo-shell-image', kind: 'gift-photo', url: artUrl('shell'), mimeType: 'image/svg+xml', bytes: 0, generated: false, expiresAt: 0 }], objectStatus: 'not-requested', environmentStatus: 'not-requested'
  },
  {
    id: 'demo-paris-bird', ownerId: 'demo-recipient', ownerName: 'Noah', title: 'A window onto Paris',
    story: 'A fictional gift from Noah opens a small window onto Paris. Maya receives the memory and keeps its story. Her atlas marks it as known through a memory; it never marks Paris as a physical visit.',
    location: { placeId: 'paris', label: 'Paris · outside the pilot', latitude: 0, longitude: 0, source: 'fictional-demo', experiencedAt: '2026-09-25' }, createdAt: '2026-09-25T13:30:00Z', demo: true, shareLocation: true,
    artisticNote: 'Fictional received memory and original illustration. No GPS position is asserted. Paris is outside our detailed pilot; receiving this gift does not establish a physical visit.',
    media: [{ id: 'demo-paris-image', kind: 'gift-photo', url: artUrl('bird'), mimeType: 'image/svg+xml', bytes: 0, generated: false, expiresAt: 0 }], objectStatus: 'not-requested', environmentStatus: 'not-requested'
  }
];

/** Prioritize the generated gift independently of the cloud database's result order. */
export function orderDemoMemories(memories: readonly MemoryDTO[]): MemoryDTO[] {
  const priority = (memory: MemoryDTO) => memory.location.placeId === 'tuca' ? 0 : memory.location.placeId === 'museu-pele' ? 1 : memory.location.placeId === 'paris' ? 2 : 3;
  return [...memories].sort((a, b) => priority(a) - priority(b));
}

/** Public read-only preview connections follow returned fixture IDs, including cloud UUIDs. */
export function demoWorld(memories: readonly MemoryDTO[] = fictionalMemories, persona = 'sender'): WorldDTO {
  const publicFixtures = orderDemoMemories(memories.filter(memory => memory.demo));
  const bird = publicFixtures.find(memory => memory.location.placeId === 'tuca');
  const shell = publicFixtures.find(memory => memory.location.placeId === 'museu-pele');
  const paris = publicFixtures.find(memory => memory.location.placeId === 'paris');
  const senderId = bird?.ownerId || shell?.ownerId || publicFixtures.find(memory => memory.ownerName === 'Maya')?.ownerId || 'demo-sender';
  const recipientId = paris?.ownerId || publicFixtures.find(memory => memory.ownerName === 'Noah')?.ownerId || 'demo-recipient';
  const senderName = bird?.ownerName || shell?.ownerName || 'Maya';
  const recipientName = paris?.ownerName || 'Noah';
  const user = { id: persona === 'sender' ? senderId : recipientId, displayName: persona === 'sender' ? senderName : recipientName, demo: true };
  const giftToNoah: GiftDTO | null = bird ? { id: `fictional-gift-to-noah:${bird.id}`, memoryId: bird.id, senderName, recipientName, message: 'A little bird, until I can give it to you in person.', createdAt: bird.createdAt, revokedAt: null, claimedBy: recipientId } : null;
  const giftToMaya: GiftDTO | null = paris ? { id: `fictional-gift-to-maya:${paris.id}`, memoryId: paris.id, senderName: recipientName, recipientName: senderName, message: 'A window onto a place we might discover together.', createdAt: paris.createdAt, revokedAt: null, claimedBy: senderId } : null;
  const sent = (persona === 'sender' ? [giftToNoah] : [giftToMaya]).filter((gift): gift is GiftDTO => gift !== null);
  const received = (persona === 'sender' ? [giftToMaya] : [giftToNoah]).filter((gift): gift is GiftDTO => gift !== null);
  const receivedIds = new Set(received.map(gift => gift.memoryId));
  const visible = publicFixtures.filter(memory => memory.ownerId === user.id || receivedIds.has(memory.id));
  const discoveries: DiscoveryDTO[] = [];
  const record = (label: string, placeId: string, kind: DiscoveryDTO['kind'], memory?: MemoryDTO) => discoveries.push({ id: `fictional-${label}`, placeId, kind, source: 'fictional demonstration', memoryId: memory?.id || null, createdAt: memory?.createdAt || '2026-09-25T13:30:00Z' });
  if (persona === 'sender') {
    if (bird) record('visit-perdizes', bird.location.placeId, 'physical', bird);
    if (shell) record('visit-santos', shell.location.placeId, 'physical', shell);
    record('wish-jabaquara', 'centro-cultural-jabaquara', 'wish');
    record('wish-paulista', 'masp', 'wish');
    if (paris) record('memory-paris', paris.location.placeId, 'memory', paris);
  } else if (bird) record('received-perdizes', bird.location.placeId, 'memory', bird);
  return { user, memories: visible, sent, received, discoveries, jobs: [] };
}

