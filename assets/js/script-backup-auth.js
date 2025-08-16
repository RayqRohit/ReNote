/* ---------- Firebase imports ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup,
    onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
    getFirestore,
    collection, addDoc, doc, updateDoc, deleteDoc,
    query, where, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Firebase config ---------- */
const firebaseConfig = {
    apiKey: "AIzaSyBDU8xlK7LHmkR3de8d7DseFO2Zu9SHHYE",
    authDomain: "re-notes-e593f.firebaseapp.com",
    projectId: "re-notes-e593f",
    storageBucket: "re-notes-e593f.firebasestorage.app",
    messagingSenderId: "332994702447",
    appId: "1:332994702447:web:1b154759c684207399b19a"
};

/* ---------- Init ---------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/* ---------- DOM ---------- */
const notesContainer = document.querySelector(".notes__container");
const createBtn = document.getElementById("createNoteBtn");
const signInBtn = document.getElementById("signinBtn");
const signOutBtn = document.getElementById("signoutBtn");

/* ---------- State ---------- */
let unsubscribe = null;
let pendingFocusId = null;
const saveTimers = new Map();

/* ---------- UI helpers ---------- */
const makeCard = ({ id, text }) => {
    const card = document.createElement("div");
    card.className = "note";
    card.dataset.id = id;

    const del = document.createElement("i");
    del.className = "ri-delete-bin-line";
    del.id = "deleteNote";

    const p = document.createElement("p");
    p.className = "input__box";
    p.contentEditable = "true";
    p.spellcheck = "false";
    p.textContent = text || "";

    card.append(del, p);
    return card;
};

const focusInputBox = (el) => {
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
};

/* ---------- Firestore helpers ---------- */
const addNoteToFirebase = async (uid, text = "") =>
    (await addDoc(collection(db, "notes"), {
        userId: uid,
        text,
        order: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    })).id;

const updateNoteInFirebase = (id, text) =>
    updateDoc(doc(db, "notes", id), { text, updatedAt: serverTimestamp() });

const deleteNoteFromFirebase = (id) =>
    deleteDoc(doc(db, "notes", id));

/* ---------- Real-time listener ---------- */
const startListener = (uid) => {
    if (unsubscribe) unsubscribe();

    const qNotes = query(
        collection(db, "notes"),
        where("userId", "==", uid),
        orderBy("order", "desc")
    );

    unsubscribe = onSnapshot(qNotes, (snap) => {
        notesContainer.innerHTML = "";
        snap.forEach(d => {
            notesContainer.appendChild(
                makeCard({ id: d.id, text: d.data().text || "" })
            );
        });

        if (pendingFocusId) {
            const box = notesContainer.querySelector(
                `.note[data-id="${pendingFocusId}"] .input__box`
            );
            if (box) focusInputBox(box);
            pendingFocusId = null;
        }
    }, (err) => console.error("onSnapshot error:", err));
};

/* ---------- Debounced save ---------- */
const debouncedSave = (id, text, delay = 2000) => {
    if (saveTimers.has(id)) clearTimeout(saveTimers.get(id));
    const t = setTimeout(() => {
        updateNoteInFirebase(id, text);
        saveTimers.delete(id);
    }, delay);
    saveTimers.set(id, t);
};

/* ---------- UI events ---------- */
const addNote = async () => {
    const user = auth.currentUser;
    if (!user) return;
    pendingFocusId = await addNoteToFirebase(user.uid);
};

const deleteNewestNote = async () => {
    const first = notesContainer.querySelector(".note");
    if (first) await deleteNoteFromFirebase(first.dataset.id);
};

createBtn.addEventListener("click", addNote);

notesContainer.addEventListener("click", async (e) => {
    if (e.target.id !== "deleteNote") return;
    await deleteNoteFromFirebase(e.target.closest(".note").dataset.id);
});

notesContainer.addEventListener("input", (e) => {
    if (!e.target.classList.contains("input__box")) return;
    debouncedSave(
        e.target.closest(".note").dataset.id,
        e.target.innerText.replace(/\r\n/g, "\n")
    );
});

notesContainer.addEventListener("blur", (e) => {
    if (!e.target.classList.contains("input__box")) return;
    const id = e.target.closest(".note").dataset.id;
    const text = e.target.innerText.replace(/\r\n/g, "\n");
    if (saveTimers.has(id)) {
        clearTimeout(saveTimers.get(id));
        saveTimers.delete(id);
    }
    updateNoteInFirebase(id, text);
}, true);

/* ---------- Shortcuts ---------- */
document.addEventListener("keydown", (e) => {
    const accel = e.ctrlKey || e.metaKey;
    if (accel && e.key.toLowerCase() === "d") {
        e.preventDefault();
        addNote();
    }
    if (accel && e.key.toLowerCase() === "q") {
        e.preventDefault();
        deleteNewestNote();
    }
});

/* ---------- Auth buttons ---------- */
signInBtn.addEventListener("click", async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        console.error("Sign-in error:", err.code, err.message);
        alert(`Sign-in failed: ${err.message}`);
    }
});

signOutBtn.addEventListener("click", () => signOut(auth));

/* ---------- Auth state ---------- */
onAuthStateChanged(auth, (user) => {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }

    if (user) {
        // Hide sign-in, show sign-out and create button
        signInBtn.style.display = "none";
        signOutBtn.style.display = "inline-flex";
        createBtn.style.display = "inline-flex";

        // Start listening to user's notes
        startListener(user.uid);
    } else {
        // Show sign-in, hide sign-out and create button
        signInBtn.style.display = "inline-flex";
        signOutBtn.style.display = "none";
        createBtn.style.display = "none";

        // Clear notes container
        notesContainer.innerHTML = "";
    }
});
