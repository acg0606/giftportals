// The existing souvenir recipe is retained; no legacy 10k/draft cloud recipe.
import { GIFT_ART_STYLE,WORLD_REALISM_STYLE,WORLD_REALISM_LIGHTING } from '../../shared/gift-art-style.js';
export { GIFT_ART_STYLE_VERSION,WORLD_ART_PROMPT_VERSION,SOUVENIR_ART_PROMPT_VERSION } from '../../shared/gift-art-style.js';
// Explicitly pinned after the successful photographic Paris V11 operation.
export const CLOUD_WORLD_MODEL='marble-1.1' as const;
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
    'Create one cohesive, sharply detailed, photorealistic three-dimensional spatial world for a personal gift.',
    WORLD_REALISM_STYLE,
    input.hasPlaceReference ? 'The supplied original scene photograph is the primary visual evidence. Faithfully reconstruct every visible landmark, building mass, foreground surface, shoreline, tree group, object and spatial relationship. Preserve recognizable details instead of substituting generic scenery. Extend the surroundings coherently from this evidence; do not add invented landmarks, platforms or decorative props.' : 'Create a complete, physically plausible photographic environment from the setting description. The separately generated gift is a small keepsake carried by the visitor; its object photo is not a scene reference.',
    input.photoIntent === 'place' ? 'Recreate the original place at full human scale with depth beyond the viewpoint. The souvenir is generated separately; its plinth, wood, brass and studio backdrop must not appear in this environment.' : 'Realize the setting, craft or idea associated with the keepsake through believable architecture, surfaces, furniture and natural light. Keep the gift at its original human object scale.',
    input.exampleTitle ? `Selected example context: ${input.exampleTitle}. Preserve its visible scene identity. Generated unseen areas remain inferred; an object-inspired setting does not authenticate a historical interior or artifact.` : 'Preserve the meaning of personal setting details. Infer unseen surroundings plausibly without claiming a measured geographic scan or verified artifact origin.',
    `Setting content (preserve the actual scene elements; photographic reconstruction takes priority over any inherited decorative style descriptions): ${input.worldPrompt}`,
    'Foreground: reconstruct the actual visible ground, floor, steps, quay or shoreline with sharp surface detail and correct perspective. Where a walkable surface exists, continue it into a connected area with visible boundaries. Keep water, voids, steep terrain and drop-offs distinct from walking surfaces; do not invent a floor over them.',
    'Middle distance: preserve spacing, height and depth of buildings, landmarks, vegetation and objects. Reconstruct open structure, windows, railings and branches as separate spatial detail.',
    'Background: preserve the skyline, mountain contours, horizon and distant architecture. Complete plausible side and rear views with consistent scale and light.',
    WORLD_REALISM_LIGHTING,
    'Spatial layout: keep physical structures continuous, grounded and mutually consistent. Retain genuine paths, railings, edges and obstacles instead of replacing them with generic decorative scenery. Maintain the original scene\'s proportions and natural colors.',
    'Content: no people, identifiable faces, readable text, captions, watermarks or image borders.',
  ].join('\n\n');
}
