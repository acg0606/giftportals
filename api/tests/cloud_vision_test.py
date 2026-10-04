import copy
import hashlib
import http.client
import importlib.util
import json
import os
import sys
import threading
import unittest
from http.server import HTTPServer
from pathlib import Path

app=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('cloud_vision',app/'api/cloud-vision.py')
vision=importlib.util.module_from_spec(spec);spec.loader.exec_module(vision)
os.environ['SUPABASE_URL']='https://oqmzwznadfuxybtstzzz.supabase.co'
os.environ['GIFTPORTALS_CLOUD_MODERATION_KEY']='synthetic-offline-test-key-32-characters'
binary=b'\x89PNG\r\n\x1a\nsynthetic-unit-test-only'
item={'id':'world','mime':'image/png','bytes':len(binary),'sha256':hashlib.sha256(binary).hexdigest(),'imageUrl':os.environ['SUPABASE_URL']+'/storage/v1/object/sign/gp-instant-private/00000000-0000-4000-8000-000000000000/input/world-'+hashlib.sha256(binary).hexdigest()+'.png?token=synthetic-unit-only'}
payload={'protocol':vision.PROTOCOL,'images':[item]}
policy=json.loads(vision.POLICY_PATH.read_text(encoding='utf-8'))
def metrics(sexual=0,product=0):
    scores=[0.0]*len(policy['labels']);scores[0]=1-product;scores[next(i for i,label in enumerate(policy['labels']) if label[0]=='adult-product')]=product
    return {'sexual':sexual,'clipScores':scores}

class CloudVisionTests(unittest.TestCase):
    def test_policy_thresholds_preserve_real_screening_decisions(self):
        for sexual,product,expected in [(0,0,'allow'),(.15,0,'review'),(.4,0,'block'),(0,.08,'review'),(0,.35,'block')]:
            self.assertEqual(vision.decision(metrics(sexual,product),policy)['decision'],expected)

    def test_arbitrary_url_and_origin_spoofs_are_denied_before_download(self):
        for url in ['http://127.0.0.1/a','https://evil.supabase.co'+item['imageUrl'].split('.co',1)[1],item['imageUrl'].replace('/sign/','/public/'),item['imageUrl'].replace('https://','https://user:pass@'),item['imageUrl']+'&other=value',item['imageUrl'].replace('/input/','/../input/')]:
            with self.assertRaises(vision.VisionError):vision.validate_image({**item,'imageUrl':url})

    def test_exact_hash_and_limits_precede_classification(self):
        calls=[]
        with self.assertRaises(vision.VisionError):vision.process_payload(payload,downloader=lambda _:binary+b'x',infer=lambda *args:calls.append(args))
        with self.assertRaises(vision.VisionError):vision.process_payload({**payload,'images':[{**item,'bytes':vision.MAX_IMAGE+1}]})
        with self.assertRaises(vision.VisionError):vision.process_payload({**payload,'images':[item,item]})
        self.assertEqual(calls,[])
        report=vision.process_payload(payload,downloader=lambda _:binary,infer=lambda *args:metrics())
        self.assertEqual(report['results'][0]['sha256'],item['sha256']);self.assertEqual(report['decision'],'allow')

    def test_http_auth_and_body_limits_do_not_run_a_classifier(self):
        server=HTTPServer(('127.0.0.1',0),vision.handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            client.request('POST','/api/cloud-vision',json.dumps(payload),{'Content-Type':'application/json','Authorization':'Bearer wrong'})
            response=client.getresponse();self.assertEqual(response.status,403);self.assertEqual(json.loads(response.read())['error'],'MODERATION_FORBIDDEN');client.close()
        finally:server.shutdown();server.server_close();thread.join(timeout=5)

def real_http(reference,runtime):
    # Test transport substitutes only storage download; ONNX inference and the
    # versioned policy are the production code, with no approval substitutions.
    sys.path.insert(0,str(runtime))
    value=reference.read_bytes();mime='image/png' if value.startswith(b'\x89PNG') else 'image/jpeg' if value.startswith(b'\xff\xd8\xff') else 'image/webp';entry={**item,'mime':mime,'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest()}
    original=vision.process_payload
    vision.process_payload=lambda request:original(request,downloader=lambda _:value)
    server=HTTPServer(('127.0.0.1',0),vision.handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=90)
        client.request('POST','/api/cloud-vision',json.dumps({'protocol':vision.PROTOCOL,'images':[entry]}),{'Content-Type':'application/json','Authorization':'Bearer '+os.environ['GIFTPORTALS_CLOUD_MODERATION_KEY']})
        response=client.getresponse();report=json.loads(response.read());client.close()
        if response.status!=200 or report.get('decision')!='allow' or report['results'][0]['sha256']!=entry['sha256']:
            print(json.dumps({'httpStatus':response.status,'error':report.get('error'),'decision':report.get('decision')}))
            raise RuntimeError('REAL_HTTP_MODERATION_FAILED')
        print(json.dumps({'realInference':True,'httpStatus':response.status,'decision':report['decision'],'modelVersion':report['modelVersion'],'sha256':entry['sha256'],'scores':report['results'][0]['scores'],'providerRequests':0}))
    finally:server.shutdown();server.server_close();thread.join(timeout=5);vision.process_payload=original

if __name__=='__main__':
    if len(sys.argv)==4 and sys.argv[1]=='--real-http':real_http(Path(sys.argv[2]),Path(sys.argv[3]))
    else:unittest.main()
