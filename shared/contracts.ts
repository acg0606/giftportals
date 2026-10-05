export type Provider = 'tripo' | 'worldlabs';
export type DiscoveryKind = 'physical' | 'memory' | 'wish';
export type LocationSource = 'manual' | 'gps-consent' | 'photo-metadata' | 'fictional-demo';
export type JobState = 'pending' | 'processing' | 'completed' | 'failed';
export type MediaKind = 'gift-photo' | 'place-photo' | 'audio' | 'model' | 'world';
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export interface UserDTO { id: string; displayName: string; demo: boolean }
export interface SessionDTO { accessToken: string; refreshToken: string; expiresAt: number; user: UserDTO }
export interface SignupDTO { session: SessionDTO | null; confirmationRequired: boolean }
export interface LocationDTO { placeId: string; label: string; latitude: number; longitude: number; source: LocationSource; experiencedAt: string }
export interface MediaDTO { id: string; kind: MediaKind; url: string; mimeType: string; bytes: number; generated: boolean; provider?: Provider; expiresAt: number }
export interface MemoryDTO { id: string; ownerId: string; ownerName: string; title: string; story: string; location: LocationDTO; shareLocation?:boolean; aiConsent?:boolean; archivedAt?:string|null; createdAt: string; demo: boolean; artisticNote: string; media: MediaDTO[]; objectStatus: JobState | 'not-requested'; environmentStatus: JobState | 'not-requested' }
export interface GiftDTO { id: string; memoryId: string; senderName: string; recipientName: string | null; message: string; createdAt: string; revokedAt: string | null; claimedBy: string | null; token?: string; url?: string; claimToken?:string; claimUrl?:string }
export interface GiftViewDTO { gift: GiftDTO; memory: MemoryDTO; canClaim: boolean }
export interface DiscoveryDTO { id: string; placeId: string; kind: DiscoveryKind; source: string; memoryId: string | null; createdAt: string }
export interface JobDTO { id: string; memoryId: string; provider: Provider; state: JobState; providerTaskId: string | null; attempts: number; errorCode: string | null; createdAt: string; updatedAt: string }
export interface WorldDTO { user: UserDTO; memories: MemoryDTO[]; sent: GiftDTO[]; received: GiftDTO[]; discoveries: DiscoveryDTO[]; jobs: JobDTO[] }
export interface CreateMemoryInput { title: string; story: string; location: LocationDTO; aiConsent: boolean; shareLocation: boolean }
export interface UploadInput { memoryId: string; kind: 'gift-photo' | 'place-photo' | 'audio'; mimeType: string; bytes: number; consent: boolean; metadataConsent:boolean }
export interface UploadDTO { mediaId: string; path: string; signedUploadUrl: string; token: string }
export interface CreateGiftInput { memoryId: string; message: string; recipientName?: string; allowLinkRead: boolean; allowClaim?:boolean }
export interface GenerateInput { memoryId: string; provider: Provider; dedupeKey: string }
export interface StatusDTO { storage: 'cloud'; configured: boolean; generationEnabled: boolean; providers: { tripo: boolean; worldlabs: boolean }; demoAvailable: boolean; signupEnabled: boolean; keepsakeSyncEnabled?: boolean }

// API: /api/giftportals?action=ACTION. Authenticated actions require
// Authorization: Bearer SESSION.accessToken. JSON bodies contain these DTOs.
// GET status -> StatusDTO; POST demo-login {persona:'sender'|'recipient'} -> SessionDTO
// POST login {email,password} -> SessionDTO; POST refresh {refreshToken} -> SessionDTO
// POST signup {email,password,displayName} -> SignupDTO (if status.signupEnabled)
// GET demo -> MemoryDTO[] (explicit fictional, public fixture only)
// GET world -> WorldDTO; POST memory -> MemoryDTO
// PATCH memory {memoryId,...CreateMemoryInput} -> MemoryDTO; DELETE memory&id=ID -> {archived:true}
// POST restore {memoryId} -> MemoryDTO; GET world&archived=true includes owner archives only
// POST upload -> UploadDTO; PUT signedUploadUrl with original bytes; POST media-complete {mediaId} -> MemoryDTO
// POST share -> GiftDTO (token and URL returned once); GET gift with X-Gift-Token -> GiftViewDTO
// POST claim {token,claimToken} -> GiftViewDTO; GET gift with X-Gift-Claim optionally validates claim permission
// POST revoke {giftId} -> {revoked:true}; read URL alone can never claim a memory
// POST discovery {placeId,kind,memoryId?} -> DiscoveryDTO; DELETE discovery&id=ID -> {deleted:true}
// POST generate -> JobDTO; GET jobs -> JobDTO[]; POST retry {jobId} -> JobDTO
