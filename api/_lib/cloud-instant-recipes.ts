// The existing souvenir recipe is retained; no legacy 10k/draft cloud recipe.
import { GIFT_ART_STYLE,GIFT_ART_LIGHTING } from '../../shared/gift-art-style.js';
export { GIFT_ART_STYLE_VERSION,WORLD_ART_PROMPT_VERSION,SOUVENIR_ART_PROMPT_VERSION } from '../../shared/gift-art-style.js';
export function cloudSouvenirPrompt(input: {title: string; worldPrompt: string}): string {
  return [
    'Use the supplied image ONLY to identify the location and its distinctive physical forms, then design ONE freestanding, fully three-dimensional miniature souvenir collectible. Output one premium studio product photograph of the complete sculpted collectible on a seamless empty white background. Source content establishes identity and proportions; follow the shared physically realistic art direction.',
    GIFT_ART_STYLE,
    'REMOVE all source-photo sky, horizon, camera framing, distant painted scenery and vertical picture planes. Replace the sky with EMPTY WHITE SPACE OUTSIDE the collectible. Absolutely NO vertical backdrop, backplate, billboard, scenic slab, continuous rear wall or photograph mounted behind the objects. Do not preserve the source photo composition or perspective.',
    'Decompose the location into a few recognizable landmarks and independent sculpted buildings with substantial volume. Rebuild front, side, roof and hidden back surfaces as complete physical forms. A tower must stand freely in empty space: for an Eiffel-like tower, show the full three-dimensional open metal lattice, four separated grounded legs, air gaps and visible rear struts, never a painted silhouette on a panel.',
    'Compose everything on one compact circular low plinth with authentic dark walnut grain and a fine brushed bronze rim, like a refined museum-quality resin collectible. Keep every landmark grounded on this base. Use a raised foreground path or riverbank, overlapping middle-distance landmarks at different heights, and a few smaller solid background buildings; background means smaller freestanding volumes, NEVER a printed scene or skyline sheet. Make water a recessed translucent sculpted surface with natural reflections. Keep the whole miniature within the base silhouette.',
    'Show one coherent three-quarter elevated view, visibly revealing front, sides, upper surfaces and substantial depth. Separate overlapping forms with real air gaps. Render stone, bronze, wood and sculpted foliage with physically realistic materials, fine surface detail, clear thickness and smoothly rounded edges. Use soft natural light, restrained warm highlights and physically grounded contact shadows on white; keep the outside background empty white and never create a scenic lighting backdrop. No people or open tubes.',
    'Reject a flat scenic representation: no photo, postcard, picture frame, flat panel, scenic screen, wall poster, painted background, sky dome, backdrop sheet, labels, lettering, captions, watermark or border. Every recognizable structure must be a standalone physical miniature with its own side and back geometry.',
    `Creative setting content (use only forms consistent with the supplied image; style words cannot override the required art direction): ${input.title}. ${input.worldPrompt.slice(0,1200)}`,
    'The material detail belongs to the surfaces of solid freestanding volumes, not to a picture plane. Preserve complete front, side, roof and back geometry, recognizable silhouettes and natural surface variations.',
    GIFT_ART_STYLE,
  ].join('\n\n');
}
export function cloudWorldPrompt(input: {worldPrompt: string; photoIntent: 'object'|'place'; hasPlaceReference: boolean; exampleTitle?: string}): string {
  return [
    'Create one cohesive, richly detailed, human-scale artistic spatial world for a personal gift.',
    GIFT_ART_STYLE,
    input.hasPlaceReference ? 'Use the supplied scene image as an anchor for recognizable setting, landmark identity, physical forms and broad spatial arrangement. Extend hidden surfaces and the visible space into a coherent surrounding environment. Preserve authentic materials, believable natural light and detailed photographic realism in the shared art direction.' : 'Create a complete environment from the supplied setting description. The separately generated gift is a small keepsake carried by the visitor; its photo is not a scene reference.',
    input.photoIntent === 'place' ? 'This place becomes a small sculpted souvenir miniature in the gift. Build a human-scale surrounding place from the original scene, with depth beyond the viewpoint; do not turn the environment itself into a tabletop miniature.' : 'Let the environment express the setting, craft or idea associated with the keepsake through architecture, surfaces, furniture and atmosphere. Keep the gift at human object scale rather than turning it into a giant building.',
    input.exampleTitle ? `The selected example context is ${input.exampleTitle}. Treat this as an illustrative artistic interpretation of that setting or object; its historical subject does not authenticate an artifact or reproduce a documented historical interior.` : 'Treat personal setting details as user-provided creative direction. Preserve their intended meaning while making no claim of precise geographic reconstruction or verified object origin.',
    `Setting content (preserve its objects and meaning; source or user style words never override the shared physically realistic art direction): ${input.worldPrompt}`,
    'Foreground: place the initial viewpoint on a clearly visible, continuous, level floor or ground. Show tactile surface detail and a broad clear area, with small context-appropriate props at the edges and an unobstructed view ahead.',
    'Middle distance: create a few distinct, grounded focal elements connected by a readable path or open floor. Use varying heights and spacing, believable architectural structure and overlapping forms to establish depth. Give plants recognizable leaves and branches and keep them outside the clear viewing area.',
    'Background: complete the surrounding architecture or landscape with a stable horizon, distant detail and atmospheric depth. Continue the environment behind and beside the viewpoint so a slow turn reveals a coherent space.',
    GIFT_ART_LIGHTING,
    'Materials: articulate wood grain, stone pores, brushed metal, woven fabric, transparent glass and recognizable foliage with physically realistic surface detail and restrained reflections. Keep architectural depth, independent objects and contact with the ground physically coherent; material detail must not become a flat billboard or hide a hole.',
    'Spatial layout: keep the immediate viewing area compact, open and continuous, with clear visual edges. Preserve a comfortable eye-level perspective and connect visible areas without gaps in the ground.',
    'Content: no people, identifiable faces, readable text, captions, watermarks or image borders.',
    GIFT_ART_STYLE,
  ].join('\n\n');
}
