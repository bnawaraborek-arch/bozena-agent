// Uruchom po npm run build. Tylko fikcyjne ustawienia, bez wywolan modelu.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
(async()=>{
 const base='http://127.0.0.1:3217';
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3217'],{
  windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',CHAT_PASSWORD:'local-smoke-password',SESSION_SECRET:randomBytes(48).toString('hex'),CHAT_LOGIN_RATE_LIMIT_CONFIGURED:'true',OPENROUTER_API_KEY:'',OPENROUTER_MODEL:''}
 });
 try {
  let ready=false;
  for(let i=0;i<80;i++){try{const r=await fetch(base);if(r.ok){ready=true;break;}}catch{} await delay(250);}
  assert.ok(ready,'Production server ready');
  async function req(route,body,cookie){return fetch(base+'/api/'+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body||{})});}
  assert.equal((await req('chat',{messages:[]})).status,401);
  const wrong=await req('login',{password:'wrong'});console.log('HTTP wrong login status: '+wrong.status);assert.equal(wrong.status,401);
  const login=await req('login',{password:'local-smoke-password'});console.log('HTTP login status: '+login.status);assert.equal(login.status,204);
  const header=login.headers.get('set-cookie');assert.match(header,/HttpOnly/i);assert.match(header,/Secure/i);assert.match(header,/SameSite=Strict/i);
  const cookie=header.split(';')[0];
  assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie}})).status,204);
  assert.equal((await req('chat',{messages:[{id:'1',role:'user',parts:[{type:'text',text:'test'}]}]},cookie)).status,503);
  const logout=await req('logout',{},cookie);assert.equal(logout.status,204);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/i);
  assert.equal((await req('chat',{messages:[]})).status,401);
  console.log('PASS: produkcyjne HTTP, logowanie, cookie Secure, sesja, wylogowanie, 401 bez sesji i 503 bez konfiguracji modelu. Bez wywolan OpenRouter.');
 } finally {child.kill();}
})().catch(()=>{console.error('FAIL: produkcyjny test HTTP; szczegoly ukryte.');process.exitCode=1;});
