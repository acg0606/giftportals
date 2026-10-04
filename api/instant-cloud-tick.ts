import { randomUUID } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { AppError,ensure,secretMatches } from './_lib/rules.js';
import { cloudInstantService } from './instant-cloud.js';
export const config={maxDuration:180};
export function createCloudTickHandler(service?:ReturnType<typeof cloudInstantService>){return async(req:IncomingMessage,res:ServerResponse)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{ensure(req.method==='GET'||req.method==='POST','METHOD_NOT_ALLOWED',405);ensure(secretMatches(req.headers.authorization,process.env.CRON_SECRET?`Bearer ${process.env.CRON_SECRET}`:undefined),'TICK_FORBIDDEN',403);const data=await (service||cloudInstantService(Date.now()+165000)).tick(randomUUID());res.statusCode=200;res.end(JSON.stringify({ok:true,data}));}
  catch(error){const safe=error instanceof AppError?error:new AppError('CLOUD_WORKER_FAILED',500);res.statusCode=safe.status;res.end(JSON.stringify({ok:false,error:{code:safe.code,message:'The worker request could not be completed.'}}));}
};}
export default createCloudTickHandler();
