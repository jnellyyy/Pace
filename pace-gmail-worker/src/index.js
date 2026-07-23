const TOKEN_KEY = "google_tokens";
const ACTIONS_KEY = "pace_email_actions";
const PURCHASES_KEY = "pace_email_purchases";
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

const PURCHASE_TERMS = [
  "\"order confirmation\"",
  "\"your order\"",
  "\"thanks for your order\"",
  "\"purchase confirmation\"",
  "\"order has shipped\"",
  "\"has shipped\"",
  "\"has been dispatched\"",
  "dispatched",
  "\"out for delivery\"",
  "\"arriving\"",
  "\"delivery expected\"",
  "\"estimated delivery\"",
  "\"tracking number\"",
  "\"track your order\"",
  "\"receipt\""
].join(" OR ");

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

      if(url.pathname === "/sync-purchases"){
        requireAppAccess(request, env);
        const purchases = await syncPurchases(env, url);
        return corsResponse({ ok:true, purchases }, env);
      }

      if(url.pathname === "/actions"){
        requireAppAccess(request, env);
        return corsResponse({ ok:true, actions:await getActions(env) }, env);
      }

      if(url.pathname === "/purchases"){
        requireAppAccess(request, env);
        return corsResponse({ ok:true, purchases:await getPurchases(env) }, env);
      }

      if(url.pathname === "/purchases/update"){
        requireAppAccess(request, env);
        const purchase = await updatePurchase(request, env);
        return corsResponse({ ok:true, purchase }, env);
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
    ctx.waitUntil(Promise.allSettled([
      syncGmail(env),
      syncPurchases(env)
    ]));
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

  const firstSync = await Promise.allSettled([
    syncGmail(env),
    syncPurchases(env)
  ]);

  const failedSync = firstSync.find(result => result.status === "rejected");

  if(failedSync){
    await env.PACE_GMAIL_KV.put("last_sync_error", failedSync.reason?.message || "Gmail connected, but first sync failed");
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

async function getPurchases(env){
  const saved = await env.PACE_GMAIL_KV.get(PURCHASES_KEY, "json");
  return Array.isArray(saved) ? saved : [];
}

async function getDebugInfo(env){
  const tokens = await getTokens(env);
  const actions = await getActions(env);
  const purchases = await getPurchases(env);
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
    purchaseCount:purchases.length,
    lastSyncError:lastSyncError || ""
  };
}

async function saveActions(env, actions){
  await env.PACE_GMAIL_KV.put(ACTIONS_KEY, JSON.stringify(actions.slice(0, 100)));
}

async function savePurchases(env, purchases){
  await env.PACE_GMAIL_KV.put(PURCHASES_KEY, JSON.stringify(purchases.slice(0, 250)));
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

function purchaseQueryFromUrl(url){
  const rawDays = Number(url?.searchParams?.get("days")) || 180;
  const days = Math.min(Math.max(Math.round(rawDays), 14), 365);

  return [
    `newer_than:${days}d`,
    `(${PURCHASE_TERMS})`,
    "-\"payment due\"",
    "-\"amount due\"",
    "-\"balance due\"",
    "-overdue",
    "-\"minimum payment\"",
    "-\"food order\"",
    "-\"takeaway\"",
    "-\"uber eats\"",
    "-\"deliveroo order\"",
    "-\"just eat\""
  ].join(" ");
}

async function syncPurchases(env, url = null){
  const accessToken = await getAccessToken(env);
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", purchaseQueryFromUrl(url));
  listUrl.searchParams.set("maxResults", "100");

  const existing = await getPurchases(env);
  const byId = new Map(existing.map(purchase => [purchase.gmailId || purchase.id, purchase]));
  const messages = [];
  let pageToken = "";

  do{
    const pageUrl = new URL(listUrl.toString());

    if(pageToken){
      pageUrl.searchParams.set("pageToken", pageToken);
    }

    const listResponse = await fetch(pageUrl.toString(), {
      headers:{ Authorization:`Bearer ${accessToken}` }
    });

    const listData = await listResponse.json();

    if(!listResponse.ok){
      throw new Error(listData.error?.message || "Could not read Gmail purchases");
    }

    messages.push(...(listData.messages || []));
    pageToken = listData.nextPageToken || "";
  }while(pageToken && messages.length < 250);

  for(const message of messages){
    const saved = byId.get(message.id);
    const detail = await fetchMessage(accessToken, message.id, "full");
    const purchase = messageToPurchase(detail, saved);

    if(purchase){
      byId.set(message.id, purchase);
    }
  }

  const purchases = [...byId.values()]
    .filter(purchase => !purchase.hidden)
    .sort((a,b) => {
      if(Boolean(a.received) !== Boolean(b.received)) return a.received ? 1 : -1;
      return String(a.expectedDate || "9999").localeCompare(String(b.expectedDate || "9999"))
        || new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    })
    .slice(0, 250);

  await savePurchases(env, purchases);
  return purchases;
}

async function updatePurchase(request, env){
  const body = await readJson(request);
  const id = body.gmailId || body.id;

  if(!id){
    throw new Error("Missing purchase id");
  }

  const purchases = await getPurchases(env);
  const index = purchases.findIndex(purchase => (purchase.gmailId || purchase.id) === id || purchase.id === id);

  if(index === -1){
    throw new Error("Purchase not found");
  }

  const purchase = {
    ...purchases[index],
    itemName:String(body.itemName ?? purchases[index].itemName ?? "").trim() || purchases[index].itemName,
    merchant:String(body.merchant ?? purchases[index].merchant ?? "").trim() || purchases[index].merchant,
    expectedDate:String(body.expectedDate ?? purchases[index].expectedDate ?? "").slice(0,10),
    amount:Number.isFinite(Number(body.amount)) ? Number(body.amount) : purchases[index].amount,
    deliveryStatus:String(body.deliveryStatus ?? purchases[index].deliveryStatus ?? "").trim() || purchases[index].deliveryStatus,
    note:String(body.note ?? purchases[index].note ?? "").trim(),
    received:Boolean(body.received),
    receivedAt:body.received ? (body.receivedAt || new Date().toISOString()) : "",
    hidden:Boolean(body.hidden),
    updatedAt:new Date().toISOString()
  };

  purchases[index] = purchase;
  await savePurchases(env, purchases);
  return purchase;
}

async function readJson(request){
  try{
    return await request.json();
  }catch(error){
    return {};
  }
}

async function fetchMessage(accessToken, id, format = "metadata"){
  const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
  detailUrl.searchParams.set("format", format);

  if(format === "metadata"){
    detailUrl.searchParams.set("metadataHeaders", "Subject");
    detailUrl.searchParams.append("metadataHeaders", "From");
    detailUrl.searchParams.append("metadataHeaders", "Date");
  }

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

function messageToPurchase(message, existing = null){
  const subject = headerValue(message, "Subject") || "Purchase email";
  const from = headerValue(message, "From");
  const date = headerValue(message, "Date");
  const snippet = message.snippet || "";
  const bodyText = messageBodyText(message).slice(0, 7000);
  const text = `${subject} ${snippet} ${bodyText}`;

  if(!isPurchaseMessage(text)){
    return null;
  }

  const createdAt = safeIsoDate(date) || new Date(Number(message.internalDate || Date.now())).toISOString();
  const expectedDate = existing?.expectedDate || extractExpectedDate(text, createdAt);
  const amount = existing?.amount || extractAmount(text);
  const merchant = existing?.merchant || cleanSenderName(from);
  const itemName = existing?.itemName || extractItemName(subject, merchant, bodyText);

  return {
    id:`purchase-${message.id}`,
    gmailId:message.id,
    type:"purchase",
    from,
    merchant,
    subject,
    itemName,
    orderedAt:createdAt.slice(0,10),
    expectedDate,
    amount,
    deliveryStatus:getDeliveryStatus(text),
    snippet,
    received:Boolean(existing?.received),
    receivedAt:existing?.receivedAt || "",
    note:existing?.note || "",
    hidden:Boolean(existing?.hidden),
    createdAt:existing?.createdAt || createdAt,
    updatedAt:existing?.updatedAt || createdAt,
    gmailUrl:`https://mail.google.com/mail/u/0/#inbox/${message.id}`
  };
}

function messageBodyText(message){
  const chunks = [];

  function walk(part){
    if(!part) return;

    if(part.body?.data && /^text\/(plain|html)$/i.test(part.mimeType || "")){
      chunks.push(decodeBody(part.body.data, part.mimeType));
    }

    (part.parts || []).forEach(walk);
  }

  walk(message.payload);

  return chunks.join("\n").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeBody(data, mimeType){
  try{
    const base64 = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64);
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    const text = new TextDecoder("utf-8").decode(bytes);

    if(/^text\/html$/i.test(mimeType || "")){
      return text
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&pound;/g, "£")
        .replace(/[ \t\r\f\v]+/g, " ");
    }

    return text;
  }catch(error){
    return "";
  }
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

function isPurchaseMessage(text){
  const value = String(text || "");
  const purchaseWords = /(order confirmation|your order|thanks for your order|purchase confirmation|receipt|invoice|has shipped|dispatched|out for delivery|arriving|delivery expected|estimated delivery|tracking number|track your order|delivered)/i;
  const excludedFood = /(food order|takeaway|uber eats|deliveroo order|just eat|restaurant)/i;
  const excludedMoneyOnly = /(payment due|amount due|balance due|overdue|minimum payment|failed payment|direct debit|standing order)/i;

  if(!purchaseWords.test(value)) return false;
  if(excludedFood.test(value)) return false;
  if(excludedMoneyOnly.test(value) && !/(order|receipt|shipped|delivery|tracking|delivered)/i.test(value)) return false;

  return true;
}

function cleanSenderName(from){
  const value = String(from || "").replace(/<[^>]+>/g, "").replaceAll("\"", "").trim();
  return value || "Unknown shop";
}

function extractItemName(subject, merchant, bodyText = ""){
  let value = String(subject || "Purchase").trim();
  value = value
    .replace(/^re:\s*/i, "")
    .replace(/^fwd:\s*/i, "")
    .replace(/^(your|order|purchase|receipt|delivery|dispatch|shipment)\s+/i, "")
    .replace(/^(thanks for your order|order confirmation|purchase confirmation|your order|your receipt|receipt)[:\s-]*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const genericSubject = !value
    || value.length < 4
    || /(order|purchase|receipt|dispatch|shipment|delivery|confirmation|confirmed|has shipped|tracking|invoice)/i.test(value);

  if(!genericSubject){
    return value.slice(0, 120);
  }

  const bodyCandidate = extractItemNameFromBody(bodyText);

  if(bodyCandidate){
    return bodyCandidate;
  }

  return merchant ? `Purchase from ${merchant}` : "Purchase";
}

function extractItemNameFromBody(bodyText){
  const lines = String(bodyText || "")
    .split(/\n| {2,}/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const headings = /(item|items|product|products|order details|order summary|your order|shipment contains)/i;

  for(let index = 0; index < lines.length; index += 1){
    if(!headings.test(lines[index])) continue;

    for(const line of lines.slice(index + 1, index + 7)){
      if(isLikelyItemLine(line)){
        return line.slice(0, 120);
      }
    }
  }

  const aroundDelivery = lines.find(line => /arriving|delivery|dispatched|shipped/i.test(line));

  if(aroundDelivery){
    const deliveryIndex = lines.indexOf(aroundDelivery);
    const nearby = lines.slice(Math.max(0, deliveryIndex - 3), deliveryIndex + 4).find(isLikelyItemLine);

    if(nearby){
      return nearby.slice(0, 120);
    }
  }

  return "";
}

function isLikelyItemLine(line){
  const value = String(line || "").trim();

  if(value.length < 4 || value.length > 120) return false;
  if(/https?:|www\.|@|unsubscribe|privacy|terms|account|password|customer service|help centre/i.test(value)) return false;
  if(/order number|order no|tracking|track your order|delivery|shipping|dispatch|arriv|subtotal|total|vat|payment|paid|billing|invoice|address|postcode|receipt/i.test(value)) return false;
  if(/^£\s?\d|^\d{1,2}[\/.-]\d{1,2}|^\d+\s*x\s+/i.test(value)) return false;
  if(/^(hi|hello|dear|thanks|thank you|view|manage|download|shop|continue|recommended|because|you may|returns?)\b/i.test(value)) return false;

  return /[a-z]{3,}/i.test(value);
}

function getDeliveryStatus(text){
  const value = String(text || "");

  if(/out for delivery/i.test(value)) return "out for delivery";
  if(/delivered/i.test(value)) return "delivered by courier";
  if(/has shipped|dispatched|tracking number|track your order/i.test(value)) return "shipped";
  if(/arriving|delivery expected|estimated delivery/i.test(value)) return "expected";
  return "ordered";
}

function extractExpectedDate(text, createdAt){
  const value = String(text || "").replace(/\s+/g, " ");
  const base = new Date(createdAt || Date.now());

  if(/\btomorrow\b/i.test(value)){
    const date = new Date(base);
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0,10);
  }

  if(/\btoday\b/i.test(value)){
    return base.toISOString().slice(0,10);
  }

  const patterns = [
    /(?:arriving|arrives|delivered by|delivery expected|estimated delivery|expected by|due by|by)\s+(?:on\s+)?(?:[a-z]+,\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/i,
    /(?:arriving|arrives|delivered by|delivery expected|estimated delivery|expected by|due by|by)\s+(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i,
    /between\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+and\s+\d{1,2}/i
  ];

  for(const pattern of patterns){
    const match = value.match(pattern);

    if(!match) continue;

    if(Number(match[1])){
      return dateFromParts(match[1], match[2], match[3], base);
    }

    return dateFromParts(match[2], match[1], match[3], base);
  }

  return "";
}

function dateFromParts(day, monthName, explicitYear, base){
  const month = monthIndex(monthName);
  if(month === -1) return "";

  let year = explicitYear ? Number(explicitYear) : base.getFullYear();
  let date = new Date(year, month, Number(day));

  if(!explicitYear && date < base){
    date = new Date(year + 1, month, Number(day));
  }

  if(Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0,10);
}

function monthIndex(value){
  const key = String(value || "").toLowerCase().slice(0,3);
  return ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(key);
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
