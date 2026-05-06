self.addEventListener("push", function(event) {
  const data = event.data?.json() || {};

  self.registration.showNotification(data.title || "Reminder", {
    body: data.body || "You have something to do",
    icon: "/Pace/icon-192.png"
  });
});