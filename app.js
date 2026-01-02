
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

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();
const messaging = firebase.messaging();

let currentUser, myPeer, activeChatID, currentCall, localStream, dataConn, isSignup = false;

// ১. অথেন্টিকেশন (Signup/Login)
document.getElementById('auth-toggle').onclick = () => {
    isSignup = !isSignup;
    document.getElementById('signup-fields').classList.toggle('hidden');
    document.getElementById('btn-auth-submit').innerText = isSignup ? "Sign Up" : "Login";
};

document.getElementById('btn-auth-submit').onclick = async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    const name = document.getElementById('auth-name').value;
    const avatar = document.getElementById('auth-avatar').files[0];

    try {
        if(isSignup) {
            const res = await auth.createUserWithEmailAndPassword(email, pass);
            let url = "";
            if(avatar) {
                const ref = storage.ref(`avatars/${res.user.uid}`);
                await ref.put(avatar);
                url = await ref.getDownloadURL();
            }
            await db.ref('users/' + res.user.uid).set({ name, email, avatar: url, uid: res.user.uid, status: 'online' });
        } else {
            await auth.signInWithEmailAndPassword(email, pass);
        }
    } catch(e) { alert(e.message); }
};

document.getElementById('btn-google').onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());

auth.onAuthStateChanged(user => {
    if(user) {
        currentUser = user;
        document.getElementById('auth-container').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        initApp();
    } else {
        document.getElementById('auth-container').classList.remove('hidden');
        document.getElementById('app-container').classList.add('hidden');
    }
});

// ২. মেইন অ্যাপ লজিক
function initApp() {
    myPeer = new Peer(currentUser.uid);
    const userRef = db.ref('users/' + currentUser.uid);
    userRef.update({ status: 'online' });
    userRef.onDisconnect().update({ status: 'offline', last_seen: firebase.database.ServerValue.TIMESTAMP });

    userRef.on('value', s => {
        document.getElementById('my-display-name').innerText = s.val().name;
        document.getElementById('my-avatar').src = s.val().avatar || 'https://via.placeholder.com/40';
    });

    // কল লিসেনার
    db.ref('signals/' + currentUser.uid).on('value', snap => {
        const signal = snap.val();
        if(signal) {
            if(signal.status === 'dialing') {
                document.getElementById('ringtone').play();
                document.getElementById('incoming-modal').classList.remove('hidden');
                document.getElementById('caller-name').innerText = signal.fromName;
            } else if(signal.status === 'accepted') {
                document.getElementById('dialtone').pause();
            } else if(signal.status === 'ended') {
                cleanupCall();
            }
        } else {
            document.getElementById('incoming-modal').classList.add('hidden');
            document.getElementById('ringtone').pause();
        }
    });

    myPeer.on('call', call => { currentCall = call; });
    myPeer.on('connection', conn => {
        conn.on('data', data => { if(data.type === 'img') appendMsg({type:'img', blob:data.blob, sender:'rec'}); });
    });

    loadContacts();
    setupFCM();
}

// ৩. চ্যাট ও ইমেজ (P2P)
function loadContacts() {
    db.ref('users').on('value', snap => {
        const list = document.getElementById('user-list');
        list.innerHTML = "";
        snap.forEach(u => {
            if(u.key !== currentUser.uid) {
                const d = u.val();
                const status = d.status === 'online' ? '<small style="color:green">Online</small>' : '<small>Offline</small>';
                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `<img class="avatar" src="${d.avatar || 'https://via.placeholder.com/40'}"> <div><b>${d.name}</b><br>${status}</div>`;
                div.onclick = () => selectChat(d.uid);
                list.appendChild(div);
            }
        });
    });
}

function selectChat(uid) {
    activeChatID = uid;
    document.getElementById('chat-controls').classList.remove('hidden');
    dataConn = myPeer.connect(uid);
    const room = [currentUser.uid, uid].sort().join('_');
    db.ref('msgs/' + room).on('value', s => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        s.forEach(m => appendMsg(m.val()));
        box.scrollTop = box.scrollHeight;
    });
}

function appendMsg(d) {
    const box = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `msg ${d.sender === currentUser.uid ? 'sent' : 'received'}`;
    if(d.type === 'text') div.innerText = d.text;
    else div.innerHTML = `<img src="${d.blob}"><br><a href="${d.blob}" download="vimo.png">Download</a>`;
    box.appendChild(div);
}

document.getElementById('send-btn').onclick = () => {
    const text = document.getElementById('msg-input').value;
    const room = [currentUser.uid, activeChatID].sort().join('_');
    db.ref('msgs/' + room).push({ sender: currentUser.uid, text, type: 'text' });
    document.getElementById('msg-input').value = "";
};

document.getElementById('img-btn').onclick = () => document.getElementById('img-input').click();
document.getElementById('img-input').onchange = (e) => {
    const reader = new FileReader();
    reader.onload = () => {
        dataConn.send({ type: 'img', blob: reader.result });
        appendMsg({ sender: currentUser.uid, type: 'img', blob: reader.result });
    };
    reader.readAsDataURL(e.target.files[0]);
};

// ৪. কলিং সিস্টেম
async function startCall(mode) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if(mode === 'audio') localStream.getVideoTracks()[0].enabled = false;
    document.getElementById('dialtone').play();
    db.ref('signals/' + activeChatID).set({ status: 'dialing', from: currentUser.uid, fromName: document.getElementById('my-display-name').innerText, mode });
    const call = myPeer.call(activeChatID, localStream);
    handleCallUI(call);
}

document.getElementById('accept-btn').onclick = async () => {
    document.getElementById('ringtone').pause();
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    db.ref('signals/' + currentUser.uid).update({ status: 'accepted' });
    currentCall.answer(localStream);
    handleCallUI(currentCall);
};

function handleCallUI(call) {
    currentCall = call;
    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('local-video').srcObject = localStream;
    call.on('stream', s => document.getElementById('remote-video').srcObject = s);
}

function cleanupCall() {
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('call-overlay').classList.add('hidden');
    document.getElementById('ringtone').pause();
    document.getElementById('dialtone').pause();
}

document.getElementById('end-call-btn').onclick = () => {
    db.ref('signals/' + activeChatID).set({ status: 'ended' });
    db.ref('signals/' + currentUser.uid).set({ status: 'ended' });
    cleanupCall();
};

// ৫. FCM নোটিফিকেশন
async function setupFCM() {
    try {
        const token = await messaging.getToken({ vapidKey });
        db.ref('users/' + currentUser.uid).update({ fcmToken: token });
    } catch(e) {}
}

document.getElementById('audio-call-btn').onclick = () => startCall('audio');
document.getElementById('video-call-btn').onclick = () => startCall('video');
document.getElementById('logout-btn').onclick = () => auth.signOut();
