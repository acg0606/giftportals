/** Small, sourced pilot catalog. Layout coordinates are intentionally NOT geographic boundaries. */
export type PlaceKind = 'world' | 'country' | 'state' | 'municipality' | 'district' | 'corridor' | 'region' | 'point';
export interface MapPlace {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly kind: PlaceKind;
  readonly detail: 'orientation' | 'pilot' | 'outside';
  readonly description: string;
  readonly address?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly sourceUrl?: string;
  readonly coordinateSourceUrl?: string;
  readonly coordinateNote?: string;
  readonly illustration?: 'theatre' | 'museum' | 'house' | 'garden';
}
export interface MapDiscovery {
  readonly id?: string;
  readonly ownerId?: string;
  readonly placeId: string;
  readonly kind: 'physical' | 'memory' | 'wish';
  readonly source?: string;
  readonly memoryId?: string | null;
}
export interface TerritoryProgress {
  readonly physicallyVisited: boolean;
  readonly physicalPointCount: number;
  readonly memoryPointCount: number;
  readonly memoryCount: number;
  readonly wishlistPointCount: number;
  readonly catalogPointCount: number;
}

const municipalDistricts = 'https://prefeitura.sp.gov.br/web/licenciamento/w/servicos/341586';
const municipalCulture = 'https://prefeitura.sp.gov.br/web/cultura/w/servicos/541';
const geoFeature = (layer: string, id: number) =>
  `https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=geoportal:${layer}&outputFormat=application/json&srsName=EPSG:4326&featureID=${layer}.${id}`;

export const MAP_PLACES: readonly MapPlace[] = [
  { id: 'world', name: 'World', kind: 'world', detail: 'orientation', description: 'An atlas of personal experiences. A colored parent means a physical visit somewhere inside it.' },
  { id: 'br', name: 'Brazil', parentId: 'world', kind: 'country', detail: 'orientation', description: 'Country orientation. Our detailed pilot is in São Paulo; other states are not cataloged.' },
  { id: 'br-sp', name: 'São Paulo state', parentId: 'br', kind: 'state', detail: 'orientation', description: 'São Paulo and Santos are distinct municipalities in the same state.' },
  { id: 'sao-paulo', name: 'São Paulo', parentId: 'br-sp', kind: 'municipality', detail: 'pilot', description: 'The capital pilot: two official districts and one explicitly curated cultural corridor.' },
  { id: 'santos', name: 'Santos', parentId: 'br-sp', kind: 'municipality', detail: 'pilot', description: 'A second municipality with two selected places. A detailed city world is not available.' },
  { id: 'perdizes', name: 'Perdizes', parentId: 'sao-paulo', kind: 'district', detail: 'pilot', description: 'An official municipal district. One visit does not mean every street has been explored.', sourceUrl: municipalDistricts },
  { id: 'jabaquara', name: 'Jabaquara', parentId: 'sao-paulo', kind: 'district', detail: 'pilot', description: 'An official district, with selected cultural places waiting to be discovered.', sourceUrl: municipalDistricts },
  { id: 'paulista-corridor', name: 'Paulista cultural corridor', parentId: 'sao-paulo', kind: 'corridor', detail: 'pilot', description: 'A curated grouping along Avenida Paulista, not an administrative district. No corridor boundary is claimed.', sourceUrl: 'https://admin.sggd.sp.gov.br/sec_cultura/Equipamentos/museus/CASA_DAS_ROSAS' },
  { id: 'santos-valongo', name: 'Valongo area', parentId: 'santos', kind: 'region', detail: 'pilot', description: 'A selected cultural area in Santos, with the Pelé Museum. This atlas does not draw a neighborhood boundary.', sourceUrl: 'https://turismosantos.com.br/pt-br/content/museu-pele-0' },
  { id: 'santos-jose-menino', name: 'Orchid park area', parentId: 'santos', kind: 'region', detail: 'pilot', description: 'A curated park grouping at Praça Washington. The municipal address identifies José Menino; another tourism page uses Marapé. No administrative boundary is asserted.', sourceUrl: 'https://www.santos.sp.gov.br/?q=node/96635' },
  {
    id: 'tuca', name: 'TUCA Theatre', parentId: 'perdizes', kind: 'point', detail: 'pilot', illustration: 'theatre',
    description: 'A theatre beside PUC-SP. This published anchor provides context for the fictional Perdizes memory; it does not verify where a souvenir was found.',
    address: 'Rua Monte Alegre, 1024 · Perdizes · São Paulo', lat: -23.538868, lon: -46.671081,
    sourceUrl: 'https://www.teatrotuca.com.br/localizacao.html', coordinateSourceUrl: 'https://www.teatrotuca.com.br/localizacao.html',
    coordinateNote: 'Approximate operator-published map anchor; not a surveyed entrance or GPS confirmation.'
  },
  {
    id: 'centro-cultural-jabaquara', name: 'Mãe Sylvia de Oxalá Cultural Center', parentId: 'jabaquara', kind: 'point', detail: 'pilot', illustration: 'theatre',
    description: 'A municipal center dedicated to Black culture. A discovery clue invites a future visit.',
    address: 'Rua Arsênio Tavolieri, 45 · Jabaquara · São Paulo', lat: -23.65092259, lon: -46.64492514,
    sourceUrl: municipalCulture, coordinateSourceUrl: geoFeature('equipamento_cultura_espacos_culturais', 40214), coordinateNote: 'Published municipal GeoSampa point, EPSG:4326.'
  },
  {
    id: 'sitio-da-ressaca', name: 'Sítio da Ressaca', parentId: 'jabaquara', kind: 'point', detail: 'pilot', illustration: 'house',
    description: 'A historic house in the Museum of the City collection. Check the official site before planning a visit.',
    address: 'Rua Nadra Raffoul Mokodsi, 3 · Jabaquara · São Paulo', lat: -23.65149364, lon: -46.64563607,
    sourceUrl: 'https://www.museudacidade.prefeitura.sp.gov.br/sitio-da-ressaca/', coordinateSourceUrl: geoFeature('equipamento_cultura_museus', 40232), coordinateNote: 'Published municipal GeoSampa point, EPSG:4326. Opening status is not maintained by this atlas.'
  },
  {
    id: 'masp', name: 'MASP', parentId: 'paulista-corridor', kind: 'point', detail: 'pilot', illustration: 'museum',
    description: 'Art suspended above Avenida Paulista. Save the place as a wish without claiming a physical visit.',
    address: 'Avenida Paulista, 1578 · São Paulo', lat: -23.56134353, lon: -46.65587216,
    sourceUrl: 'https://masp.org.br/visite', coordinateSourceUrl: geoFeature('equipamento_cultura_museus', 40300), coordinateNote: 'Published municipal GeoSampa point, EPSG:4326.'
  },
  {
    id: 'casa-das-rosas', name: 'Casa das Rosas', parentId: 'paulista-corridor', kind: 'point', detail: 'pilot', illustration: 'house',
    description: 'A house, a garden, and a place for literature along Paulista.',
    address: 'Avenida Paulista, 37 · São Paulo', lat: -23.57113165, lon: -46.64532694,
    sourceUrl: 'https://admin.sggd.sp.gov.br/sec_cultura/Equipamentos/museus/CASA_DAS_ROSAS', coordinateSourceUrl: geoFeature('equipamento_cultura_museus', 40276), coordinateNote: 'Published municipal GeoSampa point, EPSG:4326.'
  },
  {
    id: 'japan-house', name: 'Japan House São Paulo', parentId: 'paulista-corridor', kind: 'point', detail: 'pilot', illustration: 'museum',
    description: 'A cultural house at Paulista 52. Its address is verified; no unverified geographic coordinate is assigned.',
    address: 'Avenida Paulista, 52 · São Paulo', sourceUrl: 'https://japanhousesp.com.br/visite/', coordinateNote: 'Verified operator address only. Coordinate unavailable; shown schematically.'
  },
  {
    id: 'museu-pele', name: 'Pelé Museum', parentId: 'santos-valongo', kind: 'point', detail: 'pilot', illustration: 'museum',
    description: 'A museum in the Valongo mansions. A fictional postcard connects Santos to a friend.',
    address: 'Largo Marquês de Monte Alegre · Valongo · Santos', lat: -23.930999, lon: -46.333329,
    sourceUrl: 'https://turismosantos.com.br/pt-br/content/museu-pele-0', coordinateSourceUrl: 'https://turismosantos.com.br/pt-br/content/museu-pele-0', coordinateNote: 'Published municipal Turismo Santos point. A conflicting federal catalog coordinate was rejected.'
  },
  {
    id: 'orquidario-santos', name: 'Santos Orchid Park', parentId: 'santos-jose-menino', kind: 'point', detail: 'pilot', illustration: 'garden',
    description: 'A municipal park at Praça Washington. The illustration is original and is not a photograph of the park.',
    address: 'Praça Washington · Santos', lat: -23.965548, lon: -46.349044,
    sourceUrl: 'https://www.santos.sp.gov.br/?q=node/96635', coordinateSourceUrl: 'https://www.turismosantos.com.br/en/node/20710', coordinateNote: 'Published municipal Turismo Santos point. Sources differ on the neighborhood name; this is a curated park area.'
  },
  { id: 'fr', name: 'France', parentId: 'world', kind: 'country', detail: 'outside', description: 'Outside the pilot region. A received memory can open a portal here without recording a physical visit.' },
  { id: 'fr-idf', name: 'Île-de-France', parentId: 'fr', kind: 'state', detail: 'outside', description: 'Outside the pilot region. Detailed geography is not available.' },
  { id: 'paris', name: 'Paris', parentId: 'fr-idf', kind: 'municipality', detail: 'outside', description: 'Outside the pilot region. Receiving a Paris gift-memory does not mean you have been there.' }
];

export const PLACE_BY_ID: Readonly<Record<string, MapPlace>> = Object.fromEntries(MAP_PLACES.map(place => [place.id, place]));
export const pilotPlaces: readonly { id: string; name: string; lat: number; lon: number; label: string; coordinateNote: string }[] = MAP_PLACES
  .filter((place): place is MapPlace & { lat: number; lon: number } => place.kind === 'point' && typeof place.lat === 'number' && typeof place.lon === 'number')
  .map(place => ({ id: place.id, name: place.name, lat: place.lat, lon: place.lon, label: place.address ?? place.name, coordinateNote: place.coordinateNote ?? '' }));
export function getPilotPlace(id: string) { return pilotPlaces.find(place => place.id === id); }
export function childPlaces(id: string): readonly MapPlace[] { return MAP_PLACES.filter(place => place.parentId === id); }

/** Root-to-place path. Unknown places produce no false territorial attribution. */
export function placePath(id: string, catalog: readonly MapPlace[] = MAP_PLACES): readonly MapPlace[] {
  const byId = new Map(catalog.map(place => [place.id, place]));
  const path: MapPlace[] = [];
  const seen = new Set<string>();
  let current: MapPlace | undefined = byId.get(id);
  while (current) {
    if (seen.has(current.id)) throw new Error('A place hierarchy contains a cycle.');
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Pure recomputation from current records: never writes visits into children or another owner's world. */
export function aggregateDiscovery(
  records: readonly MapDiscovery[], ownerId?: string, catalog: readonly MapPlace[] = MAP_PLACES
): Readonly<Record<string, TerritoryProgress>> {
  const working = Object.fromEntries(catalog.map(place => [place.id, {
    physical: new Set<string>(), memoryPoints: new Set<string>(), memories: new Set<string>(), wishes: new Set<string>(), catalog: new Set<string>()
  }]));
  for (const place of catalog) {
    if (place.kind !== 'point') continue;
    for (const ancestor of placePath(place.id, catalog)) working[ancestor.id].catalog.add(place.id);
  }
  for (const record of records) {
    if (ownerId && record.ownerId && record.ownerId !== ownerId) continue;
    const path = placePath(record.placeId, catalog);
    for (const place of path) {
      const state = working[place.id];
      if (record.kind === 'physical') state.physical.add(record.placeId);
      if (record.kind === 'memory') {
        state.memoryPoints.add(record.placeId);
        state.memories.add(record.memoryId ?? record.id ?? record.placeId);
      }
      if (record.kind === 'wish') state.wishes.add(record.placeId);
    }
  }
  return Object.fromEntries(Object.entries(working).map(([id, state]) => [id, {
    physicallyVisited: state.physical.size > 0, physicalPointCount: state.physical.size,
    memoryPointCount: state.memoryPoints.size, memoryCount: state.memories.size,
    wishlistPointCount: state.wishes.size, catalogPointCount: state.catalog.size
  }]));
}

/** Explicitly fictional physical history; never assigned to a real account implicitly. */
export const FICTIONAL_DEMO_DISCOVERIES: readonly MapDiscovery[] = [
  { id: 'demo-visit-tuca', placeId: 'tuca', kind: 'physical', source: 'fictional-demo' },
  { id: 'demo-visit-santos', placeId: 'museu-pele', kind: 'physical', source: 'fictional-demo' },
  { id: 'demo-paris-portal', placeId: 'paris', kind: 'memory', memoryId: 'demo-paris-memory', source: 'fictional-demo' },
  { id: 'demo-paulista-wish', placeId: 'masp', kind: 'wish', source: 'fictional-demo' }
];
