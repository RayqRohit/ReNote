// Import Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, doc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBDU8xlK7LHmkR3de8d7DseFO2Zu9SHHYE",
  authDomain: "re-notes-e593f.firebaseapp.com",
  projectId: "re-notes-e593f",
  storageBucket: "re-notes-e593f.firebasestorage.app",
  messagingSenderId: "332994702447",
  appId: "1:332994702447:web:1b154759c684207399b19a"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const notesCollection = collection(db, "notes");

// DOM elements
const notesContainer = document.querySelector(".notes__container");
const createBtn      = document.querySelector(".createBtn");

// Track the note we just created so we can focus it after snapshot renders
let pendingFocusId = null;

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

function focusInputBox(el) {
  if (!el) return;
  el.focus();
  // place caret at end
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ---------- Firebase Operations ---------- */
// CREATE: set a fixed 'order' once; also set createdAt/updatedAt
const addNoteToFirebase = async (text = "") => {
  const ref = await addDoc(notesCollection, {
    text,
    order: Date.now(),           // fixed sort key (never changes)
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;                 // <-- return id so caller can track it
};

// UPDATE: do NOT touch 'order' or 'createdAt'
const updateNoteInFirebase = async (id, text) => {
  await updateDoc(doc(db, "notes", id), {
    text,
    updatedAt: serverTimestamp()
  });
};

const deleteNoteFromFirebase = async (id) => {
  await deleteDoc(doc(db, "notes", id));
};

/* ---------- One-time migration for old docs (optional) ---------- */
(async function migrateOrderOnce() {
  try {
    const snap = await getDocs(notesCollection);
    const updates = [];
    snap.forEach(d => {
      const data = d.data() || {};
      if (data.order === undefined) {
        const fallback =
          (data.createdAt && data.createdAt.toMillis && data.createdAt.toMillis()) ||
          Date.now();
        updates.push(updateDoc(doc(db, "notes", d.id), { order: fallback }));
      }
    });
    await Promise.all(updates);
  } catch {}
})();

/* ---------- Real-time listener (stable order) ---------- */
const q = query(notesCollection, orderBy("order", "desc"));
onSnapshot(
  q,
  (snapshot) => {
    const rows = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() || {};
      rows.push({ id: docSnap.id, text: data.text || "" });
    });

    // Rebuild UI in the exact order from Firestore
    notesContainer.innerHTML = "";
    rows.forEach((r) => notesContainer.appendChild(makeCard(r)));

    // If we just created a note, focus it now that it's in the DOM
    if (pendingFocusId) {
      const box = notesContainer.querySelector(`.note[data-id="${pendingFocusId}"] .input__box`);
      if (box) {
        focusInputBox(box);
        pendingFocusId = null; // reset once focused
      }
    }
  },
  (err) => console.error("onSnapshot error:", err)
);

/* ---------- Debounced save ---------- */
const saveTimers = new Map();
const debouncedSave = (noteId, text, delay = 600) => {
  if (saveTimers.has(noteId)) clearTimeout(saveTimers.get(noteId));
  const t = setTimeout(() => {
    updateNoteInFirebase(noteId, text);
    saveTimers.delete(noteId);
  }, delay);
  saveTimers.set(noteId, t);
};

/* ---------- Event handlers ---------- */
const addNote = async (text = "") => {
  const id = await addNoteToFirebase(text);
  pendingFocusId = id; // tell the snapshot to focus this one when it arrives
};

const deleteNewestNote = async () => {
  const firstNote = notesContainer.querySelector(".note"); // newest at top
  if (firstNote) await deleteNoteFromFirebase(firstNote.dataset.id);
};

/* ---------- Event bindings ---------- */
createBtn.addEventListener("click", () => addNote());

// Delete note
notesContainer.addEventListener("click", async (e) => {
  if (e.target.id !== "deleteNote") return;
  const id = e.target.closest(".note").dataset.id;
  await deleteNoteFromFirebase(id);
});

// Auto-save on typing
notesContainer.addEventListener("input", (e) => {
  if (!e.target.classList.contains("input__box")) return;
  const id = e.target.closest(".note").dataset.id;
  debouncedSave(id, e.target.textContent.trim());
});

// Save immediately on blur
notesContainer.addEventListener(
  "blur",
  (e) => {
    if (!e.target.classList.contains("input__box")) return;
    const id = e.target.closest(".note").dataset.id;
    const text = e.target.textContent.trim();
    if (saveTimers.has(id)) {
      clearTimeout(saveTimers.get(id));
      saveTimers.delete(id);
    }
    updateNoteInFirebase(id, text);
  },
  true
);

/* ---------- Keyboard Shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "d") {
    e.preventDefault();
    addNote();
  }
  if ((e.ctrlKey || e.metaKey) && key === "q") {
    e.preventDefault();
    deleteNewestNote();
  }
});
