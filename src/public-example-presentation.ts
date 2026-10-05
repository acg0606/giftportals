import type { GeneratedGiftData } from './generated-gift';
import type { CollectionRoomItem } from './collection-types';

type ExamplePresentation = Partial<Pick<GeneratedGiftData, 'title' | 'story' | 'dedication' | 'senderName' | 'recipientName'>>;

// The owner explicitly approved English presentation for these existing public
// examples. Archived records and every other author's words remain untouched.
const presentations: Record<string, ExamplePresentation> = {
  'c864acd7-88d0-4b02-bff7-67ae186243dc': {
    title: 'A quiet square',
    story: 'A quiet square to enjoy nature. I planted a tree here.',
    dedication: 'I wish you were here, enjoying this place with me!',
    senderName: 'Andrew',
    recipientName: 'You',
  },
  'cc997d6d-faf2-4b5a-8bfa-9196716bec71': {
    title: 'A little square to share',
    story: '',
    dedication: '',
    senderName: '',
    recipientName: '',
  },
};

export function publicExamplePresentation(id: string): ExamplePresentation {
  return Object.hasOwn(presentations, id) ? { ...presentations[id] } : {};
}

export function presentedPublicExampleGift(id: string, gift: GeneratedGiftData): GeneratedGiftData {
  return Object.hasOwn(presentations, id) ? { ...gift, ...publicExamplePresentation(id) } : gift;
}

export function presentedPublicExampleItem(item: CollectionRoomItem): CollectionRoomItem {
  const id = item.id.replace(/^(?:public|session):/, '');
  if (!Object.hasOwn(presentations, id)) return item;
  const presentation = publicExamplePresentation(id);
  return { ...item, ...(presentation.title !== undefined ? { title: presentation.title } : {}),
    ...(presentation.story !== undefined ? { story: presentation.story } : {}) };
}
