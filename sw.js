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
