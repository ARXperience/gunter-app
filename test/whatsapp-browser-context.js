'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/services/project-knowledge-service.js'),'utf8');
function fixture(options={}){
    let current='u_alice';
    const local={gunter_device_user:current,gunter_generated_analyses:JSON.stringify({'p1::review':{ownerId:'u_alice',definition:{title:'Revisión'},payload:{result:'Pendiente revisión'}},
        'p1::legacy':{definition:{title:'Análisis sin dueño'},payload:{result:'ownerless cache secret'}},
        'p1::private':{ownerId:'u_alice',privacy:'PUBLIC',sensitivity:'LOCAL',payload:{result:'conflicting cache secret'}}})};
    const window={GunterAuth:{getUser:()=>({id:current,status:'approved'}),isVerified:()=>options.verified!==false,canAccessLocalData:()=>true},
        gunterData:{getAllProjects:()=>[{id:'p1',ownerId:'u_alice',name:'Proyecto propio',analyses:[{id:'m1',transcription:'Acuerdo propio'},{id:'bad',ownerId:'u_bob',transcription:'foreign meeting'}],notes:[{id:'n1',text:'Nota propia'},{privacy:'LOCAL',text:'Local secret'}]},
            {id:'foreign',ownerId:'u_bob',name:'foreign project'}]},
        GunterTasksService:{list:async()=>{if(options.switchOwner)current='u_bob';return [{id:'t1',ownerId:'u_alice',title:'Tarea propia',status:'pending'},
            {id:'legacy',ownerId:'local-user',title:'Tarea ligada al dispositivo'}, {id:'bad',ownerId:'u_bob',title:'foreign task'}, {id:'secret',privacy:'SENSITIVE_LOCAL_ONLY',title:'Local secret'},
            {id:'conflict',ownerId:'u_alice',privacy:'PUBLIC',meta:{privacy:'NEVER_CLOUD'},title:'conflicting task secret'}];}},
        GunterEventsService:{list:async()=>[{id:'e1',ownerId:'u_alice',title:'Evento cancelado',status:'cancelled'}]},
        GunterDocumentService:{list:async()=>{if(options.documentFails)throw Error('not ready');return [{id:'d1',ownerId:'u_alice',title:'Factura',total:0,dueDate:'2026-10-25'}];}},
        GunterNotificationsService:{list:async()=>[{id:'r1',ownerId:'u_alice',title:'Aviso fallido',status:'failed'}]},
        GunterTranscriptStore:{load:()=>{throw Error('unrelated LOCAL transcript must not be read');}}};
    vm.runInNewContext(source,{window,localStorage:{getItem:key=>local[key]||null},console,Intl,Date,Map,Set});return window.GunterProjectKnowledge;
}
let checks=0;async function test(name,fn){await fn();console.log(`PASS ${++checks} ${name}`);}
(async()=>{
    await test('browser snapshot carries authenticated immutable owner and bounded source coverage',async()=>{
        const s=await fixture().build();assert.equal(s.version,2);assert.equal(s.ownerId,'u_alice');assert.equal(s.userId,'u_alice');assert.equal(s.source,'browser');assert.equal(s.coverage.tasks.count,1);
        assert.equal(s.projects.length,1);assert.equal(s.projects[0].meetings.length,1);assert.equal(s.projects[0].notes.length,1);
        assert.equal(s.globalEvents[0].status,'cancelled');assert.equal(s.globalReminders[0].status,'failed');assert.equal(s.globalDocuments[0].valor,0);assert.equal(s.globalDocuments[0].fechaVencimiento,'2026-10-25');
        const json=JSON.stringify(s);assert.ok(!json.includes('foreign'));assert.ok(!json.includes('Local secret'));assert.ok(!json.includes('Tarea ligada al dispositivo'));assert.ok(json.includes('Nota propia'));assert.ok(json.includes('Revisión'));
    });
    await test('unverified session and account switch cannot claim local data',async()=>{
        await assert.rejects(fixture({verified:false}).build(),/ACCOUNT_REQUIRED/);await assert.rejects(fixture({switchOwner:true}).build(),/ACCOUNT_REQUIRED/);
    });
    await test('global analysis cache requires explicit ownership and no privacy flag can mask a local restriction',async()=>{
        const s=await fixture().build(),json=JSON.stringify(s);
        assert.equal(s.projects[0].analyses.length,1);
        for(const secret of ['ownerless cache secret','conflicting cache secret','conflicting task secret'])assert.ok(!json.includes(secret),secret);
    });
    await test('unavailable collection is explicit and content hash excludes volatile sync timestamp',async()=>{
        const api=fixture({documentFails:true}),s=await api.build();assert.equal(s.coverage.documents.available,false);assert.equal(s.globalDocuments.length,0);
        assert.equal(api.hash(s),api.hash({...s,syncedAt:'2099-01-01'}));assert.notEqual(api.hash(s),api.hash({...s,ownerId:'u_bob'}));
    });
    await test('server rejects v2 ownership spoofing before writing snapshots',()=>{
        const module={exports:{}},writes=[];
        vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../server/knowledge/store.js'),'utf8'),{module,exports:module.exports,console,require:key=>{
            if(key==='fs')return {existsSync:()=>false,writeFileSync:(p,b)=>writes.push({p,b})};if(key==='path')return require('node:path');
            if(key==='../user-store')return {userKnowledgeDir:()=>'/virtual/u_alice'};
            if(key==='../user-context')return {currentUserId:()=> 'u_alice',contextKind:()=> 'session'};throw Error(`unexpected require ${key}`);
        }});
        assert.throws(()=>module.exports.putSnapshot({version:2,userId:'u_bob',ownerId:'u_bob',projects:[]}),/OWNER_MISMATCH/);assert.equal(writes.length,0);
        assert.equal(module.exports.putSnapshot({version:2,userId:'u_alice',ownerId:'u_alice',projects:[],syncedAt:new Date().toISOString()}).ok,true);assert.equal(writes.length,2);
    });
    await test('project persistence notifies the existing debounced synchronization instead of waiting fifteen minutes',()=>{
        const events=[],values=new Map([['gunter_device_user','u_alice']]),window={dispatchEvent:event=>events.push(event.type),
            GunterAuth:{getUser:()=>({id:'u_alice',status:'approved'}),canAccessLocalData:()=>true}};
        vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../js/data-service.js'),'utf8'),{window,console,
            localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},CustomEvent:class{constructor(type){this.type=type;}}});
        assert.equal(window.gunterData.saveProject({id:'p_sync',name:'Proyecto sincronizable'}).ownerId,'u_alice');
        assert.deepEqual(events,['gunter-data-changed']);assert.ok(values.get('gunter_data').includes('Proyecto sincronizable'));
    });
    await test('new tasks and original documents record the trusted account without adopting legacy rows',async()=>{
        for(const name of ['tasks-service','document-service']){
            const saved=[],storage={getItem:k=>k==='gunter_device_user'?'u_alice':null};
            const window={localStorage:storage,dispatchEvent:()=>{},GunterAuth:{getUser:()=>({id:'u_alice',status:'approved'}),canAccessLocalData:()=>true}};
            const db={close(){},transaction(){const tx={objectStore:()=>({add:row=>{saved.push(row);queueMicrotask(()=>tx.oncomplete?.());}})};return tx;}};
            const indexedDB={open:()=>{const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
            vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,`../js/services/${name}.js`),'utf8'),
                {window,indexedDB,localStorage:storage,console,CustomEvent:class{constructor(type){this.type=type;}}});
            if(name==='tasks-service'){
                assert.equal((await window.GunterTasksService.create({title:'Propia'})).ownerId,'u_alice');
                await assert.rejects(window.GunterTasksService.create({title:'Ajena',ownerId:'u_bob'}),/OWNER_MISMATCH/);
            }else await window.GunterDocumentService.saveOriginal({empresa:{nombre:'Prueba'}},{});
            assert.equal(saved.length,1);assert.equal(saved[0].ownerId,'u_alice');
        }
    });
    console.log(`${checks} browser-to-WhatsApp snapshot checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
