const json = (data, status = 200) => Response.json(data, { status });
const fail = (message, status) => json({ error: message }, status);
const uuid = () => crypto.randomUUID();
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const limitText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

async function signingKey(db) {
  const {secret} = await db.prepare('SELECT secret FROM invitation_signer WHERE id=1').first();
  return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
const signatureData = (poll,hash) => new TextEncoder().encode(`${poll}:${hash}`);
async function invitationCode(key,poll,hash) {
  const signature = await crypto.subtle.sign('HMAC',key,signatureData(poll,hash));
  return `${hash}.${Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('')}`;
}

async function route(request, env) {
  const url = new URL(request.url);
  const local = env.LOCAL_PREVIEW === '1' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!local && request.cf?.country !== 'IN') return new Response('This poll room is available only on Indian networks.', { status: 403 });
  const path = url.pathname, method = request.method;
  const cookie = name => (request.headers.get('Cookie') || '').split('; ').find(v => v.startsWith(name + '='))?.slice(name.length + 1) || '';
  const attach = (res, name, value, age) => {
    res.headers.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${local ? '' : '; Secure'}`);
    return res;
  };
  if (method === 'POST' && (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json'))) return fail('Invalid request origin or content type.', 403);
  const body = async () => {
    const text = await request.text();
    if (text.length > 10000) return {};
    try { return JSON.parse(text) || {}; } catch { return {}; }
  };
  const sql = (s, ...args) => env.DB.prepare(s).bind(...args);
  const now = Date.now();
  if (path === '/api/login' && method === 'POST') {
    const ip = await digest(request.headers.get('CF-Connecting-IP') || 'local');
    const attempt = await sql('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END, until=CASE WHEN until<=? THEN excluded.until ELSE until END RETURNING count', ip, now+900000, now, now).first();
    if (attempt.count > 10) return fail('Too many attempts. Try again in 15 minutes.', 429);
    const { username, password } = await body();
    if (!env.ADMIN_PASSWORD || username !== 'ajith' || password !== env.ADMIN_PASSWORD) return fail('Incorrect username or password.', 401);
    const token = uuid();
    await env.DB.batch([sql('DELETE FROM attempts WHERE ip=? OR until<=?', ip, now), sql('DELETE FROM sessions WHERE expires<=?', now), sql('INSERT INTO sessions VALUES(?,?)', await digest(token), now+28800000)]);
    return attach(json({ ok:true }), 'session', token, 28800);
  }
  if (path.startsWith('/api/admin/')) {
    const token = await digest(cookie('session'));
    if (!await sql('SELECT 1 FROM sessions WHERE token=? AND expires>?', token, now).first()) return fail('Sign in to continue.', 401);
    if (path === '/api/admin/logout' && method === 'POST') {
      await sql('DELETE FROM sessions WHERE token=?', token).run();
      return attach(json({ok:true}), 'session', '', 0);
    }
    if (path === '/api/admin/polls' && method === 'GET') return json((await sql('SELECT id,title FROM polls ORDER BY created DESC').all()).results);
    if (path === '/api/admin/polls' && method === 'POST') {
      const {title, options, multi, minChoices = 1, maxChoices = multi ? options?.length : 1} = await body();
      if (!limitText(title, 200) || typeof multi !== 'boolean' || !Array.isArray(options) || options.length < 2 || options.length > 20 || !options.every(v => limitText(v,100)) || new Set(options.map(v=>v.trim().toLowerCase())).size !== options.length) return fail('Enter a question and 2–20 distinct options (up to 100 characters each).',400);
      if (!Number.isInteger(minChoices) || !Number.isInteger(maxChoices) || minChoices < 1 || minChoices > maxChoices || maxChoices > (multi ? options.length : 1)) return fail('Selection limits must be whole numbers between 1 and the number of options, with minimum ≤ maximum.',400);
      const id = uuid();
      await sql('INSERT INTO polls(id,title,options,multi,created,min_choices,max_choices) VALUES(?,?,?,?,?,?,?)', id,title.trim(),JSON.stringify(options.map(v=>v.trim())),Number(multi),now,minChoices,maxChoices).run();
      return json({id},201);
    }
    const invites = path.match(/^\/api\/admin\/invitations\/([\w-]+)$/);
    if (invites && method === 'POST') {
      const {names} = await body();
      if (!Array.isArray(names) || names.length < 1 || names.length > 100 || !names.every(name=>limitText(name,80))) return fail('Enter a voter name for each link (1–100 names, up to 80 characters each).',400);
      const codes = names.map(uuid);
      const rows = await Promise.all(codes.map(async(code,i)=>[await digest(code),names[i].trim()]));
      const result = await sql("INSERT INTO invitations(poll,code_hash,voter_name) SELECT polls.id,json_extract(j.value,'$[0]'),json_extract(j.value,'$[1]') FROM polls,json_each(?) j WHERE polls.id=?",JSON.stringify(rows),invites[1]).run();
      return result.meta.changes ? json({codes},201) : fail('Poll not found.',404);
    }
    const match = path.match(/^\/api\/admin\/results\/([\w-]+)$/);
    if (match && method === 'GET') {
      const poll = await sql('SELECT title,options FROM polls WHERE id=?', match[1]).first();
      if (!poll) return fail('Poll not found.',404);
      const [total, counts, recipients] = await env.DB.batch([sql('SELECT count(*) AS n FROM ballots WHERE poll=?',match[1]), sql('SELECT j.value AS idx,count(*) AS n FROM ballots b,json_each(b.choices) j WHERE b.poll=? GROUP BY j.value',match[1]), sql('SELECT i.code_hash AS hash,i.voter_name AS name,b.choices FROM invitations i LEFT JOIN ballots b ON b.poll=i.poll AND b.invitation=i.code_hash WHERE i.poll=? AND i.voter_name IS NOT NULL ORDER BY i.rowid',match[1])]);
      const labels = JSON.parse(poll.options);
      const key = await signingKey(env.DB);
      const voters = await Promise.all(recipients.results.map(async({hash,name,choices})=>({name,code:await invitationCode(key,match[1],hash),choices:choices ? JSON.parse(choices).map(i=>labels[i]) : null})));
      return json({title:poll.title,voters,total:total.results[0].n,options:labels.map((label,i)=>({label,count:counts.results.find(v=>v.idx===i)?.n || 0}))});
    }
  }
  const match = path.match(/^\/api\/polls\/([\w-]+)$/);
  if (match && ['POST','GET'].includes(method)) {
    const poll = await sql('SELECT title,options,multi,min_choices AS minChoices,max_choices AS maxChoices FROM polls WHERE id=?',match[1]).first();
    if (!poll) return fail('Poll not found.',404);
    poll.options = JSON.parse(poll.options);
    let browser = cookie('browser');
    if (method === 'GET') {
      browser ||= uuid();
      const voted = !!await sql('SELECT 1 FROM ballots WHERE poll=? AND browser=?',match[1],await digest(browser)).first();
      return attach(json({...poll,voted}), 'browser',browser,34560000);
    }
    if (!browser) return fail('Enable cookies and reopen the poll before voting.',400);
    const {choices, code} = await body();
    if (!Array.isArray(choices) || choices.length < poll.minChoices || choices.length > poll.maxChoices || new Set(choices).size !== choices.length || !choices.every(i=>Number.isInteger(i)&&i>=0&&i<poll.options.length)) return fail('Choose valid options for this poll.',400);
    if (!limitText(code, 129)) return fail('Enter your invitation code.',400);
    const token=code.trim().toLowerCase(), signed=/^([0-9a-f]{64})\.([0-9a-f]{64})$/.exec(token);
    let hash;
    if (signed) {
      const sig=Uint8Array.from(signed[2].match(/../g),pair=>parseInt(pair,16));
      if (!await crypto.subtle.verify('HMAC',await signingKey(env.DB),sig,signatureData(match[1],signed[1]))) return fail('Invalid invitation.',409);
      hash=signed[1];
    } else hash=await digest(token);
    const result = await sql('INSERT INTO ballots(poll,browser,choices,invitation) SELECT poll,?,?,code_hash FROM invitations WHERE poll=? AND code_hash=? ON CONFLICT DO NOTHING', await digest(browser), JSON.stringify(choices), match[1], hash).run();
    return result.meta.changes ? json({ok:true},201) : fail('Invitation invalid or already used, or this browser has already voted.',409);
  }
  if (path.startsWith('/api/')) return fail('Not found.',404);
  if (method !== 'GET' && method !== 'HEAD') return fail('Method not allowed.',405);
  if (path === '/' || /^\/p\/[\w-]+$/.test(path)) url.pathname = '/index.html';
  return env.ASSETS.fetch(new Request(url,request));
}
export default {async fetch(request,env) {
  let res;
  try { res = await route(request,env); } catch { res = fail('Service unavailable. Try again later.',503); }
  const out = new Response(res.body,res);
  out.headers.set('Cache-Control','private, no-store');
  out.headers.set('X-Content-Type-Options','nosniff');
  out.headers.set('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return out;
}};
