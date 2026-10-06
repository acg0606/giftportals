-- Preserve immutable consent and complete safety evidence. Extra evaluator metadata does not invalidate an approved reference.
CREATE OR REPLACE FUNCTION public.gp_souvenir_reference_approved(j public.gp_instant_jobs) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(
  j.assets->'reference' IS NOT NULL
  AND j.document->'objectSafety'->>'protocol'='giftportals-cloud-vision-v1'
  AND j.document->'objectSafety'->>'decision'='allow'
  AND jsonb_typeof(j.document->'objectSafety'->'modelVersion')='string'
  AND length(j.document->'objectSafety'->>'modelVersion')>0
  AND CASE WHEN jsonb_typeof(j.document->'objectSafety'->'results')='array' THEN
   jsonb_array_length(j.document->'objectSafety'->'results')=1
   AND jsonb_typeof(j.document->'objectSafety'->'results'->0)='object'
   AND jsonb_build_object(
    'id',j.document->'objectSafety'->'results'->0->'id',
    'sha256',j.document->'objectSafety'->'results'->0->'sha256',
    'modelVersion',j.document->'objectSafety'->'results'->0->'modelVersion',
    'decision',j.document->'objectSafety'->'results'->0->'decision',
    'category',j.document->'objectSafety'->'results'->0->'category')
    = jsonb_build_object(
    'id','object','sha256',j.assets->'reference'->>'sha256',
    'modelVersion',j.document->'objectSafety'->>'modelVersion',
    'decision','allow','category','ordinary')
   ELSE false END,
  false)
$$;
