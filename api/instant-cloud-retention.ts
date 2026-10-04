import type { IncomingMessage,ServerResponse } from 'node:http';
import { AppError,ensure,secretMatches } from './_lib/rules.js';
import { collectCloudExpired } from './_lib/cloud-instant-retention.js';
import { createCloudRetentionRepository } from './_lib/cloud-instant-adapters.js';
export const config={maxDuration:60};
export default async function handler(req:IncomingMessage,res:ServerResponse){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{ensure(req.method==='GET'||req.method==='POST','METHOD_NOT_ALLOWED',405);ensure(secretMatches(req.headers.authorization,process.env.CRON_SECRET?`Bearer ${process.env.CRON_SECRET}`:undefined),'TICK_FORBIDDEN',403);const data=await collectCloudExpired(createCloudRetentionRepository(Date.now()+45000));res.statusCode=200;res.end(JSON.stringify({ok:true,data}));}
  catch(error){const safe=error instanceof AppError?error:new AppError('INSTANT_RETENTION_FAILED',500);res.statusCode=safe.status;res.end(JSON.stringify({ok:false,error:{code:safe.code,message:'The retention request could not be completed.'}}));}
}
