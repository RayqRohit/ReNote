/* ---------- Firebase imports ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup,
    onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
    getFirestore,
    collection, addDoc, setDoc, doc, updateDoc, deleteDoc,
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
let focusAfterCreateId = null;            // focus new note only when requested (button)
const saveTimers = new Map();

/* ---------- Mobile Cursor Fix Variables ---------- */
let cursorPositions = new Map(); // Store cursor positions per note

/* ---------- UI helpers ---------- */
const makeCard = ({ id, text, order }) => {
    const card = document.createElement("div");
    card.className = "note";
    card.dataset.id = id;
    if (order != null) card.dataset.order = String(order);

    const del = document.createElement("i");
    del.className = "ri-delete-bin-line";
    del.id = "deleteNote";

    const p = document.createElement("p");
    p.className = "input__box";
    p.setAttribute("contenteditable", "true");

    // ✅ turn off spell/auto-correct everywhere
    p.spellcheck = false;                    // boolean (not string)
    p.setAttribute("spellcheck", "false");   // some engines/extensions look at attr
    p.setAttribute("autocorrect", "off");
    p.setAttribute("autocapitalize", "off");
    p.setAttribute("autocomplete", "off");
    p.setAttribute("data-gramm", "false");   // Grammarly
    p.setAttribute("data-lt-active", "false"); // LanguageTool

    p.innerHTML = text || "";

    card.append(del, p);
    return card;
};

const insertCardByOrderDesc = (card) => {
    const newOrder = Number(card.dataset.order || "0");
    const children = Array.from(notesContainer.children).filter(el => el.classList.contains("note"));
    const target = children.find(child => Number(child.dataset.order || "0") < newOrder);
    if (target) notesContainer.insertBefore(card, target);
    else notesContainer.appendChild(card);
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

/* ---------- Cursor save/restore ---------- */
function saveSelection(element) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (element.contains(range.startContainer) || element.contains(range.endContainer)) {
            const noteId = element.closest('.note').dataset.id;
            cursorPositions.set(noteId, {
                startOffset: range.startOffset,
                endOffset: range.endOffset,
                startContainer: range.startContainer
            });
        }
    }
}

function restoreSelection(element) {
    const noteId = element.closest('.note').dataset.id;
    const saved = cursorPositions.get(noteId);
    if (!saved) return;
    try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        const range = document.createRange();
        if (element.contains(saved.startContainer)) {
            range.setStart(saved.startContainer, saved.startOffset);
            range.setEnd(saved.startContainer, saved.endOffset);
        } else {
            range.selectNodeContents(element);
            range.collapse(false);
        }
        sel.addRange(range);
    } catch {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

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

/* ---------- Real-time listener (incremental, no full rebuilds) ---------- */
const startListener = (uid) => {
    if (unsubscribe) unsubscribe();

    const loadingSection = document.querySelector('.loading-section');
    const controlsSection = document.querySelector('.controls-section');

    if (loadingSection) loadingSection.style.display = 'none';
    if (controlsSection) controlsSection.style.display = 'flex';

    // show loader once (will be removed on first snapshot)
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

    unsubscribe = onSnapshot(qNotes, { includeMetadataChanges: true }, (snap) => {
        // remove loader when data arrives
        const loader = notesContainer.querySelector('.notes-loader');
        if (loader) loader.remove();

        // remember caret in currently focused note
        const activeBox =
            document.activeElement?.classList?.contains('input__box') ? document.activeElement : null;
        const activeId = activeBox ? activeBox.closest('.note')?.dataset.id : null;
        if (activeBox) saveSelection(activeBox);

        // apply only changes
        snap.docChanges().forEach(change => {
            const id = change.doc.id;
            const data = change.doc.data() || {};
            const orderVal = data.order ?? 0;

            if (change.type === 'added') {
                if (!notesContainer.querySelector(`.note[data-id="${id}"]`)) {
                    const card = makeCard({ id, text: data.text || "", order: orderVal });
                    insertCardByOrderDesc(card); // assumes this helper exists
                }
            }

            if (change.type === 'modified') {
                const node = notesContainer.querySelector(`.note[data-id="${id}"]`);
                if (node) {
                    // move if order changed
                    if (String(node.dataset.order || "") !== String(orderVal)) {
                        node.dataset.order = String(orderVal);
                        insertCardByOrderDesc(node);
                    }
                    // update content if different (preserve caret if focused)
                    const box = node.querySelector('.input__box');
                    const newHTML = data.text || "";
                    if (box && box.innerHTML !== newHTML) {
                        const wasFocused = document.activeElement === box;
                        if (wasFocused) saveSelection(box);
                        box.innerHTML = newHTML;
                        if (wasFocused) restoreSelection(box);
                    }
                }
            }

            if (change.type === 'removed') {
                notesContainer.querySelector(`.note[data-id="${id}"]`)?.remove();
            }
        });

        // ---------- Focus behavior ----------
        // If we created a note (e.g., via Ctrl+D), keep focusing it across both snapshots
        if (focusAfterCreateId) {
            const box = notesContainer.querySelector(`.note[data-id="${focusAfterCreateId}"] .input__box`);
            if (box) {
                requestAnimationFrame(() => { focusInputBox(box); });
                // Only clear once the write is fully acknowledged by the server
                if (!snap.metadata.hasPendingWrites) {
                    focusAfterCreateId = null;
                }
            }
            // If the new note hasn't appeared yet, do nothing and try again on next snapshot
        } else if (activeId) {
            // Otherwise keep the user’s caret where it was
            const box = notesContainer.querySelector(`.note[data-id="${activeId}"] .input__box`);
            if (box && document.activeElement !== box) {
                try { restoreSelection(box); } catch { focusInputBox(box); }
            }
        }

        // empty state if no notes
        if (snap.size === 0 && !notesContainer.querySelector('.empty-state')) {
            const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
            const modKey = isMac ? '⌘' : 'Ctrl';

            notesContainer.innerHTML = `
    <div class="empty-state">
      No notes yet. Click "Create" or press "${modKey}+D".
      <div style="opacity:.75;margin-top:.25rem;">Tip: "${modKey}+Q" to remove the most recent note.</div>
    </div>
  `;
        } else if (snap.size > 0) {
            const empty = notesContainer.querySelector('.empty-state');
            if (empty) empty.remove();
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
// create with option: button focuses new, Ctrl+D keeps current caret
const addNote = () => {
    const user = auth.currentUser;
    if (!user) return;

    // 1) Instantly remove caret from the current note
    const activeBox = document.activeElement?.classList?.contains('input__box')
        ? document.activeElement
        : null;
    if (activeBox) activeBox.blur();

    // 2) Generate an ID *now* (no network wait)
    const ref = doc(collection(db, "notes"));
    const id = ref.id;
    const order = Date.now();
    const payload = {
        userId: user.uid,
        text: "",
        order,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    // 3) Optimistically add the card to the DOM and focus it
    if (!notesContainer.querySelector(`.note[data-id="${id}"]`)) {
        const card = makeCard({ id, text: "", order });
        // uses your existing helper
        insertCardByOrderDesc(card);
        const box = card.querySelector('.input__box');
        requestAnimationFrame(() => {
            focusInputBox(box);                  // caret jumps to new note immediately
            box.scrollIntoView({ block: 'nearest' });
        });
    }

    // 4) Keep focusing this note across local+server snapshots until ack
    focusAfterCreateId = id;

    // 5) Write to Firestore (no await needed)
    setDoc(ref, payload).catch(console.error);
};

const deleteNewestNote = async () => {
    const first = notesContainer.querySelector(".note");
    if (first) await deleteNoteFromFirebase(first.dataset.id);
};

createBtn.addEventListener("click", () => addNote({ focusNew: true }));

notesContainer.addEventListener("click", async (e) => {
    if (e.target.id !== "deleteNote") return;
    await deleteNoteFromFirebase(e.target.closest(".note").dataset.id);
});

// input: save caret + debounce save (no forced focus -> prevents flicker)
notesContainer.addEventListener("input", (e) => {
    if (!e.target.classList.contains("input__box")) return;
    saveSelection(e.target);
    debouncedSave(
        e.target.closest(".note").dataset.id,
        e.target.innerHTML
    );
});

notesContainer.addEventListener("blur", (e) => {
    if (!e.target.classList.contains("input__box")) return;
    const id = e.target.closest(".note").dataset.id;
    const content = e.target.innerHTML;
    if (saveTimers.has(id)) {
        clearTimeout(saveTimers.get(id));
        saveTimers.delete(id);
    }
    updateNoteInFirebase(id, content);
}, true);

// focus management
notesContainer.addEventListener('focusin', (e) => {
    if (!e.target.classList.contains('input__box')) return;
    setTimeout(() => {
        if (document.activeElement === e.target) restoreSelection(e.target);
    }, 10);
});

notesContainer.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('input__box')) return;
    saveSelection(e.target);
});

// Delete image functionality
notesContainer.addEventListener('click', (e) => {
    const del = e.target.closest('.delete-image');
    if (!del) return;

    const note = del.closest('.note');
    const editor = note?.querySelector('.input__box');
    const figure = del.closest('.note-media');

    if (editor && figure) {
        figure.remove();
        const next = editor.childNodes[Array.prototype.indexOf.call(editor.childNodes, figure) + 1];
        if (next && next.nodeName === 'BR') next.remove();
        const noteId = note.dataset.id;
        updateNoteInFirebase(noteId, editor.innerHTML);
    }
});

/* ---------- Mobile Touch Events ---------- */
notesContainer.addEventListener('touchstart', (e) => {
    if (e.target.classList.contains('input__box')) {
        e.target.focus();
    }
});

document.addEventListener('touchend', (e) => {
    const activeElement = document.activeElement;
    if (activeElement && activeElement.classList.contains('input__box')) {
        setTimeout(() => {
            if (document.activeElement !== activeElement) {
                activeElement.focus();
                restoreSelection(activeElement);
            }
        }, 100);
    }
});

// Handle virtual keyboard resize events (mobile)
let initialViewportHeight = window.innerHeight;
window.addEventListener('resize', () => {
    const currentHeight = window.innerHeight;
    const heightDifference = initialViewportHeight - currentHeight;
    if (heightDifference > 150) {
        const activeElement = document.activeElement;
        if (activeElement && activeElement.classList.contains('input__box')) {
            activeElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }
    if (Math.abs(heightDifference) < 50) {
        initialViewportHeight = currentHeight;
    }
});

/* ---------- Shortcuts ---------- */
document.addEventListener("keydown", (e) => {
    const accel = e.ctrlKey || e.metaKey;
    if (accel && e.key.toLowerCase() === "d") {
        e.preventDefault();
        addNote(); // this now sets focusAfterCreateId
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

    const loadingSection = document.querySelector('.loading-section');
    const authSection = document.querySelector('.auth-section');
    const controlsSection = document.querySelector('.controls-section');

    if (user) {
        authSection.style.display = "none";
        controlsSection.style.display = "none"; // keep hidden until notes load
        startListener(user.uid);
    } else {
        if (loadingSection) loadingSection.style.display = "none";
        if (authSection) authSection.style.display = "block";
        if (controlsSection) controlsSection.style.display = "none";
        notesContainer.innerHTML = "";
    }
});

/* ---------- Image Handling Functions ---------- */
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
    const box = document.createElement('figure');
    box.className = 'note-media is-loading';

    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.setAttribute('contenteditable', 'false');
    img.draggable = false;

    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    overlay.setAttribute('contenteditable', 'false');

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-image';
    delBtn.type = 'button';
    delBtn.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>';
    delBtn.title = 'Delete image';
    overlay.appendChild(delBtn);

    img.addEventListener('load', () => { box.classList.remove('is-loading'); });

    box.appendChild(img);
    box.appendChild(overlay);

    const moveCaretAfter = (node) => {
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    };

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

    const noteId = noteElement.closest('.note').dataset.id;
    updateNoteInFirebase(noteId, noteElement.innerHTML);

    noteElement.focus();
};

/* ---------- Enhanced Paste Handler with Cursor Fix ---------- */
document.addEventListener('paste', async (e) => {
    const activeElement = document.activeElement;
    if (!activeElement || !activeElement.classList.contains('input__box')) return;

    saveSelection(activeElement);

    const items = e.clipboardData.items;
    let hasImage = false;

    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            hasImage = true;
            e.preventDefault();

            const file = item.getAsFile();
            const imageUrl = await handleImagePaste(file);

            if (imageUrl) insertImageIntoNote(activeElement, imageUrl);

            setTimeout(() => {
                activeElement.focus();
                saveSelection(activeElement);
            }, 100);
            break;
        }
    }

    if (!hasImage) {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');

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

        const noteId = activeElement.closest('.note').dataset.id;
        saveSelection(activeElement);
        debouncedSave(noteId, activeElement.innerHTML);

        setTimeout(() => { activeElement.focus(); }, 50);
    }
});

/* ---------- Auto-hide Scrollbar ---------- */
let scrollTimer;
const show = () => {
    document.documentElement.classList.add('show-scrollbar');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
        document.documentElement.classList.remove('show-scrollbar');
    }, 700);
};
window.addEventListener('scroll', show, { passive: true });
window.addEventListener('wheel', show, { passive: true });
document.addEventListener('keydown', show);
