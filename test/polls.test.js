import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';
import worker from '../worker.js';

test('country gate rejects unknown and non-Indian requests, including spoofed headers', async()=>{
  for(const country of [undefined,'US']){
    const req=new Request('https://room.example/',{headers:{'CF-IPCountry':'IN'}});
    req.cf={country};
    assert.equal((await worker.fetch(req,{})).status,403);
  }
});
test('shared poll accepts a single ballot per browser; only admin sees counts',async t=>{
  const platform=await getPlatformProxy({persist:false});
  t.after(()=>platform.dispose());
  const env={DB:platform.env.DB, ADMIN_PASSWORD:crypto.randomUUID()};
  await env.DB.exec(await readFile(new URL('../migrations/0001_polls.sql',import.meta.url),'utf8'));
  await env.DB.exec(await readFile(new URL('../migrations/0002_invitations.sql',import.meta.url),'utf8'));
  await env.DB.exec(await readFile(new URL('../migrations/0003_choice_limits.sql',import.meta.url),'utf8'));
  await env.DB.exec(await readFile(new URL('../migrations/0004_named_invitations.sql',import.meta.url),'utf8'));
  await env.DB.exec(await readFile(new URL('../migrations/0005_invitation_signing.sql',import.meta.url),'utf8'));
  const call=(path,data,cookie='')=>{
    const req=new Request('https://room.example/api/'+path,{method:data?'POST':'GET',headers:{origin:'https://room.example','content-type':'application/json',cookie},body:data?JSON.stringify(data):undefined});
    req.cf={country:'IN'};return worker.fetch(req,env);
  };
  const cookie=r=>r.headers.get('set-cookie').split(';')[0];
  const login=await call('login',{username:'ajith',password:env.ADMIN_PASSWORD});assert.equal(login.status,200);const admin=cookie(login);
  await t.test('50 private codes share one poll with a four-of-seven rule',async()=>{
    const poll={title:'Select four',options:'ABCDEFG'.split(''),multi:true,minChoices:4,maxChoices:4};
    assert.equal((await call('admin/polls',{...poll,maxChoices:8},admin)).status,400);
    const {id}=await (await call('admin/polls',poll,admin)).json();
    const issue='admin/invitations/'+id,path='polls/'+id;
    assert.equal((await call(issue,{count:101},admin)).status,400);
    assert.equal((await call(issue,{names:['First','   ']},admin)).status,400);
    const names=Array.from({length:50},(_,i)=>`Voter ${i+1}`);
    const {codes}=await (await call(issue,{names},admin)).json();assert.equal(new Set(codes).size,50);
    const read=await call(path),browser=cookie(read),settings=await read.json();assert.deepEqual([settings.minChoices,settings.maxChoices],[4,4]);
    for(const choices of [[0,1,2],[0,1,2,3,4]])assert.equal((await call(path,{choices,code:codes[0]},browser)).status,400);
    for(const [code,b] of [[codes[0],browser],[codes[49],cookie(await call(path))]])assert.equal((await call(path,{choices:[0,1,2,3],code},b)).status,201);
  });
  let otherPollCode;
  for(const multi of [false,true]){
    const created=await call('admin/polls',{title:'Pick a colour',options:['Green','Gold'],multi},admin);assert.equal(created.status,201);
    const {id}=await created.json(),path='polls/'+id;
    const read=await call(path),browser=cookie(read);assert.equal((await read.json()).voted,false);
    assert.equal((await call(path,{choices:[2]},browser)).status,400);
    if(!multi)assert.equal((await call(path,{choices:[0,1]},browser)).status,400);
    const issue='admin/invitations/'+id;
    assert.equal((await call(issue,{},browser)).status,401);
    const {codes:[code]}=await (await call(issue,{names:['First voter']},admin)).json();
    assert.equal((await call(path,{choices:[0]},browser)).status,400);
    if(otherPollCode)assert.equal((await call(path,{choices:[0],code:otherPollCode},browser)).status,409);
    const browsers=[browser,cookie(await call(path))];
    const signed=(await (await call('admin/results/'+id,undefined,admin)).json()).voters[0].code;
    const tampered=signed.slice(0,-1)+(signed.endsWith('0')?'1':'0');
    assert.equal((await call(path,{choices:[0],code:tampered},browser)).status,409);
    const votes=await Promise.all(browsers.map((b,i)=>call(path,{choices:multi?[0,1]:[1],code:i?code:signed},b)));
    assert.deepEqual(votes.map(r=>r.status).sort(),[201,409]);
    const winner=browsers[votes.findIndex(r=>r.status===201)];
    assert.equal((await (await call(path,undefined,winner)).json()).voted,true);
    otherPollCode=(await (await call(issue,{names:['Second voter']},admin)).json()).codes[0];
    assert.equal((await call(path,{choices:[0],code:otherPollCode},winner)).status,409);
    assert.equal((await call('admin/results/'+id,undefined,browser)).status,401);
    const results=await (await call('admin/results/'+id,undefined,admin)).json();assert.equal(results.voters[0].code,signed);assert.deepEqual(results.voters.map(({name,choices})=>({name,choices})),[{name:'First voter',choices:multi?['Green','Gold']:['Gold']},{name:'Second voter',choices:null}]);assert.equal(results.total,1);assert.deepEqual(results.options.map(o=>o.count),[Number(multi),1]);
  }
});
