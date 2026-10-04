/** Reviewable suggestions; GPS and image interpretation never authenticate a place. */
export type PlaceAssistantProvider = 'template' | 'openai' | 'gemini' | 'vercel';
export interface PlaceAssistantLocation { latitude:number; longitude:number; accuracyMeters?:number; label?:string }
export interface PlaceAssistantInput {
 imageDataUrl?:string; photoConsent?:boolean;
 location?:PlaceAssistantLocation; locationConsent?:boolean;
 placeName?:string; language?:'pt'|'en';
}
export interface PlaceAssistantCandidate {
 id:string; label:string; latitude:number; longitude:number; distanceMeters:number;
 kind:string; approximate:true; source:{title:string;url:string};
}
export interface PlaceAssistantCuriosity {
 id:string; title:string; text:string; sourceTitle:string; sourceUrl:string;
 scope:'place'|'nearby';
}
export interface PlaceAssistantStatus {
 available:true; photoAnalysisAvailable:boolean; provider:PlaceAssistantProvider;
 locationAvailable:true;
 imageConsentLabel?:string;
 privacy:{photoSentOnlyWithConsent:true;coordinatesSentOnlyWithConsent:true};
}
export interface PlaceAssistantSuggestion {
 title:string; story:string; worldPrompt:string; photoDescription?:string;
 provider:PlaceAssistantProvider; photoAnalyzed:boolean;
 places:PlaceAssistantCandidate[]; curiosities:PlaceAssistantCuriosity[];
 warnings:string[]; locationStatus:'not-requested'|'matched'|'unavailable';
}
