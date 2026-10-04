import type { InstantObjectRepresentation } from '../shared/instant-examples';
export interface CollectionRoomItem {
  id: string;
  title: string;
  subtitle: string;
  story: string;
  imageUrl?: string;
  modelUrl?: string;
  mediaExpiresAt?: number;
  photoIntent?: 'object' | 'place';
  objectRepresentation?: InstantObjectRepresentation;
  originalImageUrl?: string;
  modelYaw?: number;
  openPath: string;
  worldPath?: string;
  kind: 'generated' | 'memory';
  demo: boolean;
}

export interface CollectionProjection { id: string; x: number; y: number; visible: boolean }
export type CollectionMood = 'sunset' | 'night';
export interface CollectionSceneOptions {
  items: readonly CollectionRoomItem[];
  isCurrent(): boolean;
  onSelect(id: string): void;
  onProject(points: readonly CollectionProjection[]): void;
  onReady(): void;
  onUnavailable(message: string): void;
  onPlaybackChange?(playing: boolean): void;
  onPropSelect?(id: 'photo-frame' | 'travel-journal'): void;
}
export interface CollectionSceneHandle {
  select(id: string | null): void;
  reset(): void;
  look(delta: number): void;
  zoom(delta: number): void;
  setMood(mood: CollectionMood): void;
  setPlaying(playing: boolean): void;
  step(direction: -1 | 1): void;
  destroy(): void;
}

export interface CollectionRoomOptions {
  items: readonly CollectionRoomItem[];
  title: string;
  subtitle: string;
  isCurrent(): boolean;
  onHome(): void;
  onCreate(): void;
  onOpen(item: CollectionRoomItem, world: boolean): void;
  onManage?(): void;
}
