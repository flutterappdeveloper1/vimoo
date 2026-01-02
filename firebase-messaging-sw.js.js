importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js');

// আপনার Firebase Config এখানে পুনরায় দিন
firebase.initializeApp({
    apiKey: "YOUR_API_KEY",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
    projectId: "YOUR_PROJECT_ID"
});

const messaging = firebase.messaging();

// ব্যাকগ্রাউন্ড নোটিফিকেশন হ্যান্ডেলার
messaging.onBackgroundMessage((payload) => {
    console.log('Background Message:', payload);

    const notificationTitle = payload.data.title || "Vimo Pro Call";
    const notificationOptions = {
        body: payload.data.body || "Incoming call from a friend!",
        icon: '/icon.png', // আপনার আইকন
        tag: 'call-notification',
        renotify: true,
        data: { url: self.location.origin } 
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// নোটিফিকেশনে ক্লিক করলে অ্যাপ ওপেন করা
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});