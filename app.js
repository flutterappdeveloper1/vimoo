async function requestNotificationPermission() {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            // এইgetToken ফাংশনটি আপনার vapidKey ব্যবহার করবে
            const token = await getToken(messaging, { vapidKey: vapidKey });
            if (token) {
                console.log("FCM Token:", token);
                // এই টোকেনটি ডাটাবেজে ইউজারের আন্ডারে সেভ করুন
                await update(ref(db, 'users/' + currentUser.uid), { fcmToken: token });
            }
        } else {
            console.log("Notification permission denied.");
        }
    } catch (err) {
        console.log("An error occurred while retrieving token:", err);
    }
}
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getDatabase, ref, set, update, onValue, push, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging.js";

// --- 🟢 Firebase Config 🟢 ---
const firebaseConfig = {
  apiKey: "AIzaSyDCKr5EaLVrDkV4TG00ortCiTWIAo5zgjc",
  authDomain: "vimo-d453c.firebaseapp.com",
  databaseURL: "https://vimo-d453c-default-rtdb.firebaseio.com",
  projectId: "vimo-d453c",
  storageBucket: "vimo-d453c.firebasestorage.app",
  messagingSenderId: "258135136638",
  appId: "1:258135136638:web:2f0e0086213343177bbb2f",
  measurementId: "G-6WLGSWKVW9"
};

// 🔴 এইখানে আপনার VAPID Key বসান 🔴
const vapidKey = "BFjas7nnmZEl0lTwcVDLs5klTCnpB86eqfj_x7Cg-tpJW6HMsEeZnvyCj9u3J-pLr0vfpO1CLp3wiXH6k3VNXEs"; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const messaging = getMessaging(app);

// Variables
let currentUser, myPeer, activeChatID, currentCall, localStream, dataConn;
const ringtone = document.getElementById('ringtone');
const dialtone = document.getElementById('dialtone');

// --- ১. অথেন্টিকেশন ---
document.getElementById('auth-btn').onclick = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    const name = document.getElementById('auth-name').value;
    const isLogin = document.getElementById('signup-fields').classList.contains('hidden');

    try {
        if (isLogin) await signInWithEmailAndPassword(auth, email, pass);
        else {
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            await set(ref(db, 'users/' + res.user.uid), { name, email, uid: res.user.uid, status: 'online' });
        }
    } catch (e) { alert(e.message); }
};

document.getElementById('google-btn').onclick = async () => {
    const provider = new GoogleAuthProvider();
    const res = await signInWithPopup(auth, provider);
    await update(ref(db, 'users/' + res.user.uid), { name: res.user.displayName, avatar: res.user.photoURL, uid: res.user.uid, status: 'online' });
};

onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        initApp();
    } else {
        document.getElementById('auth-container').classList.remove('hidden');
        document.getElementById('app-container').classList.add('hidden');
    }
});

// --- ২. অ্যাপ লজিক ---
function initApp() {
    myPeer = new Peer(currentUser.uid);
    update(ref(db, 'users/' + currentUser.uid), { status: 'online' });
    onDisconnect(ref(db, 'users/' + currentUser.uid)).update({ status: 'offline', last_seen: serverTimestamp() });

    // কল সিগন্যাল লিসেনার
    onValue(ref(db, 'signals/' + currentUser.uid), snap => {
        const signal = snap.val();
        if (signal) {
            if (signal.status === 'dialing') {
                ringtone.play();
                document.getElementById('incoming-modal').classList.remove('hidden');
                document.getElementById('caller-name').innerText = signal.fromName;
            } else if (signal.status === 'accepted') dialtone.pause();
            else if (signal.status === 'ended') cleanupCall();
        } else {
            document.getElementById('incoming-modal').classList.add('hidden');
            ringtone.pause();
        }
    });

    myPeer.on('call', call => { currentCall = call; });
    myPeer.on('connection', conn => {
        conn.on('data', data => { if (data.type === 'img') appendImg(data.blob, 'received'); });
    });

    loadUsers();
}

function loadUsers() {
    onValue(ref(db, 'users'), snap => {
        const list = document.getElementById('user-list');
        list.innerHTML = "";
        snap.forEach(u => {
            if (u.key !== currentUser.uid) {
                const d = u.val();
                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `<img class="avatar" src="${d.avatar || 'https://via.placeholder.com/45'}"> <div><b>${d.name}</b><br><small>${d.status}</small></div>`;
                div.onclick = () => selectUser(d.uid);
                list.appendChild(div);
            }
        });
    });
}

function selectUser(uid) {
    activeChatID = uid;
    document.getElementById('chat-controls').classList.remove('hidden');
    dataConn = myPeer.connect(uid);
    const roomID = [currentUser.uid, uid].sort().join('_');
    onValue(ref(db, 'msgs/' + roomID), s => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        s.forEach(m => {
            const d = m.val();
            const div = document.createElement('div');
            div.className = `msg ${d.sender === currentUser.uid ? 'sent' : 'received'}`;
            div.innerText = d.text;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- ৩. কলিং সিস্টেম ---
document.getElementById('video-call-btn').onclick = () => makeCall('video');
document.getElementById('audio-call-btn').onclick = () => makeCall('audio');

async function makeCall(mode) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (mode === 'audio') localStream.getVideoTracks()[0].enabled = false;
    
    dialtone.play();
    set(ref(db, 'signals/' + activeChatID), { status: 'dialing', from: currentUser.uid, fromName: auth.currentUser.displayName || 'Friend', mode });
    
    const call = myPeer.call(activeChatID, localStream);
    handleCall(call);
}

document.getElementById('accept-btn').onclick = async () => {
    ringtone.pause();
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    update(ref(db, 'signals/' + currentUser.uid), { status: 'accepted' });
    currentCall.answer(localStream);
    handleCall(currentCall);
};

function handleCall(call) {
    currentCall = call;
    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('local-video').srcObject = localStream;
    call.on('stream', s => { document.getElementById('remote-video').srcObject = s; });
    call.on('close', cleanupCall);
}

function cleanupCall() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('call-overlay').classList.add('hidden');
    document.getElementById('incoming-modal').classList.add('hidden');
    ringtone.pause(); dialtone.pause();
}

document.getElementById('end-call-btn').onclick = () => {
    set(ref(db, 'signals/' + activeChatID), { status: 'ended' });
    set(ref(db, 'signals/' + currentUser.uid), { status: 'ended' });
    cleanupCall();
};

// হেল্পার
document.getElementById('auth-toggle').onclick = () => {
    document.getElementById('signup-fields').classList.toggle('hidden');
    document.getElementById('auth-btn').innerText = document.getElementById('signup-fields').classList.contains('hidden') ? "Login" : "Sign Up";
};

function appendImg(blob, type) {
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.innerHTML = `<img src="${blob}" style="width:100%" onclick="window.open(this.src)"><br><a href="${blob}" download="vimo_image.png">Download</a>`;
    document.getElementById('messages').appendChild(div);
}
