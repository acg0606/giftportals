import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError,ensure,knownDatabaseError } from './rules.js';
export type Row = Record<string,any>;
export function cloudConfigured(){return Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY);}
export function cloud(token?:string):SupabaseClient {
 ensure(cloudConfigured(),'CLOUD_NOT_CONFIGURED',503,'Cloud storage is not configured yet.');
 return createClient(process.env.SUPABASE_URL!,token?process.env.SUPABASE_ANON_KEY!:process.env.SUPABASE_SERVICE_ROLE_KEY!,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{headers:token?{Authorization:`Bearer ${token}`}:{},fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})},
 });
}
export function unwrap<T>(result:{data:T|null,error:{message?:string}|null}):T {
 if(result.error)throw new AppError(knownDatabaseError(result.error.message),400);
 ensure(result.data!==null,'RESOURCE_UNAVAILABLE',404);return result.data;
}
export async function authContext(authorization:unknown){
 ensure(typeof authorization==='string'&&authorization.startsWith('Bearer '),'SIGN_IN_REQUIRED',401,'Please sign in to continue.');
 const token=authorization.slice(7);ensure(token.length<8192,'INVALID_SESSION',401);
 const service=cloud();const {data,error}=await service.auth.getUser(token);
 ensure(!error&&data.user,'INVALID_SESSION',401,'Your session has expired. Please sign in again.');
 const profile=unwrap(await service.from('gp_profiles').select('id,display_name,is_demo').eq('id',data.user.id).single()) as Row;
 return {service,client:cloud(token),token,user:data.user,profile};
}
