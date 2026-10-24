"""Explicit QA audit; no credentials or personal records are emitted.

Default is read-only (apart from login/logout). --exercise creates one private
internal QA pet and withdraws its observations and hides it in finally.
--ai additionally uses the configured service for bounded AI/ASR checks.
"""
import argparse, base64, collections, datetime, json, pathlib, secrets, time, urllib.error, urllib.request, uuid

p = argparse.ArgumentParser()
p.add_argument('--exercise', action='store_true')
p.add_argument('--ai', action='store_true')
p.add_argument('--register', action='store_true', help='Create a dedicated QA adopter through normal registration and test application notifications')
p.add_argument('--flow', action='store_true', help='Verify application stages and read receipts with the saved QA adopter')
args = p.parse_args()
local = pathlib.Path(__file__).resolve().parent.parent / '.local'
base = 'https://pawletter-api-446222711695.asia-east1.run.app'
origins = ['https://pawletter-adoption-h5.chenaaron668.chatgpt.site', 'https://pawletter-preview.g1251020624.chatgpt.site']
report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'checks': [], 'cleanup': []}
tokens, observation_ids = {}, []
pet_id = None
application = None

def request(path, body=None, role=None, origin=None, method=None, raw=None, mime=None, key=None):
    headers = {'Origin': origin or origins[0]}
    if role: headers['Authorization'] = 'Bearer ' + tokens[role]
    if key: headers['Idempotency-Key'] = key
    data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
    if data is not None: headers['Content-Type'] = mime or 'application/json'
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=75) as r:
            content = r.read()
            result = json.loads(content) if 'json' in r.headers.get('Content-Type', '') else {'bytes': len(content)}
            return r.status, result
    except urllib.error.HTTPError as e:
        try: result = json.load(e)
        except Exception: result = {}
        return e.code, result
    except Exception as e: return 0, {'error': type(e).__name__}

def check(name, response, expected=200, predicate=None, detail=None):
    code, body = response
    ok = code == expected and (predicate(body) if predicate and code == expected else True)
    row = {'name': name, 'result': 'pass' if ok else 'fail', 'http': code, 'expected': expected}
    if body.get('error'): row['error'] = body['error']
    if detail: row.update(detail(body) if callable(detail) else detail)
    report['checks'].append(row)
    print(json.dumps(row, ensure_ascii=True), flush=True)
    return body

try:
    check('health', request('/health'))
    check('readiness', request('/ready'))
    catalog = check('public catalog', request('/v1/catalog')).get('pets', [])
    counts = collections.Counter()
    for pet in catalog:
        code, facts = request('/v1/catalog/' + pet['id'] + '/facts')
        counts[str(code)] += 1; counts['notes'] += len(facts.get('notes', []))
    check('all catalog facts', (200 if counts['200'] == len(catalog) and catalog else 0, {}), detail={'pets': len(catalog), 'counts': dict(counts)})
    for origin in origins:
        for route in ['interview', 'summary', 'register']:
            path = '/v1/auth/register' if route == 'register' else '/v1/onboarding/' + route
            check(origin + ' ' + route + ' validation gate', request(path, {}, origin=origin), 400)
    for route in ['interview', 'summary']:
        check('untrusted origin ' + route, request('/v1/onboarding/' + route, {}, origin='https://untrusted.invalid'), 403)
    accounts = json.loads((local/'pawletter-test-accounts.json').read_text(encoding='utf-8-sig'))['accounts']
    if args.register:
        answers={'work':{'text':'周一到周五朝九晚六，晚上在家','value':'long'},'routine':{'text':'每天作息规律','value':'regular'},'free':{'text':'每天能陪伴一小时','value':'one2'},'expectation':{'text':'喜欢安静陪伴的成年猫','value':'quiet'}}
        check('real onboarding interview',request('/v1/onboarding/interview',{'key':'work','text':answers['work']['text']},origin=origins[1]),predicate=lambda b:b.get('understood') is True)
        analysis=check('real onboarding summary',request('/v1/onboarding/summary',answers,origin=origins[1]),predicate=lambda b:bool(b.get('summary')))
        account={'role':'adopter','username':'qa-main-'+uuid.uuid4().hex[:10],'password':secrets.token_urlsafe(24)}
        body={**{k:account[k] for k in ['username','password']},'nickname':'联调QA','realName':'测试数据','phone':'00000000000','wechat':'qa-only','email':'qa@example.invalid','privacy':True,'covenant':True,'lifestyle':{'answers':answers,'analysis':analysis}}
        registered=check('normal QA registration',request('/v1/auth/register',body,origin=origins[1],key=str(uuid.uuid4())),201,predicate=lambda b:bool(b.get('token')))
        if registered.get('token'):
            tokens['fresh']=registered['token'];check('registration session logout',request('/v1/auth/logout',{},'fresh'));del tokens['fresh']
            (local/'main-recovery-qa.json').write_text(json.dumps(account),encoding='utf-8')
            accounts=[a for a in accounts if a['role']!='adopter']+[account]
    elif (local/'main-recovery-qa.json').exists():
        accounts=[a for a in accounts if a['role']!='adopter']+[json.loads((local/'main-recovery-qa.json').read_text())]
    for role in ['station', 'adopter']:
        account = next(a for a in accounts if a['role'] == role)
        login = check(role + ' login', request('/v1/auth/login', {'username': account['username'], 'password': account['password']}))
        if login.get('token'):
            tokens[role] = login['token']
            check(role + ' me', request('/v1/me', role=role), detail=lambda b: {'hasCrossStationFlag': 'canReadAllStations' in b})
            check(role + ' applications', request('/v1/applications', role=role))
    if 'adopter' in tokens:
        check('QA adopter profile', request('/v1/adopter/profile', role='adopter'))
        check('adopter followups unavailable (known scope gap)', request('/v1/followups', role='adopter'), 403)
    if 'station' in tokens:
        check('main station workspace dependency /stations', request('/v1/stations', role='station'))
        check('station followups', request('/v1/followups', role='station'))
        pets = check('station pets', request('/v1/pets', role='station')).get('pets', [])
        if pets:
            pid = pets[0]['id']
            for suffix in ['', '/agent', '/knowledge', '/observations?status=all&order=desc', '/intake']:
                check('station read pet ' + (suffix or 'profile'), request('/v1/pets/' + pid + suffix, role='station'))
        # New fields must be understood before EMPTY_INTAKE; old server rejects them at schema validation.
        check('new guided intake contract', request('/v1/intake/analyze', {'text':'','images':[],'confirmedFields':{},'latestText':'','declined':[]}, 'station'), 400, lambda b: b.get('error') == 'EMPTY_INTAKE')
    if args.exercise and 'station' in tokens:
        profile = {'species':'cat','internal':True,'description':'Isolated main integration audit.'}
        created = check('create private QA pet', request('/v1/pets', {'name':'联调·main审计','profile':profile,'published':False}, 'station'), 201)
        pet_id = created.get('id')
        if pet_id:
            check('update QA pet profile', request('/v1/pets/'+pet_id+'/profile', {'name':'联调·main审计已更新','profile':profile,'published':False}, 'station'))
            check('update QA voice', request('/v1/pets/'+pet_id+'/agent', {'tone':'calm','style':'简短安静'}, 'station'))
            check('read QA voice', request('/v1/pets/'+pet_id+'/agent', role='station'), predicate=lambda b:b.get('voice',{}).get('tone')=='calm')
            check('private pet is not public', request('/v1/catalog/'+pet_id+'/facts'), 404)
            if 'adopter' in tokens: check('adopter cannot access private pet', request('/v1/pets/'+pet_id, role='adopter'), 404)
            if (args.register or args.flow) and 'adopter' in tokens:
                check('publish internal QA pet for application',request('/v1/pets/'+pet_id+'/profile',{'name':'联调·main审计','profile':profile,'published':True},'station'))
                application=check('adopter applies',request('/v1/pets/'+pet_id+'/applications',{'note':'仅联调数据，请勿实际联系。','memories':[],'shareProfile':True},'adopter',key=str(uuid.uuid4())),201)
                if application.get('id'):
                    for stage in [1,2]:
                        application=check('station advances application '+str(stage),request('/v1/applications/'+application['id']+'/stage',{'stage':stage,'version':application['version']},'station'))
                        check('adopter sees application '+str(stage),request('/v1/applications',role='adopter'),predicate=lambda b:any(a['id']==application['id'] and a['stage']==stage and a.get('pet',{}).get('name') for a in b.get('applications',[])))
                    check('pending identity remains blocked',request('/v1/applications/'+application['id']+'/stage',{'stage':3,'version':application['version']},'station'),409,lambda b:b.get('error')=='IDENTITY_PENDING')
                    index=check('cloud conversation and stage notification',request('/v1/conversations',role='adopter'),predicate=lambda b:any(c['pet']['id']==pet_id and c['unread']>=3 for c in b.get('conversations',[])))
                    conversation=next(c for c in index.get('conversations',[]) if c['pet']['id']==pet_id)
                    check('mark cloud conversation read',request('/v1/pets/'+pet_id+'/chat/read',{'through':conversation['lastMessage']['at']},'adopter'))
                    check('cloud unread cleared',request('/v1/conversations',role='adopter'),predicate=lambda b:any(c['pet']['id']==pet_id and c['unread']==0 for c in b.get('conversations',[])))
                check('hide internal QA pet again',request('/v1/pets/'+pet_id+'/profile',{'name':'联调·main审计','profile':profile,'published':False},'station'))
                check('hidden pet history retained',request('/v1/pets/'+pet_id+'/chat',role='adopter'),predicate=lambda b:len(b.get('messages',[]))>=3)
            for label, body in [
                ('new dated record contract', {'text':'平时喜欢在窗边休息。','shareWithAgent':True,'observedOn':'2026-10-23','photos':[]}),
                ('baseline observation contract', {'text':'平时喜欢在窗边休息。','shareWithAgent':True})]:
                key = str(uuid.uuid4())
                row = check(label, request('/v1/pets/'+pet_id+'/observations', body, 'station', key=key), 202)
                if row.get('id'):
                    observation_ids.append(row['id'])
                    check(label+' retry idempotency', request('/v1/pets/'+pet_id+'/observations', body, 'station', key=key), 200, lambda b:b.get('id')==row['id'])
                    if args.ai:
                        check('process QA observation', request('/v1/observations/'+row['id']+'/process', {}, 'station'), predicate=lambda b:not b.get('error'))
            check('QA observation listing', request('/v1/pets/'+pet_id+'/observations', role='station'))
            if args.ai and observation_ids:
                check('QA memory extracted', request('/v1/pets/'+pet_id+'/knowledge', role='station'), predicate=lambda b:bool(b.get('notes')))
            jpeg = local/'intake-ocr.jpg'
            if jpeg.exists():
                photo = 'data:image/jpeg;base64,'+base64.b64encode(jpeg.read_bytes()).decode()
                result = check('private QA media append', request('/v1/pets/'+pet_id+'/visuals', {'photos':[photo],'shared':False}, 'station', key=str(uuid.uuid4())), 201)
                album = check('QA media listing', request('/v1/pets/'+pet_id+'/intake', role='station'), predicate=lambda b:bool(b.get('visuals')))
                for v in album.get('visuals', [])[:1]:
                    path = v['url'].removeprefix(base)
                    check('QA media station read', request(path, role='station'))
                    check('QA media anonymous denied', request(path), 401)
    if args.ai:
        if 'adopter' in tokens:
            for pid in ['example-pet-orange','example-pet-dog','example-pet-pancake']:
                check(pid+' AI', request('/v1/pets/'+pid+'/chat', {'question':'你平时喜欢什么，有哪些日常习惯？'}, 'adopter'), predicate=lambda b:bool(b.get('answer')), detail=lambda b:{'answerLength':len(b.get('answer','')),'citations':len(b.get('citations',[]))})
                check(pid+' history', request('/v1/pets/'+pid+'/chat', role='adopter'))
            check('AI conversation context setup',request('/v1/pets/example-pet-orange/chat',{'question':'我平时晚上八点半下班到家，这个时间才方便陪你。'},'adopter'),predicate=lambda b:bool(b.get('answer')))
            check('AI remembers previous user turn',request('/v1/pets/example-pet-orange/chat',{'question':'我刚才说通常几点下班到家？'},'adopter'),predicate=lambda b:any(x in b.get('answer','') for x in ['八点半','8点半','20:30','20：30','8:30']))
        wav = local/'verification.wav'
        if wav.exists(): check('ASR actual WAV', request('/v1/onboarding/transcribe', raw=wav.read_bytes(), mime='audio/wav'), predicate=lambda b:bool(b.get('text')), detail=lambda b:{'textLength':len(b.get('text',''))})
except Exception as e:
    report['interrupted'] = type(e).__name__
finally:
    if application and application.get('id') and application.get('stage',3)<3:
        code,_=request('/v1/applications/'+application['id']+'/stage',{'stage':-1,'version':application['version']},'adopter')
        report['cleanup'].append({'action':'cancel QA application','http':code})
    for oid in observation_ids:
        code, _ = request('/v1/observations/'+oid, role='station', method='DELETE')
        report['cleanup'].append({'action':'withdraw QA observation','http':code})
    if pet_id:
        code, _ = request('/v1/pets/'+pet_id+'/profile', {'name':'联调·main审计已结束','profile':{'species':'cat','internal':True},'published':False}, 'station')
        report['cleanup'].append({'action':'keep QA pet internal and unpublished','http':code})
    for role in tokens:
        code, _ = request('/v1/auth/logout', {}, role)
        report['cleanup'].append({'action':role+' logout','http':code})
    output = local/'main-audit-live.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'checks':len(report['checks']),'failures':sum(c['result']=='fail' for c in report['checks']),'cleanup':report['cleanup'],'interrupted':report.get('interrupted')}, ensure_ascii=True), flush=True)
