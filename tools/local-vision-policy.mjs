// Scores are screening signals, not calibrated probabilities or object provenance.
export const VISION_WEIGHTS_VERSION = 'giftportals-local-vision-v1:clip-text-q8+clip-vision-fp32+vit-nsfw-q8';
export const VISION_VERSION = `${VISION_WEIGHTS_VERSION}:policy-3`;
export const VISION_PROTOCOL = 'giftportals-local-vision-v1';
// Policy changes do not change pinned model bytes. Existing verified weight
// manifests stay usable offline; reports still carry the current policy version.
export function compatibleVisionWeights(version) {
 return [VISION_WEIGHTS_VERSION,`${VISION_WEIGHTS_VERSION}:policy-1`,`${VISION_WEIGHTS_VERSION}:policy-2`,VISION_VERSION].includes(version);
}
export const OBJECT_LABELS = [
  ['clock','a photograph of a clock or pocket watch'],
  ['ceramic','a photograph of a ceramic cup, vase or pottery'],
  ['camera','a photograph of an old photographic camera'],
  ['book','a photograph of a book'],
  ['bird','a photograph of a bird or bird figurine'],
  ['landscape','a photograph of a landscape, forest, mountain or city'],
  ['keepsake','a photograph of a miniature souvenir or keepsake'],
  ['unknown','a photograph of an ordinary household object'],
  ['unknown','a photograph of a fully clothed person'],
  ['unknown','a photograph of food or fruit'],
  ['unknown','a photograph of a phone or electronic device'],
  ['unknown','a photograph of jewelry or a small ornament'],
  ['unknown','a photograph of a toy or stuffed animal'],
  ['unknown','a photograph of a toothbrush or hair care tool'],
  ['unknown','a photograph of a candle or a bottle'],
  // General ordinary categories, never an image hash or a named asset exception.
  ['landscape','a photograph of a city skyline and riverside architecture at dusk'],
  ['landscape','a photograph of a scenic river, bridge and city buildings'],
  ['landscape','a photograph of a mountain bay with boats and coastal scenery'],
  ['keepsake','a photograph of a framed landscape painting or postcard'],
  ['unknown','a photograph of a historic spacecraft or space capsule'],
  ['unknown','a photograph of a golden phonograph record and its protective cover'],
  ['unknown','a photograph of an astronomical instrument or brass astrolabe'],
  ['unknown','a photograph of a historical mechanical computing device made of bronze gears'],
  ['unknown','a photograph of a traditional wooden printing press'],
  ['unknown','a photograph of a vintage record player or phonograph'],
  // Distinct ordinary structures and water scenes missing from the older bank.
  // This is a versioned comparison bank, never a special approval for one photo.
  ['landscape','a photograph of a wooden pier or jetty extending into a lake'],
  ['landscape','a photograph of calm water, distant mountains and a cloudy sunset sky'],
  ['landscape','a photograph of a bridge or boardwalk made of weathered wooden planks'],
  ['adult-product','a product photograph of a sex toy or vibrator'],
  ['adult-product','a product photograph of a dildo'],
  ['adult-product','a product photograph of an adult sexual device'],
  ['sexual','a photograph containing intimate nudity'],
  ['sexual','a photograph depicting sexual activity'],
];
export function visionDecision(sexual, ranked) {
  if (!Number.isFinite(sexual) || sexual<0 || sexual>1 || !Array.isArray(ranked) || !ranked.length || ranked.some(x=>!Number.isFinite(x.score)||x.score<0||x.score>1)) throw new Error('INVALID_SCORES');
  const risk = kind => ranked.filter(x=>x.kind===kind).reduce((sum,x)=>sum+x.score,0);
  const adultProduct = Math.min(1,risk('adult-product'));
  const sexualSignal = Math.max(sexual,Math.min(1,risk('sexual')));
  const ordered = [...ranked].sort((a,b)=>b.score-a.score), top=ordered[0];
  let decision='allow', category='ordinary';
  if (sexualSignal>=.40) { decision='block';category='sexual'; }
  else if(adultProduct>=.35 || top.kind==='adult-product' && top.score>=.20) { decision='block';category='adult-product'; }
  else if(sexualSignal>=.15 || adultProduct>=.08 || top.kind==='sexual') { decision='review';category='uncertain'; }
  const objectHint = !['adult-product','sexual'].includes(top.kind) && top.score>=.35 ? top.kind : 'unknown';
  return {decision,category,modelVersion:VISION_VERSION,scores:{sexual:sexualSignal,adultProduct},objectHint,objectConfidence:objectHint==='unknown'?0:top.score};
}
