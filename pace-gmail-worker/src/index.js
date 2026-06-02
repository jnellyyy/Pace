const TOKEN_KEY = "google_tokens";
const ACTIONS_KEY = "pace_email_actions";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly"
].join(" ");

const MONEY_QUERY = [
  "newer_than:60d",
  "(payment OR payments OR pay OR due OR overdue OR invoice OR bill OR bills OR renewal OR subscription OR charge OR Klarna OR PayPal OR direct debit OR standing order OR balance)"
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
    "Access-Control-Allow-Origin": env.APP_ORIGIN || "*",
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

  await syncGmail(env);

  return redirectTo(getAppUrl(env, "gmail=connected"));
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
    byId.set(message.id, action);
  }

  const actions = [...byId.values()]
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
  const amount = extractAmount(text);
  const priority = /overdue|final notice|failed|declined|due soon|urgent|reminder/i.test(text) ? "must" : "soon";

  const createdAt = safeIsoDate(date) || new Date(Number(message.internalDate || Date.now())).toISOString();

  return {
    id:`gmail-${message.id}`,
    gmailId:message.id,
    from,
    subject,
    type:"money",
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
