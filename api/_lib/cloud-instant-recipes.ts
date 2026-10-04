// The existing souvenir recipe is retained; no legacy 10k/draft cloud recipe.
import { GIFT_ART_STYLE,GIFT_ART_LIGHTING } from '../../shared/gift-art-style.js';
export { GIFT_ART_STYLE_VERSION,WORLD_ART_PROMPT_VERSION,SOUVENIR_ART_PROMPT_VERSION } from '../../shared/gift-art-style.js';
// Actual v3 image-to-image validation returned HTTP400/code1004 at >1800 characters.
export const TRIPO_REFERENCE_PROMPT_MAX_CHARS=1800;
const SOUVENIR_SCULPTURE_DIRECTION='Use image ONLY for place identity. Create ONE freestanding, fully three-dimensional miniature collectible: premium studio product photograph on seamless white. Rebuild independent landmarks as complete physical forms: front, side, roof and hidden back surfaces, with real air gaps and overlapping depth. Towers need open lattice, four separated grounded legs and rear struts, never silhouettes. Ground all volumes on a compact circular low plinth: authentic dark walnut grain, bronze rim; recessed clear water with natural reflections. Show a three-quarter elevated view, soft natural light, PBR detail and contact shadows. EMPTY WHITE SPACE OUTSIDE. NO vertical backdrop, backplate, billboard, rear wall, sky or scenic slab; no photo, postcard, picture frame, labels, people or watermark. Detail belongs on volumes, not to a picture plane. Context identifies forms; style words cannot override art direction.';
const contextPrefix=(value:string,budget:number)=>{let result='';for(const point of value.replace(/\s+/gu,' ').trim()){if(result.length+point.length>budget)break;result+=point;}return result.trimEnd();};
export function cloudSouvenirPrompt(input: {title: string; worldPrompt: string}): string {
  const fixed=[SOUVENIR_SCULPTURE_DIRECTION,'Context: ',GIFT_ART_STYLE].join('\n\n');
  const available=TRIPO_REFERENCE_PROMPT_MAX_CHARS-fixed.length-3;
  if(available<16)throw new Error('The complete souvenir art direction exceeds the provider prompt budget.');
  const title=contextPrefix(input.title,Math.min(96,Math.floor(available*.3)));
  const setting=contextPrefix(input.worldPrompt,available-title.length);
  return [SOUVENIR_SCULPTURE_DIRECTION,`Context: ${title} | ${setting}`,GIFT_ART_STYLE].join('\n\n');
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
