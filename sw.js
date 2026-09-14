const CACHE_NAME = "pace-app-v20260914-calm-theme";
const CACHE_PREFIX = "pace-app-";
const APP_SHELL = [
  "./",
  "index.html",
  "dashboard.html",
  "life-test.html",
  "finance-test.html",
  "finance-before-20-august-plan.md",
  "move-test.html",
  "reminders-test.html",
  "purchases-test.html",
  "email-command-test.html",
  "lists-test.html",
  "attendance-test.html",
  "quiet-time-test.html",
  "church-notes-test.html",
  "health-reset-test.html",
  "creators-test.html",
  "shoot-day-test.html",
  "bookings-test.html",
  "creator-income-test.html",
  "creator-day-test.html",
  "weekly-test.html",
  "pace-navigation.js",
  "pace-theme.css",
  "pace-shell.js",
  "finance-dashboard.css",
  "finance-dashboard.js",
  "site.webmanifest",
  "icon-32.png",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache:"reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function shouldHandle(request){
  if(request.method !== "GET"){
    return false;
  }

  const url = new URL(request.url);

  return url.origin === self.location.origin;
}

function isHtmlRequest(request){
  return request.mode === "navigate"
    || request.headers.get("accept")?.includes("text/html")
    || /\.html$/i.test(new URL(request.url).pathname);
}

async function fetchAndCache(request){
  const response = await fetch(request);

  if(response && response.ok){
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }

  return response;
}

async function cachedFirst(request){
  const cached = await caches.match(request, { ignoreSearch:true });
  const fresh = fetchAndCache(request).catch(() => cached);

  if(cached){
    fresh.catch(() => {});
    return cached;
  }

  return fresh;
}

async function navigationFallback(request){
  try{
    return await cachedFirst(request);
  }catch(error){
    return caches.match("dashboard.html") || caches.match("index.html");
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;

  if(!shouldHandle(request)){
    return;
  }

  event.respondWith(
    isHtmlRequest(request)
      ? navigationFallback(request)
      : cachedFirst(request)
  );
});

self.addEventListener("push", function(event) {
  let data = {};

  try{
    data = event.data?.json() || {};
  }catch(error){
    data = { body:event.data?.text() || "You have something to do" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Pace reminder", {
      body:data.body || "You have something to do",
      icon:"/Pace/icon-192.png",
      badge:"/Pace/icon-192.png",
      tag:data.tag || "pace-reminder",
      data:data.data || { url:"/Pace/reminders-test.html" }
    })
  );
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/Pace/reminders-test.html";

  event.waitUntil(
    self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(clients => {
      const matchingClient = clients.find(client => client.url.includes("/Pace/"));

      if(matchingClient){
        matchingClient.navigate(targetUrl);
        return matchingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
