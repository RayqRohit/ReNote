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
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
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
    p.innerHTML = text || ""; // Changed from textContent to innerHTML

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

    const loadingSection = document.querySelector('.loading-section');
    const controlsSection = document.querySelector('.controls-section');

    // console.log('Starting listener - hiding main loader, showing notes loader');

    // Step 1: Hide main loader and show controls
    if (loadingSection) loadingSection.style.display = 'none';
    if (controlsSection) controlsSection.style.display = 'flex';

    // Step 2: Clear container and show notes loader
    notesContainer.innerHTML = `
        <div class="notes-loader">
            <i class="ri-loader-4-line"></i>
            <p>Summoning your notes...</p>
        </div>
    `;

    const qNotes = query(
        collection(db, "notes"),
        where("userId", "==", uid),
        orderBy("order", "desc")
    );

    let firstRun = true;
    unsubscribe = onSnapshot(qNotes, (snap) => {
        // console.log('Firestore snapshot received, notes count:', snap.size);

        // Step 3: Clear loader and show notes
        if (firstRun) {
            notesContainer.innerHTML = ''; // Clear the loader
            firstRun = false;
        } else {
            notesContainer.innerHTML = ''; // Clear existing notes
        }

        // Step 4: Add all notes
        snap.forEach(d => {
            notesContainer.appendChild(
                makeCard({ id: d.id, text: d.data().text || "" })
            );
        });

        // Focus logic
        if (pendingFocusId) {
            const box = notesContainer.querySelector(
                `.note[data-id="${pendingFocusId}"] .input__box`
            );
            if (box) focusInputBox(box);
            pendingFocusId = null;
        }
    }, (err) => {
        console.error("onSnapshot error:", err);
        notesContainer.innerHTML = '<p class="error-message">Error loading notes</p>';
    });
};

/* ---------- Debounced save ---------- */
const debouncedSave = (id, text, delay = 1500) => {
    if (saveTimers.has(id)) clearTimeout(saveTimers.get(id));
    const t = setTimeout(() => {
        updateNoteInFirebase(id, text);
        saveTimers.delete(id);
    }, delay);
    saveTimers.set(id, t);
};
// 1. Save on page unload
window.addEventListener('beforeunload', () => {
    saveTimers.forEach((timer, noteId) => {
        clearTimeout(timer);
        const noteElement = document.querySelector(`.note[data-id="${noteId}"] .input__box`);
        if (noteElement) {
            updateNoteInFirebase(noteId, noteElement.innerHTML);
        }
    });
    saveTimers.clear();
});
// 2. Save when page loses focus
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        saveTimers.forEach((timer, noteId) => {
            clearTimeout(timer);
            const noteElement = document.querySelector(`.note[data-id="${noteId}"] .input__box`);
            if (noteElement) {
                updateNoteInFirebase(noteId, noteElement.innerHTML);
            }
        });
        saveTimers.clear();
    }
});

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
        e.target.innerHTML
    );
});

notesContainer.addEventListener("blur", (e) => {
    if (!e.target.classList.contains("input__box")) return;
    const id = e.target.closest(".note").dataset.id;
    const content = e.target.innerHTML; // Changed from innerText to innerHTML
    if (saveTimers.has(id)) {
        clearTimeout(saveTimers.get(id));
        saveTimers.delete(id);
    }
    updateNoteInFirebase(id, content);
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
/* ---------- Auth state (FIXED FOR NO FLASH) ---------- */
/* ---------- Auth state (FIXED - Show Loaders Properly) ---------- */
onAuthStateChanged(auth, (user) => {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }

    const loadingSection = document.querySelector('.loading-section');
    const authSection = document.querySelector('.auth-section');
    const controlsSection = document.querySelector('.controls-section');

    if (user) {
        // User is authenticated
        authSection.style.display = "none";
        controlsSection.style.display = "none"; // Keep hidden until notes load
        // DON'T hide loadingSection here - let startListener handle it

        // Start listening to user's notes
        startListener(user.uid);
    } else {
        // User is not authenticated - show sign-in
        loadingSection.style.display = "none";
        authSection.style.display = "block";
        controlsSection.style.display = "none";
        notesContainer.innerHTML = "";
    }
});



// pasting screenshots

/* ---------- Clipboard/Screenshot Paste Feature ---------- */
/* ---------- Image Paste Handler ---------- */
/* ---------- Smart Paste Handler (Text + Images) ---------- */
document.addEventListener('paste', async (e) => {
    const activeElement = document.activeElement;
    if (!activeElement || !activeElement.classList.contains('input__box')) return;

    const items = e.clipboardData.items;
    let hasImage = false;

    // Check if there's an image in clipboard
    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            hasImage = true;
            e.preventDefault();

            const file = item.getAsFile();
            const imageUrl = await handleImagePaste(file);

            if (imageUrl) {
                insertImageIntoNote(activeElement, imageUrl);
            }
            break;
        }
    }

    // If no image, handle as plain text
    // Replace your text paste handling section with this:
    if (!hasImage) {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');

        // Insert plain text at cursor
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        // ** ADD THIS: Manually trigger save after paste **
        const noteId = activeElement.closest('.note').dataset.id;
        debouncedSave(noteId, activeElement.innerHTML);
    }
});

// Keep your existing image handling functions
const handleImagePaste = async (file) => {
    try {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
    } catch (error) {
        console.error('Error handling image:', error);
        return null;
    }
};

const insertImageIntoNote = (noteElement, imageUrl) => {
    // figure container that matches your CSS
    const box = document.createElement('figure');
    box.className = 'note-media is-loading';

    // image
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.setAttribute('contenteditable', 'false');
    img.draggable = false;

    // shimmer off when image is ready
    img.addEventListener('load', () => {
        box.classList.remove('is-loading');
    });

    box.appendChild(img);

    // helper: place caret after a given node
    const moveCaretAfter = (node) => {
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    };

    // insert at current caret (or at end), then add a line break so typing continues on next line
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        r.insertNode(box);
    } else {
        noteElement.appendChild(box);
    }
    const br = document.createElement('br');
    box.after(br);
    moveCaretAfter(br);

    // save right away
    const noteId = noteElement.closest('.note').dataset.id;
    updateNoteInFirebase(noteId, noteElement.innerHTML);

    // keep focus in the note
    noteElement.focus();
};



// scrolling js
/* ---------- Auto-hide Scrollbar ---------- */
/* ---------- Simple Scrollbar Toggle ---------- */
let scrollTimer;

const show = () => {
    document.documentElement.classList.add('show-scrollbar');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
        document.documentElement.classList.remove('show-scrollbar');
    }, 700);
};

window.addEventListener('scroll', show, { passive: true });
window.addEventListener('wheel', show, { passive: true });     // better on Windows
document.addEventListener('keydown', show);   