import { ensure,uuid } from './rules.js';
export interface CloudRetentionRepository {
  expired(limit:number):Promise<{id:string;prefix:string}[]>;
  list(bucket:string,prefix:string):Promise<{name:string}[]>;
  remove(bucket:string,paths:string[]):Promise<void>;
  purge(id:string):Promise<void>;
}
/** Quarantine and generated buckets are dedicated; never delete a computed parent prefix. */
export async function collectCloudExpired(repo:CloudRetentionRepository,limit=4){
  ensure(Number.isInteger(limit)&&limit>=1&&limit<=4,'INSTANT_INPUT_INVALID');
  const jobs=await repo.expired(limit);ensure(Array.isArray(jobs)&&jobs.length<=limit,'INSTANT_RETENTION_INVALID',502);let purged=0;
  for(const job of jobs){
    const id=uuid(job.id);ensure(job.prefix===`${id}/`,'INSTANT_RETENTION_INVALID',502);
    for(const[bucket,folder]of[['gp-instant-private','input'],['gp-instant-private','moderation'],['gp-instant-generated','generated']] as const){
      const prefix=`${id}/${folder}`,objects=await repo.list(bucket,prefix);ensure(Array.isArray(objects)&&objects.length<=100,'INSTANT_RETENTION_INVALID',502);
      const allowed=folder==='input'?/^(?:original|object|world)-[a-f0-9]{64}\.(?:jpg|png|webp)$/:folder==='moderation'?/^[a-f0-9]{64}\.(?:jpg|png|webp)$/:/^[a-f0-9]{64}\.(?:jpg|png|webp|glb|spz)$/;
      ensure(objects.every(object=>object&&typeof object.name==='string'&&allowed.test(object.name)),'INSTANT_RETENTION_INVALID',502);
      if(objects.length)await repo.remove(bucket,objects.map(object=>`${prefix}/${object.name}`));
      ensure((await repo.list(bucket,prefix)).length===0,'INSTANT_RETENTION_INCOMPLETE',502);
    }
    // Storage reservation is released only after all three scoped prefixes are empty.
    await repo.purge(id);purged++;
  }
  return {processed:jobs.length,purged};
}
