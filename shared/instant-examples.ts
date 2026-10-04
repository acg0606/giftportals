export type InstantPhotoIntent = 'object' | 'place';
export type InstantExampleCategory = 'cities' | 'objects';
export type InstantObjectRepresentation = 'original-object' | 'framed-postcard' | 'derived-object' | 'souvenir-miniature';
export interface InstantExample {
  id: string; title: string; imageUrl: string; worldPrompt: string; worldImageUrl?: string;
  photoIntent?: InstantPhotoIntent; category?: InstantExampleCategory; caption?: string; story?: string;
  curiosityIds?: readonly string[]; regionId?: string; objectHint?: string; readyGiftUrl?: string;
  objectImageUrl?: string; objectImageRole?: 'miniature-reference'; objectRepresentation?: InstantObjectRepresentation;
}

/** One catalog for the browser and local API. These are original artistic
 * references, not authenticated photographs or scans of museum objects. */
export const INSTANT_EXAMPLES: readonly InstantExample[] = [
  { id: 'rio', title: 'Rio at dusk', category: 'cities', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', objectImageUrl: '/assets/portal-dusk/rio-keepsake.png', objectImageRole: 'miniature-reference', regionId: 'rio', imageUrl: '/assets/examples/v13/rio.jpg', caption: 'Artistic interpretation · inspired by Rio de Janeiro', curiosityIds: ['rio-gardens'], readyGiftUrl: '#/generated/rio-example',
    worldPrompt: 'An artistic Rio de Janeiro bay at golden dusk inspired by the reference image. Sugarloaf Mountain, warm sea breeze, sailboats and a quiet wooden overlook with soft lanterns. Preserve the place and its light. An open, intimate space to discover a personal message. No text, no people.',
    story: 'Imagine a warm afternoon by the bay, the last light touching the mountains. A little piece of Rio, kept close for someone you love.' },
  { id: 'paris', title: 'Paris at blue hour', category: 'cities', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', objectImageUrl: '/assets/examples/v17/paris-souvenir-reference.png', objectImageRole: 'miniature-reference', regionId: 'paris', imageUrl: '/assets/examples/v13/paris.jpg', caption: 'Artistic interpretation · inspired by Paris', curiosityIds: ['paris-seine'], readyGiftUrl: '#/generated/paris-example',
    worldPrompt: 'An artistic Paris riverside at blue hour inspired by the reference image. The Seine, stone bridges, distant Eiffel Tower, amber lights along the quays and a quiet bench beside the water. Purple twilight, warm windows and reflections. Preserve the illustrated place and its light. No text, no people.',
    story: 'Imagine an evening walk along the Seine, with the city glowing around a quiet moment. A little piece of Paris you can keep close and step inside.' },
  { id: 'kyoto', title: 'Kyoto garden', category: 'cities', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', objectImageUrl: '/assets/examples/v17/kyoto-souvenir-reference.png', objectImageRole: 'miniature-reference', regionId: 'kyoto', imageUrl: '/assets/examples/v13/kyoto.jpg', caption: 'Artistic interpretation · inspired by Kyoto', curiosityIds: ['kyoto-gardens'],
    worldPrompt: 'An artistic Kyoto garden inspired by the reference image. A dry stone path, wooden pagoda, red maples, moss and a calm pond in soft morning mist. Gentle daylight, warm timber and space to look around near the path. Preserve the illustrated architecture and atmosphere. No text, no people.',
    story: 'Imagine a quiet garden in the morning mist, where a small path leads to a moment worth keeping. A little tribute to Kyoto.' },
  { id: 'new-york', title: 'New York in golden light', category: 'cities', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', objectImageUrl: '/assets/examples/v17/new-york-souvenir-reference.png', objectImageRole: 'miniature-reference', regionId: 'new-york', imageUrl: '/assets/examples/v13/new-york.jpg', caption: 'Artistic interpretation · inspired by New York', curiosityIds: ['new-york-bridge'],
    worldPrompt: 'An artistic Brooklyn waterfront at golden hour inspired by the reference image. Manhattan skyline, Brooklyn Bridge, warm light reflected on the East River and a broad quiet waterfront overlook. Amber sun against a soft sky. Preserve the illustrated bridge, skyline and light. No text, no people.',
    story: 'Imagine a pause by the East River, a bridge joining two sides of a city and a moment connecting two people. A little world for the next chapter.' },
  { id: 'cairo', title: 'Cairo & Giza in golden light', category: 'cities', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', objectImageUrl: '/assets/examples/v17/cairo-souvenir-reference.png', objectImageRole: 'miniature-reference', regionId: 'cairo', imageUrl: '/assets/examples/v13/cairo.jpg', caption: 'Artistic interpretation · inspired by Cairo and Giza', curiosityIds: ['cairo-pyramids'],
    worldPrompt: 'An artistic Cairo-and-Giza-inspired courtyard based on the reference image. Warm sandstone, shaded arches, palms, an open terrace and the pyramids in distant golden light. Clay, cream and muted palm green. Preserve the illustrated view and its warm atmosphere. No text, no people.',
    story: 'Imagine golden light crossing a sandstone courtyard, with the pyramids in the distance. An artistic place for a new story to be shared.' },
  { id: 'antikythera', title: 'Antikythera mechanism', category: 'objects', photoIntent: 'object', objectHint: 'antikythera', imageUrl: '/assets/examples/v13/antikythera.jpg', worldImageUrl: '/assets/examples/v13/antikythera-world.jpg', caption: 'Artistic reference · inspired by ancient astronomical mechanisms', curiosityIds: ['antikythera-calendar'], readyGiftUrl: '#/generated/antikythera-example',
    worldPrompt: 'An imaginative ancient Greek island observatory inspired by astronomical gears. A stone terrace overlooking the Mediterranean, bronze celestial rings, warm lamps, a darkening starry sky and an open path around a low table. A fictional setting celebrating human curiosity. No text, no people.',
    story: 'A little tribute to the people who turned questions about the sky into gears. Imagine carrying that curiosity into a world of your own.' },
  { id: 'astrolabe', title: 'A brass astrolabe', category: 'objects', photoIntent: 'object', objectHint: 'astrolabe', imageUrl: '/assets/examples/v13/astrolabe.jpg', caption: 'Artistic reference · inspired by historical astrolabes', curiosityIds: ['astrolabe-cultures'],
    worldPrompt: 'An imaginative observatory courtyard inspired by a brass astrolabe. Sandstone arches, a low instrument table, geometric floor tiles, warm brass, deep violet evening sky and distant stars. An open space celebrating navigation and knowledge shared across cultures. No text, no people.',
    story: 'A small instrument, a very large sky. Imagine a meeting place for the people who learned to read the stars and share what they found.' },
  { id: 'voyager-golden-record', title: 'Voyager Golden Record', category: 'objects', photoIntent: 'object', objectHint: 'voyager-golden-record', imageUrl: '/assets/examples/v13/voyager-golden-record.jpg', caption: 'Artistic reference · inspired by the Voyager Golden Record', curiosityIds: ['voyager-message'],
    worldPrompt: 'An imaginative quiet space observatory inspired by the Voyager Golden Record. A circular open viewing deck, warm golden light, translucent listening rings, Earth glowing in the distance and a deep star field. A fictional place to leave a personal message for someone far away. No text, no people.',
    story: 'A message sent far beyond home. Imagine making a tiny record of the sounds, memories and people you would want the universe to know.' },
  { id: 'apollo-capsule', title: 'Apollo return capsule', category: 'objects', photoIntent: 'object', objectHint: 'apollo-capsule', imageUrl: '/assets/examples/v13/apollo-capsule.jpg', caption: 'Artistic reference · inspired by Apollo command modules', curiosityIds: ['apollo-return'],
    worldPrompt: 'An imaginative Apollo-inspired lunar observation deck. A quiet broad platform, softly lit control consoles, silver surfaces, warm amber guidance lights and Earth above the horizon. A fictional space for a story about courage and coming home. No text, no people.',
    story: 'A little tribute to a journey that needed a way home. Imagine a place to look back at Earth and remember who is waiting for you.' },
  { id: 'printing-press', title: 'A movable-type press', category: 'objects', photoIntent: 'object', objectHint: 'printing-press', imageUrl: '/assets/examples/v13/printing-press.jpg', caption: 'Artistic reference · inspired by early European printing presses', curiosityIds: ['printing-pages'],
    worldPrompt: 'An imaginative early European print workshop inspired by movable-type printing. Warm timber beams, sunlight through high windows, paper stacks, brass type trays and a broad open aisle around a wooden worktable. A fictional place celebrating ideas shared through books. No readable text, no people.',
    story: 'A small machine that helped ideas travel. Imagine a workshop where the next page could carry a message written just for someone you love.' },
];

export function instantCatalogCategory(examples: readonly InstantExample[], category: InstantExampleCategory): InstantExample[] {
  return examples.filter(example => example.category === category || (!example.category && example.photoIntent === (category === 'cities' ? 'place' : 'object'))).map(example => ({ ...example }));
}
