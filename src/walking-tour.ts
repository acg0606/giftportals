import type { createFirstPersonPhysics } from './first-person-physics';

type Controller = Awaited<ReturnType<typeof createFirstPersonPhysics>>;
export type WalkingTourPosition = readonly [number, number, number];
export interface WalkingTourChapter { title: string; note: string; path: readonly WalkingTourPosition[]; yaw: number; fov: number; dwellMs: number }
export interface WalkingTourPlan { chapters: readonly WalkingTourChapter[]; estimatedDurationMs: number; distance: number }
export interface WalkingTourState { available: boolean; phase: 'idle'|'playing'|'paused'|'completed'; index: number; count: number; title?: string; note?: string; stage?: 'turning'|'walking'|'observing'; reason?: 'user'|'manual'|'hidden'|'offscreen'|'motion'|'blocked'; estimatedDurationMs: number; reducedMotion: boolean }
const distance=(a:WalkingTourPosition,b:WalkingTourPosition)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const copy=(p:WalkingTourPosition):[number,number,number]=>[...p];
const finite=(p:WalkingTourPosition)=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const SPEED=.55;
const TURN_SPEED=.8,TURN_START=.6,TURN_END=.1,LOOK_AHEAD=.6;
const angle=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

/** The eye follows the planned polyline tangent, never the tiny lateral
 * correction between the capsule and its next navigation waypoint. Average
 * several real segments, stopping before a sharp corner rather than looking
 * across it. Collision still resolves every original waypoint independently. */
function routeHeadings(chapter:WalkingTourChapter):number[]{
 const path=chapter.path;
 return path.map((_,index)=>{
  const start=Math.max(0,index-1),origin=path[start];let end=start,length=0,base:number|undefined;
  for(let i=start+1;i<path.length;i++){
   const dx=path[i][0]-path[i-1][0],dz=path[i][2]-path[i-1][2],segment=Math.hypot(dx,dz);
   if(segment<.0001)continue;
   const heading=Math.atan2(-dx,-dz);base??=heading;
   if(Math.abs(angle(heading,base))>Math.PI/6)break;
   end=i;length+=segment;if(length>=LOOK_AHEAD)break;
  }
  return end>start?Math.atan2(origin[0]-path[end][0],origin[2]-path[end][2]):chapter.yaw;
 });
}

/** Resolve the near-180-degree ambiguity in one consistent direction. The
 * returned yaw is unwrapped around the current eye and the renderer must use
 * its direct difference, so numerical capsule noise cannot reverse a turn. */
function lookYaw(heading:number,currentYaw:number):number{
 let delta=angle(heading,currentYaw);
 if(Math.abs(delta)>Math.PI-.04)delta=Math.abs(delta);
 return currentYaw+delta;
}

function alignmentDuration(chapters:readonly WalkingTourChapter[]):number{
 let previous=chapters[0].yaw,total=0;
 for(const chapter of chapters){
  for(const heading of [...routeHeadings(chapter),chapter.yaw]){
   const change=Math.abs(angle(heading,previous));
   if(change>TURN_START){total+=(change-TURN_END)/TURN_SPEED;previous=heading;}
  }
 }
 return Math.round(total*1000);
}

/** Discover continuous corridors using the world's own grounded capsule.
 * Each return is replayed before publishing it. The bounded search is restored
 * before rendering; rejected terrain never receives an invented camera path. */
export function deriveWalkingTour(controller: Controller, initialYaw=0): WalkingTourPlan | undefined {
 const yaw=Number.isFinite(initialYaw)?initialYaw:0,arrival=copy(controller.reset()),paths: {path:WalkingTourPosition[];yaw:number}[]=[];
 if(!finite(arrival))return;
 try {
  for(const heading of[yaw,yaw-Math.PI/4,yaw+Math.PI/4,yaw-Math.PI/2,yaw+Math.PI/2]){
   let position=copy(controller.reset());const path:WalkingTourPosition[]=[copy(position)];
   for(let i=0;i<150;i++){
    const next=controller.advance(position,[-Math.sin(heading)*.04,0,-Math.cos(heading)*.04],1/60);
    if(!next.grounded||!finite(next.position)||distance(next.position,arrival)>6.05||Math.abs(next.position[1]-position[1])>.25)break;
    const moved=distance(next.position,position);if(moved<.004)break;position=copy(next.position);path.push(copy(position));
   }
   if(path.length<2||distance(path.at(-1)!,arrival)<1.2||paths.some(other=>distance(other.path.at(-1)!,path.at(-1)!)<1.2))continue;
   // Test return continuity at the same small steps rather than assuming a
   // reversed line can cross a ledge that was safe only in one direction.
   let safe=true;
   for(let i=path.length-2;i>=0;i--){const target=path[i],next=controller.advance(position,[target[0]-position[0],0,target[2]-position[2]],1/60);if(!next.grounded||!finite(next.position)||distance(next.position,target)>.08){safe=false;break;}position=copy(next.position);}
   if(!safe||distance(position,arrival)>.08)continue;
   paths.push({path,yaw:heading});if(paths.length===2)break;
  }
 } finally { controller.reset(); }
 if(!paths.length)return;
 const first=paths[0],second=paths[1],reverse=(path:readonly WalkingTourPosition[])=>path.slice().reverse().map(copy);
 const chapters:WalkingTourChapter[]=[
  {title:'Take in the place',note:'Look around before following the path.',path:[copy(arrival)],yaw,fov:75,dwellMs:12000},
  {title:'Into the scene',note:'A slow approach through the space around you.',path:first.path.map(copy),yaw:first.yaw,fov:72,dwellMs:9000},
  {title:'A closer look',note:'Stay here and notice the textures, light and depth.',path:[copy(first.path.at(-1)!)],yaw:first.yaw,fov:58,dwellMs:18000},
 ];
 if(second)chapters.push(
  {title:'Another perspective',note:'Follow a connected path to see the same place differently.',path:[...reverse(first.path),...second.path.slice(1).map(copy)],yaw:second.yaw,fov:70,dwellMs:10000},
  {title:'Stay a little',note:'Take your time with the details around this view.',path:[copy(second.path.at(-1)!)],yaw:second.yaw+.12,fov:58,dwellMs:18000},
 );
 chapters.push({title:'Back at the beginning',note:'Your memory remains here. Continue walking or return to your gift.',path:reverse((second??first).path),yaw,fov:75,dwellMs:12000});
 const total=chapters.reduce((sum,chapter)=>sum+chapter.path.reduce((length,point,i)=>length+(i?distance(chapter.path[i-1],point):0),0),0);
 return {chapters,estimatedDurationMs:Math.round(total/SPEED*1000)+chapters.reduce((sum,chapter)=>sum+chapter.dwellMs,0)+alignmentDuration(chapters),distance:total};
}

/** Runtime navigation never interpolates camera positions through a collider.
 * Every translated frame is resolved by the same live physics controller.
 * Next skips a dwell, but finishes the audited corridor before changing it. */
export function createWalkingTourSession(plan:WalkingTourPlan,reducedMotion=false){
 let phase:WalkingTourState['phase']=reducedMotion?'paused':'playing',reason:WalkingTourState['reason']=reducedMotion?'motion':undefined,index=0,waypoint=0,dwell=0,blocked=0,skipDwell=false,turning=false,virtualYaw=plan.chapters[0].yaw;
 const headings=plan.chapters.map(routeHeadings);
 const state=():WalkingTourState=>({available:true,phase,index,count:plan.chapters.length,title:plan.chapters[index]?.title,note:plan.chapters[index]?.note,stage:turning?'turning':waypoint<plan.chapters[index]?.path.length?'walking':'observing',reason,estimatedDurationMs:plan.estimatedDurationMs,reducedMotion});
 const nextChapter=()=>{if(index+1<plan.chapters.length){index++;waypoint=0;dwell=0;blocked=0;skipDwell=false;turning=false;}else{phase='completed';reason=undefined;turning=false;}};
 return {
  state,
  pause(value:WalkingTourState['reason']='user'){if(phase==='playing'||phase==='paused'&&value==='blocked'){phase='paused';reason=value;}},
  resume(){if(phase!=='paused'||reducedMotion||reason==='blocked')return false;phase='playing';reason=undefined;blocked=0;return true;},
  motion(value:boolean){reducedMotion=value;if(value&&phase==='playing'){phase='paused';reason='motion';}},
  next(){if(phase==='idle'||phase==='completed')return;skipDwell=true;if(waypoint>=plan.chapters[index].path.length)nextChapter();},
  staticNext(){if(!reducedMotion||phase==='completed')return;nextChapter();const chapter=plan.chapters[index];waypoint=chapter.path.length;virtualYaw=chapter.yaw;return {position:copy(chapter.path.at(-1)!),yaw:chapter.yaw,fov:chapter.fov};},
  stop(){phase='idle';reason=undefined;turning=false;},
  step(elapsedMs:number,position:WalkingTourPosition,advance:Controller['advance'],currentYaw?:number){
   const chapter=plan.chapters[index];if(phase!=='playing'||reducedMotion||!finite(position))return {position:copy(position),yaw:Number.isFinite(currentYaw)?currentYaw!:virtualYaw,fov:chapter.fov,moving:false,turning:false};
   const elapsed=Math.max(0,Math.min(60000,Number.isFinite(elapsedMs)?elapsedMs:0)),dt=Math.min(100,elapsed)/1000;
   let current=copy(position),moving=false;
   while(waypoint<chapter.path.length&&distance(current,chapter.path[waypoint])<.025)waypoint++;
   const heading=waypoint<chapter.path.length?headings[index][waypoint]:chapter.yaw;
   // Older three-argument consumers follow the same rate with a virtual eye.
   // Renderers pass their actual yaw so drag/resume and slow frames stay exact.
   const eyeYaw=typeof currentYaw==='number'&&Number.isFinite(currentYaw)?currentYaw:virtualYaw;
   const desiredYaw=lookYaw(heading,eyeYaw),difference=Math.abs(desiredYaw-eyeYaw),turn=TURN_SPEED*dt;
   virtualYaw=eyeYaw+Math.max(-turn,Math.min(turn,desiredYaw-eyeYaw));
   turning=difference>(turning?TURN_END:TURN_START);
   if(turning)return {position:current,yaw:desiredYaw,fov:chapter.fov,moving:false,turning:true};
   if(waypoint>=chapter.path.length){dwell+=elapsed;if(skipDwell||dwell>=chapter.dwellMs)nextChapter();}
   else if(dt){
    // Spend the bounded frame budget across multiple small real capsule steps.
    // A 40-mm waypoint must not cap a 100-ms frame to 0.4 units/second. Stop at
    // sharp corners so the following frame can align before changing course.
    let remaining=SPEED*dt;
    for(let steps=0;steps<16&&remaining>.0001&&phase==='playing';steps++){
     while(waypoint<chapter.path.length&&distance(current,chapter.path[waypoint])<.025)waypoint++;
     if(waypoint>=chapter.path.length||Math.abs(angle(headings[index][waypoint],heading))>Math.PI/6)break;
     const target=chapter.path[waypoint],dx=target[0]-current[0],dz=target[2]-current[2],length=Math.hypot(dx,dz),amount=Math.min(length,remaining,SPEED/60),seconds=amount/SPEED;
     const next=advance(current,[dx/length*amount,0,dz/length*amount],seconds);
     if(!next.grounded||!finite(next.position)||Math.abs(next.position[1]-position[1])>.25||distance(next.position,current)>amount+.02||distance(next.position,position)>SPEED*dt+.025){phase='paused';reason='blocked';break;}
     const progressed=distance(next.position,current);current=copy(next.position);moving||=progressed>.0001;remaining-=Math.max(amount,progressed);
     blocked=progressed<amount*.1?blocked+seconds:0;if(blocked>1.2){phase='paused';reason='blocked';}
    }
   }
   return {position:current,yaw:desiredYaw,fov:chapter.fov,moving,turning:false};
  },
 };
}
