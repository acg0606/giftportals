export interface ViewerProgress { phase:'loading'|'decoding'; loadedBytes:number; totalBytes:number|null }
export const VIEWER_BYTE_LIMIT=25*1024*1024;
export const VIEWER_LOAD_TIMEOUT=45000;
export function viewerAssetUrl(value:string,origin:string):URL {
  let url:URL;try{url=new URL(value,origin);}catch{throw new Error('VIEWER_URL_INVALID');}
  if(url.username||url.password||(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.origin===origin)))throw new Error('VIEWER_URL_INVALID');
  return url;
}
export function viewerPixelRatio(kind:'gift'|'place',density:number,width:number){
  const mobile=width<=640,cap=kind==='gift'?(mobile?1.25:1.5):(mobile?1:1.25);
  return Math.min(Number.isFinite(density)&&density>0?density:1,cap);
}
export interface FrameDriver { request(callback:FrameRequestCallback):number; cancel(id:number):void }
export function createFrameGate(draw:FrameRequestCallback,driver:FrameDriver={request:callback=>globalThis.requestAnimationFrame(callback),cancel:id=>globalThis.cancelAnimationFrame(id)}){
  let alive=true,visible=true,hidden=false,pending:number|null=null,generation=0;
  const stop=()=>{if(pending!==null){generation++;driver.cancel(pending);pending=null;}};
  const request=()=>{if(!alive||!visible||hidden||pending!==null)return;const current=++generation;pending=driver.request((now)=>{if(current!==generation)return;pending=null;if(alive&&visible&&!hidden)draw(now);});};
  return{
    request,
    setVisible(value:boolean){visible=value;if(!visible)stop();else request();},
    setHidden(value:boolean){hidden=value;if(hidden)stop();else request();},
    destroy(){alive=false;stop();},
  };
}
export function observeViewerVisibility(host:HTMLElement,gate:ReturnType<typeof createFrameGate>){
  const rect=host.getBoundingClientRect();gate.setVisible(rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth);
  const visibility=()=>gate.setHidden(document.visibilityState==='hidden');visibility();document.addEventListener('visibilitychange',visibility);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries)if(entry.target===host)gate.setVisible(entry.isIntersecting&&entry.intersectionRatio>0);}):null;
  observer?.observe(host);return()=>{observer?.disconnect();document.removeEventListener('visibilitychange',visibility);};
}
export async function fetchViewerBytes(url:string,signal:AbortSignal,onProgress?:(state:ViewerProgress)=>void,byteLimit=VIEWER_BYTE_LIMIT):Promise<Uint8Array<ArrayBuffer>>{
  signal.throwIfAborted();
  const limit=Number.isFinite(byteLimit)?Math.max(VIEWER_BYTE_LIMIT,Math.min(50*1024*1024,Math.floor(byteLimit))):VIEWER_BYTE_LIMIT;
  const response=await fetch(url,{signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
  if(!response.ok||!response.body)throw new Error('VIEWER_DOWNLOAD_FAILED');
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>limit){await response.body.cancel();throw new Error('VIEWER_ASSET_TOO_LARGE');}
  const encoded=response.headers.get('content-encoding');
  const totalBytes=Number.isFinite(declared)&&declared>0&&(!encoded||encoded==='identity')?declared:null;
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let loadedBytes=0;
  onProgress?.({phase:'loading',loadedBytes,totalBytes});
  try{
    for(;;){signal.throwIfAborted();const next=await reader.read();if(next.done)break;signal.throwIfAborted();loadedBytes+=next.value.byteLength;if(loadedBytes>limit)throw new Error('VIEWER_ASSET_TOO_LARGE');chunks.push(next.value);onProgress?.({phase:'loading',loadedBytes,totalBytes});}
    signal.throwIfAborted();if(!loadedBytes)throw new Error('VIEWER_ASSET_EMPTY');
    const output=new Uint8Array(loadedBytes);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}
    onProgress?.({phase:'decoding',loadedBytes,totalBytes});return output;
  }catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
}
