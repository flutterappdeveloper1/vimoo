importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js');

// আপনার Firebase Config এখানে পুনরায় দিন
firebase.initializeApp({
    apiKey: "AIzaSyDCKr5EaLVrDkV4TG00ortCiTWIAo5zgjc",
    messagingSenderId: "258135136638",
    appId: "1:258135136638:web:2f0e0086213343177bbb2f",
    projectId: "vimo-d453c",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    self.registration.showNotification("Vimo  Call", {
        body: payload.data.fromName + " is calling you!",
        icon: "/icon.png",
        data: { url: self.location.origin }
    });
});
