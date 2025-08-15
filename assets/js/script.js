/* =======================  NOTES APP  ======================= */

const notesContainer = document.querySelector('.notes__container');
const createBtn = document.querySelector('.createBtn');

/* ---------- Storage helpers ---------- */
const STORAGE_KEY = 'notes-v2';

const getNotes = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
};
const saveNotes = (notes) => localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));

/* ---------- UI helpers ---------- */
const makeCard = ({ id, text }) => {
    const card = document.createElement('div');
    card.className = 'note';
    card.dataset.id = id;

    const del = document.createElement('i');
    del.className = 'ri-delete-bin-line';
    del.id = 'deleteNote';             // ← back to ID so your CSS applies

    const p = document.createElement('p');
    p.className = 'input__box';
    p.contentEditable = 'true';
    p.spellcheck = 'false';
    p.textContent = text;

    card.append(del, p);
    return card;
};

const renderAll = () => {
    notesContainer.innerHTML = '';
    getNotes().forEach(n => notesContainer.prepend(makeCard(n)));
};

/* ---------- Debounce save for smoother typing ---------- */
let saveTimer;
const debouncedWrite = (delay = 300) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const fresh = [...notesContainer.querySelectorAll('.note')]
            .reverse()
            .map(card => ({
                id: card.dataset.id,
                text: card.querySelector('.input__box').textContent.trim()
            }));
        saveNotes(fresh);
    }, delay);
};

/* ---------- Create / delete note ---------- */
const addNote = (text = '') => {
    const note = { id: Date.now().toString(), text };
    const all = getNotes();
    all.push(note);            // keep oldest→newest in array
    saveNotes(all);
    renderAll();
    notesContainer.firstElementChild.querySelector('.input__box').focus();
};

const deleteNewestNote = () => {
    const all = getNotes();
    if (!all.length) return;
    all.pop();                 // newest is last in array
    saveNotes(all);
    renderAll();
};

/* ---------- Event bindings ---------- */
createBtn.addEventListener('click', () => addNote());

// delete by clicking icon (delegated)
notesContainer.addEventListener('click', (e) => {
    if (e.target.id !== 'deleteNote') return;   // ← check by id
    const id = e.target.parentElement.dataset.id;
    saveNotes(getNotes().filter(n => n.id !== id));
    renderAll();
});

// typing autosave
notesContainer.addEventListener('input', (e) => {
    if (e.target.classList.contains('input__box')) debouncedWrite();
});

// blur = immediate save
notesContainer.addEventListener('blur', (e) => {
    if (e.target.classList.contains('input__box')) debouncedWrite(0);
}, true);

/* ---------- Keyboard Shortcuts ---------- */
document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'd') { e.preventDefault(); addNote(); }
    if ((e.ctrlKey || e.metaKey) && key === 'q') { e.preventDefault(); deleteNewestNote(); }
});

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', renderAll);
