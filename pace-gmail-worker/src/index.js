const TOKEN_KEY = "google_tokens";
const ACTIONS_KEY = "pace_email_actions";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly"
].join(" ");

const MONEY_QUERY = [
  "newer_than:90d",
  "(\"payment due\" OR \"due soon\" OR overdue OR invoice OR bill OR renewal OR subscription OR \"direct debit\" OR \"standing order\" OR Klarna OR \"minimum payment\" OR \"payment reminder\" OR \"action required\" OR \"failed payment\" OR \"upcoming payment\")",
  "-receipt",
  "-receipts",
  "-\"order confirmation\"",
  "-\"thanks for your order\"",
  "-\"your order\"",
  "-\"food order\""
].join(" ");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if(request.method === "OPTIONS"){
      return corsResponse(null, env);
    }

    try{
      if(url.pathname === "/auth/start"){
        requireAppAccess(request, env);
        return startAuth(request, env);
      }

      if(url.pathname === "/auth/callback"){
        return finishAuth(request, env);
      }

      if(url.pathname === "/connected"){
        return connectedPage();
      }

      if(url.pathname === "/sync"){
        requireAppAccess(request, env);
        const actions = await syncGmail(env);
        return corsResponse({ ok:true, actions }, env);
      }

      if(url.pathname === "/actions"){
        requireAppAccess(request, env);
        return corsResponse({ ok:true, actions:await getActions(env) }, env);
      }

      if(url.pathname === "/health"){
        requireAppAccess(request, env);
        return corsResponse({ ok:true, connected:Boolean(await getTokens(env)) }, env);
      }

      if(url.pathname === "/debug"){
        requireAppAccess(request, env);
        return corsResponse(await getDebugInfo(env), env);
      }

      return corsResponse({ ok:false, error:"Not found" }, env, 404);
    }catch(error){
      return corsResponse({ ok:false, error:error.message || "Worker error" }, env, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncGmail(env));
  }
};

function corsHeaders(env){
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

function corsResponse(body, env, status = 200){
  if(body === null){
    return new Response(null, { status:204, headers:corsHeaders(env) });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers:corsHeaders(env)
  });
}

function redirectTo(location){
  return new Response(null, {
    status:302,
    headers:{ Location:location }
  });
}

function connectedPage(){
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pace Gmail Connected</title>
<style>
body{
  margin:0;
  min-height:100vh;
  display:grid;
  place-items:center;
  padding:20px;
  color:#f5f7fb;
  background:linear-gradient(180deg,#0f1115,#171a20);
  font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
}
.card{
  width:min(520px,100%);
  border:1px solid rgba(255,255,255,0.12);
  border-radius:24px;
  padding:24px;
  background:rgba(255,255,255,0.06);
  box-shadow:0 24px 60px rgba(0,0,0,0.36);
}
h1{
  margin:0;
  font-size:28px;
  letter-spacing:-0.04em;
}
p{
  color:#a7afbe;
  line-height:1.55;
}
</style>
</head>
<body>
  <div class="card">
    <h1>Gmail connected.</h1>
    <p>Go back to Pace Email Command, paste your Worker URL and private key if needed, then press <strong>Sync now</strong>.</p>
  </div>
</body>
</html>`, {
    headers:{ "Content-Type":"text/html" }
  });
}

function requireAppAccess(request, env){
  if(!env.PACE_ACCESS_KEY){
    return;
  }

  const url = new URL(request.url);
  const bearer = request.headers.get("Authorization") || "";
  const headerKey = request.headers.get("X-Pace-Key") || "";
  const queryKey = url.searchParams.get("key") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";

  if(headerKey === env.PACE_ACCESS_KEY || queryKey === env.PACE_ACCESS_KEY || token === env.PACE_ACCESS_KEY){
    return;
  }

  throw new Error("Missing Pace access key");
}

function getRedirectUri(request){
  const url = new URL(request.url);
  return `${url.origin}/auth/callback`;
}

async function startAuth(request, env){
  assertConfig(env);

  const state = crypto.randomUUID();
  await env.PACE_GMAIL_KV.put("oauth_state", state, { expirationTtl:600 });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", getRedirectUri(request));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return redirectTo(authUrl.toString());
}

async function finishAuth(request, env){
  assertConfig(env);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = await env.PACE_GMAIL_KV.get("oauth_state");

  if(!code || !state || state !== savedState){
    return redirectTo(getAppUrl(env, "gmail=failed"));
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      code,
      client_id:env.GOOGLE_CLIENT_ID,
      client_secret:env.GOOGLE_CLIENT_SECRET,
      redirect_uri:getRedirectUri(request),
      grant_type:"authorization_code"
    })
  });

  const tokens = await tokenResponse.json();

  if(!tokenResponse.ok){
    throw new Error(tokens.error_description || tokens.error || "Could not connect Gmail");
  }

  await saveTokens(env, {
    access_token:tokens.access_token,
    refresh_token:tokens.refresh_token,
    expires_at:Date.now() + (Number(tokens.expires_in) || 3600) * 1000
  });

  try{
    await syncGmail(env);
  }catch(error){
    await env.PACE_GMAIL_KV.put("last_sync_error", error.message || "Gmail connected, but first sync failed");
  }

  return redirectTo(`${new URL(request.url).origin}/connected`);
}

function getAppUrl(env, query){
  const origin = env.APP_ORIGIN || "";
  const path = env.APP_PATH || "/Pace/email-command-test.html";
  return `${origin}${path}?${query}`;
}

function assertConfig(env){
  if(!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET){
    throw new Error("Missing Google OAuth secrets");
  }
}

async function getTokens(env){
  const saved = await env.PACE_GMAIL_KV.get(TOKEN_KEY, "json");
  return saved || null;
}

async function saveTokens(env, tokens){
  await env.PACE_GMAIL_KV.put(TOKEN_KEY, JSON.stringify(tokens));
}

async function getAccessToken(env){
  const tokens = await getTokens(env);

  if(!tokens || !tokens.refresh_token){
    throw new Error("Gmail is not connected yet");
  }

  if(tokens.access_token && Number(tokens.expires_at) > Date.now() + 60000){
    return tokens.access_token;
  }

  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      client_id:env.GOOGLE_CLIENT_ID,
      client_secret:env.GOOGLE_CLIENT_SECRET,
      refresh_token:tokens.refresh_token,
      grant_type:"refresh_token"
    })
  });

  const refreshed = await refreshResponse.json();

  if(!refreshResponse.ok){
    throw new Error(refreshed.error_description || refreshed.error || "Could not refresh Gmail access");
  }

  const nextTokens = {
    ...tokens,
    access_token:refreshed.access_token,
    expires_at:Date.now() + (Number(refreshed.expires_in) || 3600) * 1000
  };

  await saveTokens(env, nextTokens);
  return nextTokens.access_token;
}

async function getActions(env){
  const saved = await env.PACE_GMAIL_KV.get(ACTIONS_KEY, "json");
  return Array.isArray(saved) ? saved : [];
}

async function getDebugInfo(env){
  const tokens = await getTokens(env);
  const actions = await getActions(env);
  const lastSyncError = await env.PACE_GMAIL_KV.get("last_sync_error");

  return {
    ok:true,
    hasClientId:Boolean(env.GOOGLE_CLIENT_ID),
    hasClientSecret:Boolean(env.GOOGLE_CLIENT_SECRET),
    hasAccessKey:Boolean(env.PACE_ACCESS_KEY),
    hasTokens:Boolean(tokens),
    hasRefreshToken:Boolean(tokens?.refresh_token),
    tokenExpiresAt:tokens?.expires_at || null,
    actionCount:actions.length,
    lastSyncError:lastSyncError || ""
  };
}

async function saveActions(env, actions){
  await env.PACE_GMAIL_KV.put(ACTIONS_KEY, JSON.stringify(actions.slice(0, 100)));
}

async function syncGmail(env){
  const accessToken = await getAccessToken(env);
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", MONEY_QUERY);
  listUrl.searchParams.set("maxResults", "20");

  const listResponse = await fetch(listUrl.toString(), {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });

  const listData = await listResponse.json();

  if(!listResponse.ok){
    throw new Error(listData.error?.message || "Could not read Gmail");
  }

  const existing = await getActions(env);
  const byId = new Map(existing.map(action => [action.gmailId || action.id, action]));
  const messages = listData.messages || [];

  for(const message of messages){
    if(byId.has(message.id)){
      continue;
    }

    const detail = await fetchMessage(accessToken, message.id);
    const action = messageToAction(detail);

    if(action){
      byId.set(message.id, action);
    }
  }

  const actions = [...byId.values()]
    .filter(action => isActionableMoney(`${action.subject || ""} ${action.nextAction || ""}`))
    .sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 100);

  await saveActions(env, actions);
  return actions;
}

async function fetchMessage(accessToken, id){
  const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
  detailUrl.searchParams.set("format", "metadata");
  detailUrl.searchParams.set("metadataHeaders", "Subject");
  detailUrl.searchParams.append("metadataHeaders", "From");
  detailUrl.searchParams.append("metadataHeaders", "Date");

  const response = await fetch(detailUrl.toString(), {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });

  const data = await response.json();

  if(!response.ok){
    throw new Error(data.error?.message || "Could not read Gmail message");
  }

  return data;
}

function headerValue(message, name){
  const headers = message.payload?.headers || [];
  const found = headers.find(header => header.name.toLowerCase() === name.toLowerCase());
  return found?.value || "";
}

function messageToAction(message){
  const subject = headerValue(message, "Subject") || "Money email";
  const from = headerValue(message, "From");
  const date = headerValue(message, "Date");
  const snippet = message.snippet || "";
  const text = `${subject} ${snippet}`;

  if(!isActionableMoney(text)){
    return null;
  }

  const amount = extractAmount(text);
  const reason = getActionReason(text);
  const priority = /overdue|final notice|failed|declined|due soon|urgent|action required|payment reminder|minimum payment/i.test(text) ? "must" : "soon";

  const createdAt = safeIsoDate(date) || new Date(Number(message.internalDate || Date.now())).toISOString();

  return {
    id:`gmail-${message.id}`,
    gmailId:message.id,
    from,
    subject,
    type:"money",
    moneyStatus:"action_needed",
    reason,
    priority,
    due:"",
    amount,
    nextAction:`Check Gmail: ${snippet}`,
    done:false,
    financeImported:false,
    createdAt,
    gmailUrl:`https://mail.google.com/mail/u/0/#inbox/${message.id}`
  };
}

function isActionableMoney(text){
  const value = String(text || "");
  const actionWords = /(payment due|due soon|overdue|invoice|bill|renewal|subscription|direct debit|standing order|klarna|minimum payment|payment reminder|action required|failed payment|upcoming payment|pay by|amount due|balance due|please pay|scheduled payment)/i;
  const receiptWords = /(receipt|your receipt|order confirmation|thanks for your order|your order is confirmed|delivered|takeaway|uber eats|deliveroo order|just eat|food order|paid successfully|payment received|thanks for your payment|you paid|purchase confirmation)/i;

  if(!actionWords.test(value)){
    return false;
  }

  if(receiptWords.test(value) && !/(amount due|balance due|overdue|failed payment|payment due|due soon|pay by|action required|minimum payment)/i.test(value)){
    return false;
  }

  return true;
}

function getActionReason(text){
  const value = String(text || "");

  if(/overdue|final notice/i.test(value)) return "overdue";
  if(/failed payment|declined/i.test(value)) return "failed payment";
  if(/payment due|due soon|pay by|amount due|balance due|minimum payment/i.test(value)) return "payment due";
  if(/invoice|bill/i.test(value)) return "bill or invoice";
  if(/renewal|subscription|direct debit|standing order|upcoming payment/i.test(value)) return "upcoming payment";
  if(/klarna/i.test(value)) return "pay later";
  if(/action required|reminder/i.test(value)) return "action required";

  return "money action";
}

function safeIsoDate(value){
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function extractAmount(text){
  const match = String(text).match(/£\s?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/);

  if(!match){
    return 0;
  }

  return Number(match[1].replaceAll(",", "")) || 0;
}
