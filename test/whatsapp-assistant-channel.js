'use strict';
// Pure module doubles: no socket, credentials, disk stores, models or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture(options = {}) {
    const calls = { cloud:0, local:0, context:[], memory:0, personality:0, log:0, download:0, stt:0, fallback:0 };
    let uid = 'u_owner';
    const users = { '573001111111':{id:'u_alice',status:'approved',role:'user'}, '573002222222':{id:'u_bob',status:'approved',role:'user'},
        '573003333333':{id:'u_blocked',status:'blocked',role:'user'} };
    const owner = {id:'u_owner',status:'approved',role:'admin'};
    const context = { ownerId:()=>owner.id, currentUserId:()=>uid, runAs:async (id, fn)=>{ const before=uid; uid=id; try{return await fn();}finally{uid=before;} } };
    const entries = id => [{key:'integrations',enabled:options.disabled!==true,advanced:{}},
        {key:'ai.cloud',enabled:true,advanced:{fallback:options.fallback!==false,...(options.providers?{providers:options.providers}:{})}},
        {key:'memory.cortex',enabled:options.memory===true,advanced:{}}];
    const deps = { '../auth/store':{findByPhone:p=>users[p],findById:id=>[owner,...Object.values(users)].find(u=>u.id===id)},
        '../user-context':context, '../control-plane/settings':{list:entries,hybridStatus:()=>({mode:options.local?'LOCAL':'CLOUD',privacy:options.local?'LOCAL_ONLY':'STANDARD'})},
        '../control-plane/feature-flags':{evaluate:()=>({enabled:true})},
        '../control-plane/model-router':{resolveHybrid:(kind,p)=>options.unavailable?{ok:false,code:'LOCAL_PROVIDER_UNAVAILABLE'}:{ok:true,provider:p.privacy==='LOCAL_ONLY'?'local':'cloud',kind}},
        './message-log':{appendMessage:()=>calls.log++}, './memory':{historyForPrompt:()=>{calls.memory++;return [];},appendTurn:()=>calls.memory++},
        './personality':{get:()=>{calls.personality++;return {voiceStyle:'warm'};}},
        './query-context':{build:async(q,o)=>{calls.context.push({q,...o,uid});assert.equal(uid,o.userId);return {text:`OWN_DATA_${o.userId}`,sources:[],limitations:[]};}},
        '../openai-client':{hasOpenAI:()=>options.openai!==false,chatComplete:async p=>{calls.cloud++;calls.messages=p.messages;return 'Respuesta de Gunter.';},transcribeAudio:async()=>{calls.stt++;return 'qué tareas tengo';}},
        '../gemini-client':{hasKey:()=>true,generateText:async p=>{calls.cloud++;if(options.cloudFails)throw Error('offline');calls.messages=p.messages;return 'Respuesta Gemini';},describeImage:async()=>{throw Error('unexpected image');}},
        '../fallback-llm-client':{activeProviders:()=>['groq'],chatComplete:async()=>{calls.fallback++;return 'fallback';}},
        '../local-brain':{generate:async p=>{calls.local++;calls.messages=p.messages;return {choices:[{message:{content:'Respuesta local.'}}]};}},
        '../local-stt':{transcribeAudio:async()=>{calls.stt++;return {text:'mis recordatorios'};}} };
    function load(name) {
        const module = {exports:{}};
        vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server/whatsapp',name),'utf8'),
            {module,exports:module.exports,require:key=>{if(!(key in deps))throw Error(`unexpected require ${key}`);return deps[key];},console,Date,Map,Set}, {filename:name});
        return module.exports;
    }
    const access=load('access.js'); deps['./access']=access;
    const handler=load('handler.js');
    return {handler,access,calls,get uid(){return uid;},incoming:(from,text,id='m1',extra={})=>handler.processIncoming({key:{remoteJid:from,id,...extra},message:{conversation:text}}, {policyUserId:owner.id,
        downloadMedia:async()=>{calls.download++;return Buffer.from('x');}})};
}
let passed=0;
async function test(name,run){await run();console.log(`PASS ${++passed} ${name}`);}
(async()=>{
    await test('public text needs no wake and never reads owner data or stores',async()=>{
        const h=fixture();const r=await h.incoming('573009999999@s.whatsapp.net','Explícame las estrellas');
        assert.equal(r.reply,'Respuesta de Gunter.');assert.equal(h.calls.context.length,0);assert.equal(h.calls.memory,0);assert.equal(h.calls.log,0);assert.equal(h.calls.personality,0);
        assert.ok(!JSON.stringify(h.calls.messages).includes('OWN_DATA'));assert.equal(h.uid,'u_owner');
    });
    await test('linked approved phones see only their own authenticated context',async()=>{
        const h=fixture();await h.incoming('573001111111@s.whatsapp.net','mis tareas');await h.incoming('573002222222@s.whatsapp.net','mis recordatorios');
        assert.deepEqual(h.calls.context.map(x=>x.uid),['u_alice','u_bob']);assert.ok(!JSON.stringify(h.calls.messages).includes('OWN_DATA_u_alice'));
    });
    await test('general conversation does not attach private account snapshots and public private queries ask for linking',async()=>{
        const h=fixture();await h.incoming('573001111111@s.whatsapp.net','¿Qué es un recordatorio?');assert.equal(h.calls.context.length,0);
        const r=await h.incoming('573009999999@s.whatsapp.net','mis recordatorios');assert.ok(r.reply.includes('vincula'));assert.equal(h.calls.cloud,1);
    });
    await test('groups blocked users and own messages stop before all providers and media',async()=>{
        const h=fixture();await h.incoming('123456789@g.us','mis tareas');await h.incoming('573003333333@s.whatsapp.net','hola');
        await h.incoming('573001111111@s.whatsapp.net','hola','self',{fromMe:true});assert.equal(h.calls.cloud,0);assert.equal(h.calls.download,0);
    });
    await test('LID uses trusted Baileys alternate phone; bare LID stays public',async()=>{
        const h=fixture();await h.incoming('1234567890123456@lid','mis tareas','lid',{remoteJidAlt:'573001111111@s.whatsapp.net'});
        assert.equal(h.calls.context[0].userId,'u_alice');await h.incoming('1234567890123457@lid','hola');assert.equal(h.calls.context.length,1);
    });
    await test('LOCAL_ONLY chooses local and never cloud or cloud fallback',async()=>{
        const h=fixture({local:true});await h.incoming('573001111111@s.whatsapp.net','mis tareas');assert.equal(h.calls.local,1);assert.equal(h.calls.cloud,0);assert.equal(h.calls.fallback,0);
    });
    await test('missing allowed local provider fails closed without cloud',async()=>{
        const h=fixture({local:true,unavailable:true});const r=await h.incoming('573001111111@s.whatsapp.net','hola');assert.equal(r.code,'LOCAL_PROVIDER_UNAVAILABLE');assert.equal(h.calls.cloud,0);assert.equal(h.calls.context.length,0);
    });
    await test('disabled integration and narrowed provider allowlist do not leak',async()=>{
        const h=fixture({disabled:true});assert.equal((await h.incoming('573001111111@s.whatsapp.net','hola')).ignored,true);assert.equal(h.calls.cloud,0);
        const blocked=fixture({providers:['mistral']});await blocked.incoming('573009999999@s.whatsapp.net','hola');assert.equal(blocked.calls.cloud,0);assert.equal(blocked.calls.fallback,0);
    });
    await test('cloud failure with fallback disabled does not broaden provider access',async()=>{
        const h=fixture({openai:false,cloudFails:true,fallback:false});await h.incoming('573001111111@s.whatsapp.net','hola');assert.equal(h.calls.fallback,0);
    });
    await test('writes are not executed or falsely confirmed by a planner',async()=>{
        const h=fixture();const r=await h.incoming('573001111111@s.whatsapp.net','crea una tarea para mañana');assert.ok(r.reply.includes('No he hecho'));assert.equal(h.calls.cloud,0);assert.equal(h.calls.context.length,0);
    });
    await test('unknown audio is rejected before download transcription or persistence',async()=>{
        const h=fixture();await h.handler.processIncoming({key:{remoteJid:'573009999999@s.whatsapp.net',id:'audio'},message:{audioMessage:{mimetype:'audio/ogg'}}},
            {policyUserId:'u_owner',downloadMedia:()=>{h.calls.download++;throw Error('unexpected download');}});
        assert.equal(h.calls.download,0);assert.equal(h.calls.stt,0);assert.equal(h.calls.cloud,0);
    });
    await test('duplicates and request bursts cannot multiply provider calls',async()=>{
        const h=fixture();await h.incoming('573009999999@s.whatsapp.net','hola');assert.equal((await h.incoming('573009999999@s.whatsapp.net','hola')).code,'duplicate');
        for(let i=0;i<7;i++)await h.incoming('573009999999@s.whatsapp.net','hola',`r${i}`);
        assert.equal((await h.incoming('573009999999@s.whatsapp.net','hola','limit')).code,'rate_limited');assert.equal(h.calls.cloud,8);
    });
    await test('private logging only occurs when account memory is enabled',async()=>{
        const h=fixture({memory:true});const r=await h.incoming('573001111111@s.whatsapp.net','hola');assert.equal(r.logUserId,'u_alice');assert.equal(h.calls.log,1);assert.equal(h.calls.memory,2);
    });
    console.log(`${passed} WhatsApp channel checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
