-- Read-only regression cases against the owner-published Seoul gift. Every case is built in memory; no gift is changed.
WITH b AS (SELECT to_jsonb(j) AS row,j.document AS doc,j.assets AS assets FROM public.gp_instant_jobs j WHERE id='4a4b0f0e-30e3-4d38-af76-6e96d7bda29f'),variants AS (SELECT 'approved_with_scores' AS name,true AS expected,row AS row FROM b
 UNION ALL SELECT 'no_reference' AS name,false AS expected,row || jsonb_build_object('assets',assets-'reference') AS row FROM b
 UNION ALL SELECT 'bad_protocol' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,protocol}','"other"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'report_denied' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,decision}','"block"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'empty_model' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,modelVersion}','""'::jsonb)) AS row FROM b
 UNION ALL SELECT 'non_string_model' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,modelVersion}','123'::jsonb)) AS row FROM b
 UNION ALL SELECT 'zero_results' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results}','[]'::jsonb)) AS row FROM b
 UNION ALL SELECT 'two_results' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results}',((doc->'objectSafety'->'results')||(doc->'objectSafety'->'results')))) AS row FROM b
 UNION ALL SELECT 'object_results' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results}','{}'::jsonb)) AS row FROM b
 UNION ALL SELECT 'string_results' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results}','"bad"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'null_results' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results}','null'::jsonb)) AS row FROM b
 UNION ALL SELECT 'non_object_result' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results}','["bad"]'::jsonb)) AS row FROM b
 UNION ALL SELECT 'bad_id' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,id}','"original"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'array_id' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,id}','["object"]'::jsonb)) AS row FROM b
 UNION ALL SELECT 'bad_hash' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,sha256}','"bad"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'array_hash' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,sha256}',(jsonb_build_array(doc->'objectSafety'->'results'->0->'sha256')))) AS row FROM b
 UNION ALL SELECT 'bad_result_model' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,modelVersion}','"other"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'bad_decision' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,decision}','"block"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'array_decision' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,decision}','["allow"]'::jsonb)) AS row FROM b
 UNION ALL SELECT 'bad_category' AS name,false AS expected,row || jsonb_build_object('document',jsonb_set(doc,'{objectSafety,results,0,category}','"sensitive"'::jsonb)) AS row FROM b
 UNION ALL SELECT 'missing_category' AS name,false AS expected,row || jsonb_build_object('document',doc#-'{objectSafety,results,0,category}') AS row FROM b), checked AS (SELECT v.name,v.expected,public.gp_souvenir_reference_approved(j) AS actual FROM variants v CROSS JOIN LATERAL jsonb_populate_record(NULL::public.gp_instant_jobs,v.row) j) SELECT jsonb_build_object('tests',jsonb_agg(to_jsonb(checked) ORDER BY name),'passed',bool_and(actual=expected)) FROM checked;
