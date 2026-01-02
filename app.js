
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getDatabase, ref, set, update, onValue, push, onDisconnect, serverTimestamp, remove } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging.js";

// --- 🟢 আপনার Firebase Config এখানে বসান 🟢 ---
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
const vapidKey = "BFjas7nnmZEl0lTwcVDLs5klTCnpB86eqfj_x7Cg-tpJW6HMsEeZnvyCj9u3J-pLr0vfpO1CLp3wiXH6k3VNXEs";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);
const messaging = getMessaging(app);

let currentUser, myPeer, activeChatID, currentCall, localStream, dataConn;
const ringtone = document.getElementById('ringtone');
const dialtone = document.getElementById('dialtone');

// --- ১. অথেন্টিকেশন ---
document.getElementById('auth-btn').onclick = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    const name = document.getElementById('auth-name').value;
    const avatarFile = document.getElementById('auth-avatar').files[0];
    const isSignup = !document.getElementById('signup-fields').classList.contains('hidden');

    try {
        if (isSignup) {
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            let url = "";
            if(avatarFile) {
                const imgRef = sRef(storage, `avatars/${res.user.uid}`);
                await uploadBytes(imgRef, avatarFile);
                url = await getDownloadURL(imgRef);
            }
            await set(ref(db, `users/${res.user.uid}`), { name, email, avatar: url, uid: res.user.uid, status: 'online' });
        } else {
            await signInWithEmailAndPassword(auth, email, pass);
        }
    } catch (e) { alert(e.message); }
};

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, new GoogleAuthProvider());

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

// --- ২. মেইন অ্যাপ লজিক ---
async function initApp() {
    myPeer = new Peer(currentUser.uid);
    const userRef = ref(db, `users/${currentUser.uid}`);
    update(userRef, { status: 'online' });
    onDisconnect(userRef).update({ status: 'offline', last_seen: serverTimestamp() });

    onValue(userRef, s => {
        if(s.exists()){
            document.getElementById('my-display-name').innerText = s.val().name;
            document.getElementById('my-avatar').src = s.val().avatar || 'https://via.placeholder.com/40';
        }
    });

    // কল সিগন্যাল লিসেনার
    onValue(ref(db, `signals/${currentUser.uid}`), snap => {
        const signal = snap.val();
        if (signal) {
            if (signal.status === 'dialing') {
                ringtone.play();
                document.getElementById('incoming-modal').classList.remove('hidden');
                document.getElementById('caller-name').innerText = signal.fromName;
            } else if (signal.status === 'accepted') {
                dialtone.pause();
            } else if (signal.status === 'ended') {
                closeCallUI();
            }
        } else {
            document.getElementById('incoming-modal').classList.add('hidden');
            ringtone.pause();
        }
    });

    myPeer.on('call', call => { currentCall = call; });
    myPeer.on('connection', conn => {
        conn.on('data', data => {
            if(data.type === 'img') appendMsg({ type: 'img', blob: data.blob, sender: 'received' });
        });
    });

    loadUsers();
    setupFCM();
}

// --- ৩. চ্যাট ও ইমেজ শেয়ার (P2P) ---
function loadUsers() {
    onValue(ref(db, 'users'), snap => {
        const list = document.getElementById('user-list');
        list.innerHTML = "";
        snap.forEach(u => {
            if (u.key !== currentUser.uid) {
                const d = u.val();
                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `<img class="avatar" src="${d.avatar || 'https://via.placeholder.com/45'}"> 
                <div><b>${d.name}</b><br><small>${d.status === 'online' ? 'Online' : 'Offline'}</small></div>`;
                div.onclick = () => selectUser(d.uid, d.name);
                list.appendChild(div);
            }
        });
    });
}

function selectUser(uid, name) {
    activeChatID = uid;
    document.getElementById('chat-controls').classList.remove('hidden');
    document.getElementById('chat-header').classList.remove('hidden');
    document.getElementById('active-user-name').innerText = name;
    dataConn = myPeer.connect(uid);

    const roomID = [currentUser.uid, uid].sort().join('_');
    onValue(ref(db, `msgs/${roomID}`), s => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        s.forEach(m => appendMsg(m.val()));
        box.scrollTop = box.scrollHeight;
    });
}

function sendText() {
    const text = document.getElementById('msg-input').value;
    if(!text) return;
    const roomID = [currentUser.uid, activeChatID].sort().join('_');
    push(ref(db, `msgs/${roomID}`), { sender: currentUser.uid, text, type: 'text' });
    document.getElementById('msg-input').value = "";
}

function appendMsg(d) {
    const box = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `msg ${d.sender === currentUser.uid ? 'sent' : 'received'}`;
    if(d.type === 'text') div.innerText = d.text;
    else if(d.type === 'img') div.innerHTML = `<img src="${d.blob}"><br><a href="${d.blob}" download="vimo_img.png">Download</a>`;
    box.appendChild(div);
}

document.getElementById('img-btn').onclick = () => document.getElementById('img-input').click();
document.getElementById('img-input').onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
        const blob = reader.result;
        dataConn.send({ type: 'img', blob });
        appendMsg({ sender: currentUser.uid, type: 'img', blob });
    };
    reader.readAsDataURL(file);
};

// --- ৪. কলিং সিস্টেম (Sync Fix) ---
async function makeCall(mode) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if(mode === 'audio') localStream.getVideoTracks()[0].enabled = false;
    
    dialtone.play();
    set(ref(db, `signals/${activeChatID}`), { 
        status: 'dialing', from: currentUser.uid, 
        fromName: document.getElementById('my-display-name').innerText, mode 
    });

    const call = myPeer.call(activeChatID, localStream);
    setupCallUI(call);
}

document.getElementById('accept-btn').onclick = async () => {
    ringtone.pause();
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    update(ref(db, `signals/${currentUser.uid}`), { status: 'accepted' });
    currentCall.answer(localStream);
    setupCallUI(currentCall);
};

function setupCallUI(call) {
    currentCall = call;
    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('local-video').srcObject = localStream;
    call.on('stream', s => document.getElementById('remote-video').srcObject = s);
    call.on('close', closeCallUI);
}

function closeCallUI() {
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('call-overlay').classList.add('hidden');
    document.getElementById('incoming-modal').classList.add('hidden');
    ringtone.pause(); dialtone.pause();
}

document.getElementById('end-call-btn').onclick = () => {
    set(ref(db, `signals/${activeChatID}`), { status: 'ended' });
    set(ref(db, `signals/${currentUser.uid}`), { status: 'ended' });
    closeCallUI();
};

// --- ৫. FCM নোটিফিকেশন ---
async function setupFCM() {
    try {
        const token = await getToken(messaging, { vapidKey });
        if(token) update(ref(db, `users/${currentUser.uid}`), { fcmToken: token });
    } catch (e) { console.log(e); }
}
// 🔴 এই সম্পূর্ণ ফাংশনটি ফাইলের শেষে যোগ করুন:
async function setupFCM() {
    try {
        // ১. নোটিফিকেশন পারমিশন চাওয়া
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            // ২. সার্ভিস ওয়ার্কার রেজিস্ট্রেশন এবং টোকেন সংগ্রহ
            const token = await getToken(messaging, { 
                vapidKey: vapidKey 
            });

            if (token) {
                console.log("FCM Token রিসিভ হয়েছে:", token);
                // ৩. ডাটাবেজে ইউজারের প্রোফাইলে টোকেন আপডেট করা
                await update(ref(db, `users/${currentUser.uid}`), { fcmToken: token });
            }
        }
    } catch (error) {
        console.error("FCM সেটাপ করতে সমস্যা হয়েছে:", error);
    }
}

// ৪. অ্যাপ সামনে খোলা থাকলে মেসেজ রিসিভ করার লজিক
onMessage(messaging, (payload) => {
    console.log('নোটিফিকেশন রিসিভ হয়েছে (Foreground): ', payload);
    // এখানে চাইলে ইউজারকে কোনো মেসেজ বা এলার্ট দেখাতে পারেন
});
// কন্ট্রোলস
document.getElementById('send-btn').onclick = sendText;
document.getElementById('video-call-btn').onclick = () => makeCall('video');
document.getElementById('audio-call-btn').onclick = () => makeCall('audio');
document.getElementById('logout-btn').onclick = () => signOut(auth);
document.getElementById('reject-btn').onclick = () => {
    remove(ref(db, `signals/${currentUser.uid}`));
    ringtone.pause();
};
document.getElementById('toggle-cam').onclick = () => {
    const t = localStream.getVideoTracks()[0];
    t.enabled = !t.enabled;
};
document.getElementById('toggle-mic').onclick = () => {
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
};
document.getElementById('auth-toggle').onclick = () => {
    document.getElementById('signup-fields').classList.toggle('hidden');
    document.getElementById('auth-btn').innerText = document.getElementById('signup-fields').classList.contains('hidden') ? "Login" : "Sign Up";
};
