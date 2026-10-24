"""Audit live APIs with dedicated QA accounts; never print credentials or private profiles."""
import json, pathlib, urllib.request, urllib.error, uuid, time, concurrent.futures, sys

local = pathlib.Path(__file__).resolve().parent.parent / '.local'
base = 'https://pawletter-api-446222711695.asia-east1.run.app'
origins = ['https://pawletter-adoption-h5.chenaaron668.chatgpt.site', 'https://pawletter-preview.g1251020624.chatgpt.site']
report = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'checks': [], 'cleanup': []}
tokens = {}; pet = None; application = None

def call(path, body=None, role=None, origin=None, method=None, raw=None, mime=None, key=None):
    headers = {'Origin': origin or origins[0]}
    if role: headers['Authorization'] = 'Bearer ' + tokens[role]
    if key: headers['Idempotency-Key'] = key
    data = raw if raw is not None else None if body is None else json.dumps(body).encode()
    if data is not None: headers['Content-Type'] = mime or 'application/json'
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=75) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e: return e.code, json.load(e)

def record(name, status, detail=None):
    report['checks'].append({'name':name,'status':status, 'detail':detail})
    print(json.dumps(report['checks'][-1], ensure_ascii=True), flush=True)

def expected(name, response, status=200):
    code, body=response; record(name, 'pass' if code==status else 'fail', {'http':code,'error':body.get('error')})
    return body

try:
    if '--resume' not in sys.argv:
        expected('health',call('/health')); expected('database readiness',call('/ready'))
        pets=expected('public catalog',call('/v1/catalog')).get('pets',[])
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            facts=list(pool.map(lambda p:call('/v1/catalog/'+p['id']+'/facts'),pets))
        record('all public facts', 'pass' if all(c==200 for c,b in facts) else 'fail', {'pets':len(pets),'notes':sum(len(b.get('notes',[])) for c,b in facts)})
        for origin in origins:
            for path in ['/v1/onboarding/interview','/v1/onboarding/summary','/v1/auth/register']:
                # Empty payload should reach validation (400), never create an account or spend AI tokens.
                expected(origin+' '+path+' origin gate',call(path,{},origin=origin),400)
    accounts=json.loads((local/'pawletter-test-accounts.json').read_text(encoding='utf-8-sig'))['accounts']
    for role in ['station','adopter']:
        account=next(a for a in accounts if a['role']==role)
        data=expected(role+' login',call('/v1/auth/login',{'username':account['username'],'password':account['password']}))
        tokens[role]=data['token'];expected(role+' identity',call('/v1/me',role=role))
    profile_code,profile=call('/v1/adopter/profile',role='adopter')
    record('QA adopter cloud profile','pass' if profile_code==200 else 'blocked',{'http':profile_code,'error':profile.get('error')})
    expected('station applications',call('/v1/applications',role='station'))
    expected('adopter applications',call('/v1/applications',role='adopter'))
    expected('station followups',call('/v1/followups',role='station'))
    expected('adopter followups unavailable',call('/v1/followups',role='adopter'),403)
    for pet_id in ['example-pet-orange','example-pet-dog','example-pet-pancake']:
        expected(pet_id+' chat history',call('/v1/pets/'+pet_id+'/chat',role='adopter'))
        c,b=call('/v1/pets/'+pet_id+'/chat',{'question':'你有什么性格和日常习惯？领养后需要注意什么？'},role='adopter')
        record(pet_id+' live AI', 'pass' if c==200 and b.get('answer') else 'fail', {'http':c,'answerLength':len(b.get('answer','')),'citations':len(b.get('citations',[])),'error':b.get('error')})
    if profile_code==200:
        p={'species':'cat','internal':True,'description':'Internal adopter API audit; not for adoption.'}
        pet=expected('create isolated QA pet',call('/v1/pets',{'name':'联调·用户端审计','profile':p,'published':True},role='station'),201)['id']
        key=str(uuid.uuid4());body={'note':'Internal cross-role audit; cancel after verification.','memories':[],'shareProfile':True}
        application=expected('submit application',call('/v1/pets/'+pet+'/applications',body,role='adopter',key=key),201)
        repeat=expected('application idempotency',call('/v1/pets/'+pet+'/applications',body,role='adopter',key=key),201)
        record('same application on retry','pass' if repeat.get('id')==application['id'] else 'fail')
        station_apps=call('/v1/applications',role='station')[1]['applications']
        own=next((a for a in station_apps if a['id']==application['id']),None)
        record('station receives contact and lifestyle snapshot','pass' if own and all(own['snapshot'].get(k)==profile.get(k) for k in ['phone','wechat','lifestyle']) else 'fail')
        expected('adopter cannot advance station stage',call('/v1/applications/'+application['id']+'/stage',{'stage':1,'version':application['version']},role='adopter'),403)
        for stage in [1,2]:
            application=expected('station advances stage '+str(stage),call('/v1/applications/'+application['id']+'/stage',{'stage':stage,'version':application['version']},role='station'))
            rows=call('/v1/applications',role='adopter')[1]['applications']
            record('adopter API sees stage '+str(stage),'pass' if any(a['id']==application['id'] and a['stage']==stage for a in rows) else 'fail')
        if profile.get('verification')!='verified':
            c,b=call('/v1/applications/'+application['id']+'/stage',{'stage':3,'version':application['version']},role='station')
            record('handover blocked by pending identity','confirmed gap' if c==409 and b.get('error')=='IDENTITY_PENDING' else 'unexpected',{'http':c,'error':b.get('error')})
        history=call('/v1/pets/'+pet+'/chat',role='adopter')[1]
        record('stage notifications persisted to chat','pass' if len(history.get('messages',[]))>=3 else 'fail')
    else: record('live application stage flow','blocked','QA account has no adopter profile; browser registration is blocked; no personal account used')
    audio=local/'verification.wav'
    if audio.exists():
        c,b=call('/v1/onboarding/transcribe',raw=audio.read_bytes(),mime='audio/wav')
        record('real audio transcription','pass' if c==200 and b.get('text') else 'fail',{'http':c,'textLength':len(b.get('text','')),'error':b.get('error')})
except Exception as e:
    record('audit interrupted','fail',type(e).__name__)
finally:
    if application and application.get('id'):
        try:
            c,b=call('/v1/applications/'+application['id']+'/stage',{'stage':-1,'version':application['version']},role='adopter')
            report['cleanup'].append({'action':'cancel QA application','http':c})
        except Exception: report['cleanup'].append({'action':'cancel QA application','error':True})
    if pet:
        try:
            c,b=call('/v1/pets/'+pet+'/profile',{'name':'联调·审计已结束','profile':{'species':'cat','internal':True},'published':False},role='station')
            report['cleanup'].append({'action':'hide QA pet','http':c})
        except Exception:report['cleanup'].append({'action':'hide QA pet','error':True})
    for role in list(tokens):
        try: report['cleanup'].append({'action':role+' logout','http':call('/v1/auth/logout',{},role=role)[0]})
        except Exception:report['cleanup'].append({'action':role+' logout','error':True})
    (local/('adopter-audit-live-resumed.json' if '--resume' in sys.argv else 'adopter-audit-live.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'cleanup':report['cleanup'],'checks':len(report['checks'])}),flush=True)
