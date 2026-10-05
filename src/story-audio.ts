import './story-audio.css';

export interface StoryAudioOptions { onTranscript(text: string): void | boolean; isCurrent(): boolean }
export interface StoryAudioHandle { stop(): void; destroy(): void }
export type StoryAudioPhase = 'idle' | 'requesting' | 'recording' | 'ready' | 'transcribing' | 'review';
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_CHARACTERS = 1200;
function audioIcon(name: 'microphone' | 'upload' | 'stop' | 'document' | 'check' | 'clear' | 'cancel'): string {
 const paths = {
  microphone: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clear: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
 };
 return `<svg class="story-audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
const types = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac'];
const messages: Record<string, string> = {
 AUDIO_UNAVAILABLE: 'Voice transcription is unavailable here. You can type your story.',
 AUDIO_BUSY: 'Another voice note is being transcribed. Try again shortly.',
 AUDIO_CANCELLED: 'Transcription cancelled.',
 AUDIO_TYPE_INVALID: 'Choose a WAV, MP3, M4A, WebM or Ogg audio file.',
 AUDIO_CONTENT_INVALID: 'This audio could not be read. Try another recording or audio file.',
 AUDIO_SIZE_LIMIT: 'Choose an audio file smaller than 6 MB.',
 AUDIO_DURATION_LIMIT: 'Keep your voice note to 60 seconds or less.',
 AUDIO_NO_SPEECH: 'No clear speech was found. Try a closer microphone or a clearer voice note.',
 AUDIO_TRANSCRIPT_LIMIT: 'This transcript is too long. Record a shorter voice note.',
};
export function validReviewedTranscript(value: string): boolean { return value.trim().length > 0 && value.length <= MAX_CHARACTERS; }
export function storyAudioUsesLocalServer(hostname: string): boolean { return ['localhost','127.0.0.1','[::1]','::1'].includes(hostname.toLowerCase()); }
interface BrowserSpeechResult { isFinal: boolean; [index: number]: { transcript: string } }
interface BrowserSpeechEvent { results: { length: number; [index: number]: BrowserSpeechResult } }
interface BrowserSpeechRecognition {
 lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
 onstart: (()=>void)|null; onresult: ((event:BrowserSpeechEvent)=>void)|null; onerror: ((event:{error:string})=>void)|null; onend: (()=>void)|null;
 start():void; stop():void; abort():void;
}
type BrowserSpeechConstructor = new()=>BrowserSpeechRecognition;
function browserSpeechConstructor():BrowserSpeechConstructor|undefined {
 const browser=window as typeof window & {SpeechRecognition?:BrowserSpeechConstructor;webkitSpeechRecognition?:BrowserSpeechConstructor};
 return browser.SpeechRecognition||browser.webkitSpeechRecognition;
}
function mountBrowserStoryAudio(host:HTMLElement,options:StoryAudioOptions):StoryAudioHandle {
 const Recognition=browserSpeechConstructor(),available=typeof Recognition==='function'&&(typeof isSecureContext==='undefined'||isSecureContext);
 const root=document.createElement('section');root.className='story-audio';root.dataset.mode='browser';root.setAttribute('aria-label','Voice note');
 root.innerHTML=`<div class="story-audio-heading"><span aria-hidden="true">${audioIcon('microphone')}</span><div><h3>Tell it in your own voice</h3><p>Dictate a short note, then review the text.</p></div></div><div class="story-audio-actions"><button type="button" data-audio-record ${available?'':'disabled'}>${audioIcon('microphone')}<span>Dictate voice note</span></button><button type="button" data-audio-stop hidden>${audioIcon('stop')}<span data-audio-stop-label>Stop dictation</span></button><button type="button" data-audio-cancel hidden>${audioIcon('cancel')}<span>Cancel dictation</span></button><label>Spoken language <select data-audio-language><option value="en-US">English</option><option value="pt-BR">Portuguese</option><option value="browser">Browser language</option></select></label></div><p class="story-audio-status" data-audio-status role="status" aria-live="polite"></p><div class="story-audio-review" data-audio-review hidden><label>Review your words <textarea data-audio-text rows="4" maxlength="1200" placeholder="Edit the transcript before adding it."></textarea></label><div class="story-audio-actions"><button type="button" data-audio-use disabled>${audioIcon('check')}<span>Use transcript</span></button><button type="button" data-audio-clear>${audioIcon('clear')}<span>Clear text</span></button><span data-audio-count>0 / 1,200</span></div></div><small data-audio-privacy>Up to 60 seconds · 1,200 characters. Your browser may send speech to its recognition service. Audio is not added to the gift.</small><small data-audio-file-help>Audio-file transcription is not configured here. You can type or use your keyboard's dictation.</small>`;
 host.append(root);
 const element=<T extends HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 const record=element<HTMLButtonElement>('[data-audio-record]'),stopButton=element<HTMLButtonElement>('[data-audio-stop]'),cancel=element<HTMLButtonElement>('[data-audio-cancel]');
 const language=element<HTMLSelectElement>('[data-audio-language]'),review=element<HTMLElement>('[data-audio-review]'),text=element<HTMLTextAreaElement>('[data-audio-text]');
 const use=element<HTMLButtonElement>('[data-audio-use]'),clear=element<HTMLButtonElement>('[data-audio-clear]'),count=element<HTMLElement>('[data-audio-count]'),status=element<HTMLElement>('[data-audio-status]');
 const events=new AbortController();let dead=false,version=0,phase:StoryAudioPhase='idle',recognition:BrowserSpeechRecognition|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined,clock:ReturnType<typeof setInterval>|undefined,finalWords='',emittedText:string|undefined,startedAt=0;
 const active=()=>!dead&&options.isCurrent(),current=(attempt:number)=>active()&&attempt===version;
 const idleMessage=available?'Ready when you are. Your browser handles speech recognition.':'Browser speech recognition is unavailable. Type your story or use your keyboard’s dictation.';
 function clearTimers(){if(timer)clearTimeout(timer);if(clock)clearInterval(clock);timer=undefined;clock=undefined;}
 function releaseRecognition(){const target=recognition;recognition=undefined;if(!target)return;target.onstart=null;target.onresult=null;target.onerror=null;target.onend=null;try{target.abort();}catch{/* The browser may already have ended. */}}
 function render(message?:string){
  root.dataset.phase=phase;const working=['requesting','recording','transcribing'].includes(phase);
  record.disabled=!available||working;stopButton.hidden=!['requesting','recording'].includes(phase);cancel.hidden=!working;language.disabled=working;
  review.hidden=phase!=='review';use.disabled=phase!=='review'||!validReviewedTranscript(text.value)||emittedText===text.value.trim();clear.disabled=working;
  count.textContent=`${text.value.length} / 1,200`;if(message)status.textContent=message;
 }
 function stop(){version++;clearTimers();releaseRecognition();finalWords='';phase=text.value?'review':'idle';if(!dead)render(text.value?'Your words are still here to review or copy.':idleMessage);}
 function finish(attempt:number,message='Review the transcript. Edit any word before adding it.'){
  if(!current(attempt)){if(!dead&&attempt===version)stop();return;}version++;clearTimers();releaseRecognition();if(finalWords)text.value=finalWords;finalWords='';emittedText=undefined;phase=text.value?'review':'idle';render(text.value||message.startsWith('That result')?message:messages.AUDIO_NO_SPEECH);if(text.value)text.focus({preventScroll:true});
 }
 function finishDictation(){
  if(!active()) {stop();return;}if(phase==='requesting'){stop();return;}if(phase!=='recording'||!recognition)return;
  clearTimers();const attempt=version;phase='transcribing';render('Finishing dictation…');
  // stop() ends listening and lets the browser deliver its last final result.
  try{recognition.stop();if(current(attempt))timer=setTimeout(()=>finish(attempt),2000);}catch{finish(attempt);}
 }
 function start(){
  if(!active()||!available||!Recognition||['requesting','recording','transcribing'].includes(phase))return;
  stop();const attempt=version;finalWords='';phase='requesting';render('Allow microphone access for browser dictation.');
  try{
   const next=new Recognition();recognition=next;next.continuous=true;next.interimResults=true;next.maxAlternatives=1;
   const valid=()=>{if(current(attempt))return true;if(!dead&&attempt===version)stop();return false;};
   const browserLanguage=navigator.language;next.lang=language.value==='browser'?(typeof browserLanguage==='string'&&/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(browserLanguage)?browserLanguage:'en-US'):language.value==='pt-BR'?'pt-BR':'en-US';
   startedAt=Date.now();
   next.onstart=()=>{if(!valid())return;phase='recording';render('Listening… 0 / 60 seconds');clock=setInterval(()=>{if(valid())render(`Listening… ${Math.min(60,Math.floor((Date.now()-startedAt)/1000))} / 60 seconds`);},1000);};
   next.onresult=event=>{
    if(!valid())return;const words:string[]=[];
    for(let index=0;index<event.results.length;index++){const result=event.results[index];if(result?.isFinal&&typeof result[0]?.transcript==='string')words.push(result[0].transcript.trim());}
    const candidate=words.filter(Boolean).join(' ');if(candidate.length>MAX_CHARACTERS){finish(attempt,'That result was too long. Review the words already captured, or type your story.');return;}finalWords=candidate;
   };
   next.onend=()=>finish(attempt);
   next.onerror=event=>{
    if(!valid())return;const code=event.error,captured=finalWords;stop();if(captured){text.value=captured;phase='review';}
    render(code==='not-allowed'||code==='service-not-allowed'?'Microphone or speech-service access was blocked. Allow it in browser settings, or type your story.':code==='audio-capture'?'No microphone was found. Type your story or use keyboard dictation.':code==='no-speech'?messages.AUDIO_NO_SPEECH:code==='language-not-supported'?'This spoken language is unavailable. Choose another language or type your story.':code==='network'?'The browser’s speech service could not connect. Try again or type your story.':'Browser dictation could not finish. Try again or type your story.');
   };
   next.start();if(valid())timer=setTimeout(()=>{if(valid()){if(phase==='requesting'){stop();render('Microphone access did not finish. Try again or type your story.');}else finishDictation();}},60000);
  }catch{stop();render('Browser dictation could not start. Try again or type your story.');}
 }
 const on=(target:EventTarget,event:string,action:()=>void)=>target.addEventListener(event,action,{signal:events.signal});
 on(record,'click',start);on(stopButton,'click',finishDictation);on(cancel,'click',stop);on(clear,'click',()=>{stop();text.value='';emittedText=undefined;phase='idle';render(idleMessage);});on(text,'input',()=>render());
 on(use,'click',()=>{if(!active()||phase!=='review'||!validReviewedTranscript(text.value))return;const accepted=text.value.trim();if(accepted===emittedText)return;try{if(options.onTranscript(accepted)===false){render('The story is full. Shorten the story or this transcript, then try again.');return;}emittedText=accepted;render('Check your story to review the added words.');}catch{render('These words could not be added. Your transcript is still here to edit or copy.');}});
 on(document,'visibilitychange',()=>{if(document.visibilityState==='hidden')stop();});on(window,'pagehide',stop);render(idleMessage);
 return{stop,destroy(){if(dead)return;dead=true;events.abort();stop();text.value='';emittedText=undefined;root.remove();}};
}
function audioMime(blob: Blob): string { return blob.type.split(';')[0].trim().toLowerCase(); }
function uploadMime(file: File): string {
 const mime = audioMime(file); if (mime) return mime;
 const extensions: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', aac: 'audio/aac' };
 return extensions[file.name.split('.').pop()?.toLowerCase() || ''] || '';
}
function microphoneMessage(error: unknown): string {
 const name = error instanceof Error ? error.name : '';
 if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow it in browser settings, or upload a voice note.';
 if (name === 'NotFoundError') return 'No microphone was found. You can upload a voice note instead.';
 return 'The microphone could not start. Try again or upload a voice note.';
}
async function blobDataUrl(blob: Blob): Promise<string> {
 const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
 for (let start = 0; start < bytes.length; start += 16384) binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
 return `data:${audioMime(blob)};base64,${btoa(binary)}`;
}

/** Only an explicit reviewed action emits text; neither recording nor transcription changes the story. */
export function mountStoryAudio(host: HTMLElement, options: StoryAudioOptions): StoryAudioHandle {
 if(!storyAudioUsesLocalServer(window.location?.hostname||''))return mountBrowserStoryAudio(host,options);
 const root = document.createElement('section'); root.className = 'story-audio';
 root.setAttribute('aria-label', 'Voice note');
 root.innerHTML = `<div class="story-audio-heading"><span aria-hidden="true">${audioIcon('microphone')}</span><div><h3>Tell it in your own voice</h3><p>Record or upload a voice note. Review the text before adding it.</p></div></div><div class="story-audio-actions"><button type="button" data-audio-record disabled>${audioIcon('microphone')}<span>Record voice note</span></button><button type="button" data-audio-stop hidden>${audioIcon('stop')}<span data-audio-stop-label>Stop recording</span></button><button type="button" data-audio-upload disabled>${audioIcon('upload')}<span>Upload audio</span></button><input data-audio-file type="file" accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,audio/aac,.wav,.mp3,.m4a,.webm,.ogg" hidden/><label>Spoken language <select data-audio-language><option value="en">English</option><option value="pt">Portuguese</option><option value="auto">Auto-detect</option></select></label></div><p class="story-audio-status" data-audio-status role="status" aria-live="polite">Checking voice-note support…</p><div data-audio-preview hidden><audio data-audio-player controls preload="metadata"></audio><div class="story-audio-actions"><button type="button" data-audio-transcribe>${audioIcon('document')}<span>Transcribe voice note</span></button><button type="button" data-audio-clear>${audioIcon('clear')}<span>Clear audio</span></button><button type="button" data-audio-cancel hidden>${audioIcon('cancel')}<span>Cancel transcription</span></button></div></div><div class="story-audio-review" data-audio-review hidden><label>Review your words <textarea data-audio-text rows="4" maxlength="1200" placeholder="Edit the transcript before adding it."></textarea></label><div class="story-audio-actions"><button type="button" data-audio-use disabled>${audioIcon('check')}<span>Use transcript</span></button><span data-audio-count>0 / 1,200</span></div></div><small>Up to 60 seconds · 6 MB. Transcribed on this device. Audio is not included in the gift.</small>`;
 host.append(root);
 const element = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
 const record = element<HTMLButtonElement>('[data-audio-record]'), upload = element<HTMLButtonElement>('[data-audio-upload]');
 const stopButton = element<HTMLButtonElement>('[data-audio-stop]'), transcribe = element<HTMLButtonElement>('[data-audio-transcribe]');
 const stopLabel = element<HTMLElement>('[data-audio-stop-label]');
 const cancel = element<HTMLButtonElement>('[data-audio-cancel]'), clear = element<HTMLButtonElement>('[data-audio-clear]');
 const file = element<HTMLInputElement>('[data-audio-file]'), language = element<HTMLSelectElement>('[data-audio-language]');
 const player = element<HTMLAudioElement>('[data-audio-player]'), preview = element<HTMLElement>('[data-audio-preview]');
 const review = element<HTMLElement>('[data-audio-review]'), text = element<HTMLTextAreaElement>('[data-audio-text]');
 const use = element<HTMLButtonElement>('[data-audio-use]'), count = element<HTMLElement>('[data-audio-count]'), status = element<HTMLElement>('[data-audio-status]');
 const events = new AbortController(), statusRequest = new AbortController();
 let dead = false, version = 0, available = false, phase: StoryAudioPhase = 'idle';
 let audio: Blob | undefined, previewUrl: string | undefined, stream: MediaStream | undefined, recorder: MediaRecorder | undefined;
 let timer: ReturnType<typeof setTimeout> | undefined, clock: ReturnType<typeof setInterval> | undefined, request: AbortController | undefined;
 let parts: Blob[] = [], recordedBytes = 0, startedAt = 0, emittedText: string | undefined;
 const active = () => !dead && options.isCurrent();
 const current = (attempt: number) => active() && attempt === version;
 const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (typeof isSecureContext === 'undefined' || isSecureContext);
 function render(message?: string) {
  root.dataset.phase = phase;
  const working = phase === 'requesting' || phase === 'recording' || phase === 'transcribing';
  record.disabled = !available || working || !recordingSupported(); upload.disabled = !available || working;
  stopButton.hidden = phase !== 'requesting' && phase !== 'recording'; stopLabel.textContent = phase === 'requesting' ? 'Cancel microphone' : 'Stop recording';
  preview.hidden = !audio; transcribe.disabled = !available || !audio || working;
  clear.disabled = working; cancel.hidden = phase !== 'transcribing'; language.disabled = working;
  review.hidden = phase !== 'review'; use.disabled = phase !== 'review' || !validReviewedTranscript(text.value) || emittedText === text.value.trim();
  count.textContent = `${text.value.length} / 1,200`; if (message) status.textContent = message;
 }
 function releaseStream(target = stream) { if (!target) return; for (const track of target.getTracks()) track.stop(); if (target === stream) stream = undefined; }
 function clearTimers() { if (timer) clearTimeout(timer); if (clock) clearInterval(clock); timer = undefined; clock = undefined; }
 function stopRecorder() {
  clearTimers(); if (recorder) { recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; if (recorder.state !== 'inactive') { try { recorder.stop(); } catch {} } recorder = undefined; }
  releaseStream(); parts = []; recordedBytes = 0;
 }
 function clearAudio() {
  audio = undefined; player.pause(); player.removeAttribute('src'); player.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = undefined; file.value = '';
 }
 function stop() {
  version++; request?.abort(); request = undefined; stopRecorder(); clearAudio(); phase = text.value ? 'review' : 'idle';
  if (!dead) render(text.value ? 'Your transcript is still here to review or copy.' : available ? 'Record or upload a short voice note whenever you are ready.' : messages.AUDIO_UNAVAILABLE);
 }
 function discard() { stop(); text.value = ''; emittedText = undefined; phase = 'idle'; render(available ? 'Record or upload a short voice note.' : messages.AUDIO_UNAVAILABLE); }
 function installAudio(blob: Blob) {
  clearAudio(); audio = blob; previewUrl = URL.createObjectURL(blob); player.src = previewUrl; text.value = ''; emittedText = undefined; phase = 'ready';
  render('Listen to your voice note, then transcribe it.');
 }
 async function startRecording() {
  if (!active() || !available || ['requesting', 'recording', 'transcribing'].includes(phase)) return;
  discard(); const attempt = version; phase = 'requesting'; render('Allow microphone access to record your voice note.');
  if (!recordingSupported()) { phase = 'idle'; render('Recording needs microphone support on HTTPS or localhost. Upload an audio file instead.'); return; }
  try {
   const next = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
   if (!current(attempt)) { releaseStream(next); return; }
   stream = next;
   const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
   const nextRecorder = new MediaRecorder(next, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
   recorder = nextRecorder; parts = []; recordedBytes = 0;
   nextRecorder.ondataavailable = event => {
    if (!current(attempt) || !event.data.size) return;
    recordedBytes += event.data.size;
    if (recordedBytes > MAX_BYTES) { stop(); render(messages.AUDIO_SIZE_LIMIT); return; } parts.push(event.data);
   };
   nextRecorder.onerror = () => { if (current(attempt)) { stop(); render('This recording failed. Try again or upload a voice note.'); } };
   nextRecorder.onstop = () => {
    if (!current(attempt)) return;
    const blob = new Blob(parts, { type: nextRecorder.mimeType || parts[0]?.type || 'audio/webm' });
    recorder = undefined; clearTimers(); releaseStream(); parts = []; recordedBytes = 0;
    if (!blob.size) { phase = 'idle'; render('No audio was captured. Try again or upload a voice note.'); return; }
    installAudio(blob);
   };
   nextRecorder.start(1000); startedAt = Date.now(); phase = 'recording';
   clock = setInterval(() => { if (current(attempt)) render(`Recording… ${Math.floor((Date.now() - startedAt) / 1000)} / 60 seconds`); }, 1000);
   // Leave one second for encoder padding; decoded server duration remains authoritative.
   timer = setTimeout(() => { if (current(attempt)) finishRecording(); }, 59000);
   render('Recording… 0 / 60 seconds');
  } catch (error) { if (current(attempt)) { stopRecorder(); phase = 'idle'; render(microphoneMessage(error)); } }
 }
 function finishRecording() {
  if (phase === 'requesting') { stop(); return; }
  if (phase !== 'recording' || !recorder || recorder.state === 'inactive' || !active()) return;
  clearTimers(); stopButton.disabled = true;
  try { recorder.stop(); } catch { stop(); render('This recording could not finish. Try another voice note.'); }
  stopButton.disabled = false;
 }
 function chooseFile() {
  if (!active() || !available || phase === 'transcribing') return;
  const selected = file.files?.[0]; if (!selected) return;
  const mime = uploadMime(selected); discard();
  if (!types.includes(mime)) { render(messages.AUDIO_TYPE_INVALID); return; }
  if (!selected.size || selected.size > MAX_BYTES) { render(messages.AUDIO_SIZE_LIMIT); return; }
  installAudio(selected.type ? selected : new Blob([selected], { type: mime }));
 }
 async function transcribeAudio() {
  if (!active() || !available || !audio || phase === 'transcribing') return;
  const attempt = ++version, selected = audio; request = new AbortController(); const controller = request;
  phase = 'transcribing'; render('Transcribing your voice note…'); player.pause();
  try {
   const audioDataUrl = await blobDataUrl(selected); if (!current(attempt) || controller.signal.aborted) return;
   const response = await fetch('/api/story-audio?action=transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioDataUrl, language: language.value }), signal: controller.signal });
   const envelope = await response.json() as {ok?:boolean; data?:{text?:unknown}; error?:{code?:string}};
   if (!current(attempt) || controller.signal.aborted) return;
   if (!response.ok || envelope.ok !== true) throw new Error(envelope.error?.code || 'AUDIO_UNAVAILABLE');
   if (typeof envelope.data?.text !== 'string' || !validReviewedTranscript(envelope.data.text)) throw new Error('AUDIO_CONTENT_INVALID');
   text.value = envelope.data.text; phase = 'review'; render('Review the transcript. You can edit every word before adding it.'); text.focus({ preventScroll: true });
  } catch (error) {
   if (!current(attempt) || controller.signal.aborted) return;
   phase = 'ready'; const code = error instanceof Error ? error.message : ''; render(messages[code] || 'Transcription could not finish. Try again, or type your story.');
  } finally { if (request === controller) request = undefined; }
 }
 const on = (target: EventTarget, event: string, action: () => void) => target.addEventListener(event, action, { signal: events.signal });
 on(record, 'click', () => { void startRecording(); }); on(stopButton, 'click', finishRecording);
 on(upload, 'click', () => { if (active()) file.click(); }); on(file, 'change', chooseFile);
 on(clear, 'click', discard); on(cancel, 'click', stop); on(transcribe, 'click', () => { void transcribeAudio(); });
 on(text, 'input', () => render());
 on(use, 'click', () => {
  if (!active() || phase !== 'review' || !validReviewedTranscript(text.value)) return;
  const accepted = text.value.trim(); if (emittedText === accepted) return;
  try {
   const added = options.onTranscript(accepted);
   if (added === false) { render('The story is full. Shorten the story or this transcript, then try again.'); return; }
   emittedText = accepted; clearAudio(); render('Check your story to review the added words.');
  } catch { render('These words could not be added. Your transcript is still here to edit or copy.'); }
 });
 on(player, 'loadedmetadata', () => { if (active() && audio && Number.isFinite(player.duration) && player.duration > 60) { stop(); render(messages.AUDIO_DURATION_LIMIT); } });
 on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); });
 on(window, 'pagehide', stop);
 render();
 void fetch('/api/story-audio?action=status', { signal: statusRequest.signal }).then(async response => {
  const envelope = await response.json() as {ok?:boolean;data?:{available?:boolean;localOnly?:boolean}};
  if (dead) return; available = response.ok && envelope.ok === true && envelope.data?.available === true && envelope.data.localOnly === true;
  render(available ? (recordingSupported() ? 'Record or upload a short voice note.' : 'Upload a short voice note. Microphone recording is unavailable in this browser.') : messages.AUDIO_UNAVAILABLE);
 }).catch(() => { if (!dead) render(messages.AUDIO_UNAVAILABLE); });
 return { stop, destroy() { if (dead) return; dead = true; statusRequest.abort(); events.abort(); stop(); text.value = ''; emittedText = undefined; root.remove(); } };
}
