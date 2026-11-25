/**
 * DueSoon Subjects & Workspace Management Module
 * Handles:
 * - My Subjects listing, color assigning, renaming, deleting
 * - Individual Subject Workspace navigation
 * - Study Materials folder & file explorer with preview & download
 * - Built-in distraction-free Lecture Notepad with real-time autosave
 * - AI Study Assistant with document reading, multilingual RTL support & persistent history
 * - Subject-specific To-Do List
 */

const SUBJECT_COLORS = [
  { name: "Sage Green", hex: "#8A9A7B" },
  { name: "Soft Terracotta", hex: "#D9886C" },
  { name: "Classic Taupe", hex: "#A3907C" },
  { name: "Muted Blush Pink", hex: "#C88D88" },
  { name: "Warm Peach", hex: "#D4A373" },
  { name: "Warm Mocha", hex: "#7A583E" },
  { name: "Moss Grey", hex: "#7D8C85" },
  { name: "Sand Beige", hex: "#B59E87" },
  { name: "Dusty Mauve", hex: "#9A8C98" },
  { name: "Slate Plum", hex: "#6D6875" },
];

const QUICK_SUBJECT_SUGGESTIONS = [
  "Artificial Intelligence",
  "Machine Learning",
  "Data Structures & Algorithms",
  "Probability & Statistics",
  "Theory of Automata",
  "Computer Networks",
  "Cyber Security",
  "Operating Systems",
  "Database Systems",
];

// Current Subject State
let currentSubject = null;
let currentFolderId = null;
let currentNoteId = null;
let noteAutosaveTimer = null;
let attachedDocIds = new Set();
let chatTurnHistory = [];

// ==================== MY SUBJECTS MAIN PAGE ====================

async function loadSubjectsList(filterText = "") {
  const container = document.getElementById("subjects-container");
  const countCaption = document.getElementById("subjects-count-caption");
  const sidebarCount = document.getElementById("sidebar-subject-count");
  if (!container) return;

  try {
    const subjects = await api("/api/subjects");
    if (sidebarCount) sidebarCount.textContent = subjects.length;

    const filtered = filterText.trim()
      ? subjects.filter((s) => s.name.toLowerCase().includes(filterText.toLowerCase().trim()))
      : subjects;

    if (countCaption) {
      countCaption.textContent = `${subjects.length} enrolled course${subjects.length === 1 ? "" : "s"}`;
    }

    container.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.style.gridColumn = "1 / -1";
      empty.style.textAlign = "center";
      empty.style.padding = "48px 20px";
      empty.innerHTML = `
        <div style="font-size: 36px; margin-bottom: 12px;">📚</div>
        <h3 style="font-family: var(--font-serif); font-size: 20px; margin-bottom: 6px;">
          ${filterText ? "No matching subjects found" : "No subjects added yet"}
        </h3>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 18px;">
          ${filterText ? "Try a different search term" : "Create your first subject workspace to start organizing study materials and lectures."}
        </p>
        <button class="btn btn-primary" onclick="openSubjectModal()">+ Add Your First Subject</button>
      `;
      container.append(empty);
      return;
    }

    for (const s of filtered) {
      const card = document.createElement("div");
      card.className = "subject-card";
      const color = s.color || "#8A9A7B";

      // Top color bar
      const bar = document.createElement("div");
      bar.className = "subject-card-bar";
      bar.style.backgroundColor = color;

      const content = document.createElement("div");
      content.className = "subject-card-content";

      // Header row
      const header = document.createElement("div");
      header.className = "subject-card-header";

      const title = document.createElement("div");
      title.className = "subject-card-title";
      title.textContent = s.name;

      const swatch = document.createElement("span");
      swatch.style.width = "12px";
      swatch.style.height = "12px";
      swatch.style.borderRadius = "50%";
      swatch.style.backgroundColor = color;
      swatch.style.display = "inline-block";
      swatch.style.flexShrink = "0";
      swatch.style.marginTop = "6px";

      header.append(title, swatch);

      // Stats Pills
      const pills = document.createElement("div");
      pills.className = "subject-stats-pills";

      const filesPill = document.createElement("span");
      filesPill.className = "stat-pill";
      filesPill.innerHTML = `📄 ${s.files || 0} docs`;

      const notesPill = document.createElement("span");
      notesPill.className = "stat-pill";
      notesPill.innerHTML = `📝 ${s.notes_count || 0} notes`;

      const lecturesPill = document.createElement("span");
      lecturesPill.className = "stat-pill";
      lecturesPill.innerHTML = `🎬 ${s.lectures_count || 0} lectures`;

      const todosPill = document.createElement("span");
      todosPill.className = "stat-pill";
      todosPill.innerHTML = `✅ ${s.open_todos || 0} pending`;

      pills.append(filesPill, notesPill, lecturesPill, todosPill);

      // Footer
      const footer = document.createElement("div");
      footer.className = "subject-card-footer";

      const openLink = document.createElement("span");
      openLink.className = "open-workspace-text";
      openLink.innerHTML = "Open Workspace &rarr;";

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "6px";
      actions.onclick = (e) => e.stopPropagation();

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary btn-sm";
      editBtn.style.padding = "3px 8px";
      editBtn.style.fontSize = "11px";
      editBtn.textContent = "Edit";
      editBtn.onclick = () => openSubjectModal(s);

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.style.padding = "3px 6px";
      delBtn.style.fontSize = "11px";
      delBtn.textContent = "\u2715";
      delBtn.title = "Delete Subject";
      delBtn.onclick = async () => {
        if (!confirm(`Are you sure you want to delete "${s.name}" with all its study materials, lectures, and notes?`)) return;
        await api(`/api/subjects/${s.id}`, { method: "DELETE" });
        loadSubjectsList();
        if (typeof updateDashboard === "function") updateDashboard();
      };

      actions.append(editBtn, delBtn);
      footer.append(openLink, actions);

      content.append(header, pills, footer);
      card.append(bar, content);

      card.onclick = () => openSubjectWorkspace(s.id);
      container.append(card);
    }
  } catch (err) {
    if (container) container.innerHTML = `<div class="card" style="color:var(--danger)">Error: ${err.message}</div>`;
  }
}

// Subject Search Listener
const searchInput = document.getElementById("subject-search-input");
if (searchInput) {
  searchInput.oninput = () => loadSubjectsList(searchInput.value);
}

// ==================== SUBJECT CREATE & EDIT MODAL ====================

function openSubjectModal(subject = null) {
  const modal = document.getElementById("subject-modal");
  const title = document.getElementById("subject-modal-title");
  const idInput = document.getElementById("subject-modal-id");
  const nameInput = document.getElementById("subject-modal-name");
  const colorVal = document.getElementById("subject-modal-color-val");
  const submitBtn = document.getElementById("subject-modal-submit");
  const swatchesContainer = document.getElementById("subject-modal-color-swatches");
  const suggestionsBox = document.getElementById("subject-suggestions-chips");

  if (!modal || !nameInput || !colorVal) return;

  modal.classList.remove("hidden");
  if (subject) {
    title.textContent = `Edit Subject: ${subject.name}`;
    idInput.value = subject.id;
    nameInput.value = subject.name;
    colorVal.value = subject.color || "#8A9A7B";
    submitBtn.textContent = "Update Subject";
  } else {
    title.textContent = "Add New Subject";
    idInput.value = "";
    nameInput.value = "";
    // Random color from palette
    const rand = SUBJECT_COLORS[Math.floor(Math.random() * SUBJECT_COLORS.length)].hex;
    colorVal.value = rand;
    submitBtn.textContent = "Create Subject";
  }

  // Render swatches
  if (swatchesContainer) {
    swatchesContainer.replaceChildren();
    for (const c of SUBJECT_COLORS) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = `color-swatch${colorVal.value === c.hex ? " selected" : ""}`;
      swatch.style.backgroundColor = c.hex;
      swatch.title = c.name;
      swatch.onclick = () => {
        colorVal.value = c.hex;
        [...swatchesContainer.children].forEach((el) => el.classList.remove("selected"));
        swatch.classList.add("selected");
      };
      swatchesContainer.append(swatch);
    }
  }

  // Render suggestions chips
  if (suggestionsBox) {
    suggestionsBox.replaceChildren();
    for (const name of QUICK_SUBJECT_SUGGESTIONS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "quick-action-pill";
      chip.textContent = name;
      chip.onclick = () => {
        nameInput.value = name;
        nameInput.focus();
      };
      suggestionsBox.append(chip);
    }
  }

  nameInput.focus();
}

function closeSubjectModal() {
  const modal = document.getElementById("subject-modal");
  if (modal) modal.classList.add("hidden");
}

const modalClose = document.getElementById("subject-modal-close");
const modalCancel = document.getElementById("subject-modal-cancel");
const modalForm = document.getElementById("subject-modal-form");
if (modalClose) modalClose.onclick = closeSubjectModal;
if (modalCancel) modalCancel.onclick = closeSubjectModal;

if (modalForm) {
  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById("subject-modal-id").value;
    const name = document.getElementById("subject-modal-name").value.trim();
    const color = document.getElementById("subject-modal-color-val").value;
    if (!name) return;

    try {
      if (id) {
        await api(`/api/subjects/${id}`, { method: "PATCH", body: JSON.stringify({ name, color }) });
        closeSubjectModal();
        if (currentSubject && currentSubject.id === Number(id)) {
          openSubjectWorkspace(Number(id));
        } else {
          loadSubjectsList();
        }
      } else {
        const created = await api("/api/subjects", { method: "POST", body: JSON.stringify({ name, color }) });
        closeSubjectModal();
        await loadSubjectsList();
        openSubjectWorkspace(created.id);
      }
      if (typeof updateDashboard === "function") updateDashboard();
    } catch (err) {
      alert(`Error saving subject: ${err.message}`);
    }
  };
}

// Quick Add Subject button in top nav
const btnQuickAddSubject = document.getElementById("btn-quick-add-subject");
const btnCreateSubjectModal = document.getElementById("btn-create-subject-modal");
if (btnQuickAddSubject) btnQuickAddSubject.onclick = () => openSubjectModal();
if (btnCreateSubjectModal) btnCreateSubjectModal.onclick = () => openSubjectModal();

// ==================== INDIVIDUAL SUBJECT WORKSPACE ====================

async function openSubjectWorkspace(subjectId, initialTab = "materials") {
  try {
    currentSubject = await api(`/api/subjects/${subjectId}`);
  } catch (err) {
    alert(`Could not open subject: ${err.message}`);
    return;
  }

  // Switch View to Subject Workspace
  if (typeof switchView === "function") {
    switchView("subject-workspace");
  } else {
    document.querySelectorAll(".view-section").forEach((s) => s.classList.add("hidden"));
    const ws = document.getElementById("subject-workspace-view");
    if (ws) ws.classList.remove("hidden");
  }

  // Update Breadcrumbs
  updateBreadcrumbs([
    { label: "My Subjects", action: () => switchView("subjects") },
    { label: currentSubject.name, action: () => openSubjectWorkspace(currentSubject.id, initialTab) },
  ]);

  // Update Header
  const nameEl = document.getElementById("ws-subject-name");
  const metaEl = document.getElementById("ws-subject-meta");
  const colorBar = document.getElementById("ws-color-bar");
  if (nameEl) nameEl.textContent = currentSubject.name;
  if (metaEl) {
    const fileCount = currentSubject.folders.reduce((acc, f) => acc + (f.files ? f.files.length : 0), 0);
    const todoCount = currentSubject.todos ? currentSubject.todos.filter((t) => !t.done).length : 0;
    metaEl.textContent = `${fileCount} uploaded resources \u2022 ${currentSubject.notes ? currentSubject.notes.length : 0} notes \u2022 ${todoCount} pending tasks`;
  }
  if (colorBar) colorBar.style.backgroundColor = currentSubject.color || "#8A9A7B";

  // Wire Subject Header Buttons
  const renameBtn = document.getElementById("ws-rename-btn");
  const colorBtn = document.getElementById("ws-color-btn");
  const deleteBtn = document.getElementById("ws-delete-btn");
  const backBtn = document.getElementById("ws-back-btn");

  if (renameBtn) {
    renameBtn.onclick = () => {
      const newName = prompt(`Rename subject "${currentSubject.name}" to:`, currentSubject.name);
      if (newName && newName.trim() && newName.trim() !== currentSubject.name) {
        api(`/api/subjects/${currentSubject.id}`, { method: "PATCH", body: JSON.stringify({ name: newName.trim() }) })
          .then(() => openSubjectWorkspace(currentSubject.id))
          .catch((e) => alert(e.message));
      }
    };
  }

  if (colorBtn) {
    colorBtn.onclick = () => openSubjectModal(currentSubject);
  }

  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${currentSubject.name}" and all associated files, lectures, notes and tasks?`)) return;
      await api(`/api/subjects/${currentSubject.id}`, { method: "DELETE" });
      switchView("subjects");
      loadSubjectsList();
    };
  }

  if (backBtn) {
    backBtn.onclick = () => switchView("subjects");
  }

  // Workspace Nav Tabs
  setupWorkspaceTabs();
  activateWorkspaceTab(initialTab);
}

function setupWorkspaceTabs() {
  const tabs = ["materials", "lectures", "assistant", "todos"];
  for (const tab of tabs) {
    const btn = document.getElementById(`tab-btn-${tab}`);
    if (btn) {
      btn.onclick = () => activateWorkspaceTab(tab);
    }
  }
}

function activateWorkspaceTab(tab) {
  const tabs = ["materials", "lectures", "assistant", "todos"];
  for (const t of tabs) {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`ws-tab-content-${t}`);
    if (btn) btn.classList.toggle("active", t === tab);
    if (content) content.classList.toggle("hidden", t !== tab);
  }

  // Update breadcrumbs with active tab
  if (currentSubject) {
    const tabLabels = {
      materials: "Study Materials & Notepad",
      lectures: "Video Lectures",
      assistant: "Study Assistant",
      todos: "To-Do List",
    };
    updateBreadcrumbs([
      { label: "My Subjects", action: () => switchView("subjects") },
      { label: currentSubject.name, action: () => openSubjectWorkspace(currentSubject.id, tab) },
      { label: tabLabels[tab] || tab },
    ]);
  }

  // Initialize specific tab logic
  if (tab === "materials") initStudyMaterialsTab();
  else if (tab === "lectures") initLecturesTab();
  else if (tab === "assistant") initAssistantTab();
  else if (tab === "todos") initSubjectTodosTab();
}

// ==================== SUB-TAB 1: STUDY MATERIALS & NOTEPAD ====================

function initStudyMaterialsTab() {
  if (!currentSubject) return;

  const foldersShelf = document.getElementById("materials-folders-shelf");
  const materialsFolders = currentSubject.folders.filter((f) => f.kind !== "playlist");

  // Default to first materials folder if none selected
  if (!currentFolderId || !materialsFolders.some((f) => f.id === currentFolderId)) {
    currentFolderId = materialsFolders[0] ? materialsFolders[0].id : null;
  }

  // Render Folders Shelf
  if (foldersShelf) {
    foldersShelf.replaceChildren();
    for (const f of materialsFolders) {
      const btn = document.createElement("button");
      btn.className = `btn ${f.id === currentFolderId ? "btn-primary" : "btn-secondary"} btn-sm`;
      btn.innerHTML = `📁 ${f.name} <span style="opacity:0.75; font-size:11px;">(${f.files ? f.files.length : 0})</span>`;
      btn.onclick = () => {
        currentFolderId = f.id;
        initStudyMaterialsTab();
      };
      foldersShelf.append(btn);
    }
  }

  // Render Current Folder Files
  renderCurrentFolderFiles();

  // Setup Notepad for this subject
  initNotepad();
}

function renderCurrentFolderFiles() {
  const container = document.getElementById("current-folder-files-container");
  const folderTitle = document.getElementById("current-folder-title");
  const folderActions = document.getElementById("current-folder-actions");
  if (!container || !currentSubject) return;

  const folder = currentSubject.folders.find((f) => f.id === currentFolderId);
  if (!folder) {
    container.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:16px;">Select or create a folder to view study documents.</p>`;
    return;
  }

  if (folderTitle) folderTitle.textContent = `Folder: ${folder.name}`;

  // Folder Actions (Rename / Delete)
  if (folderActions) {
    folderActions.replaceChildren();

    const renameBtn = document.createElement("button");
    renameBtn.className = "btn btn-secondary btn-sm";
    renameBtn.style.fontSize = "11px";
    renameBtn.textContent = "Rename Folder";
    renameBtn.onclick = () => {
      const newName = prompt(`Rename folder "${folder.name}" to:`, folder.name);
      if (newName && newName.trim() && newName.trim() !== folder.name) {
        api(`/api/folders/${folder.id}`, { method: "PATCH", body: JSON.stringify({ name: newName.trim() }) })
          .then(async () => {
            currentSubject = await api(`/api/subjects/${currentSubject.id}`);
            initStudyMaterialsTab();
          })
          .catch((e) => alert(e.message));
      }
    };

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.style.fontSize = "11px";
    delBtn.textContent = "Delete Folder";
    delBtn.onclick = async () => {
      if (!confirm(`Delete folder "${folder.name}" and all its files?`)) return;
      await api(`/api/folders/${folder.id}`, { method: "DELETE" });
      currentSubject = await api(`/api/subjects/${currentSubject.id}`);
      currentFolderId = null;
      initStudyMaterialsTab();
    };

    folderActions.append(renameBtn, delBtn);
  }

  container.replaceChildren();

  if (!folder.files || !folder.files.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px;">
        <div style="font-size: 28px; margin-bottom: 8px;">📄</div>
        <p style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">This folder is empty</p>
        <p style="font-size: 12px; color: var(--text-muted);">Upload lecture slides (PPTX), handouts (PDF), notes (DOCX/TXT), or readings above.</p>
      </div>
    `;
    return;
  }

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "8px";

  for (const file of folder.files) {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "space-between";
    item.style.padding = "10px 14px";
    item.style.borderRadius = "var(--radius-md)";
    item.style.backgroundColor = "var(--bg-card-subtle)";
    item.style.border = "1px solid var(--border-subtle)";
    item.style.gap = "12px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "10px";
    left.style.minWidth = "0";

    const ext = file.name.split(".").pop().toLowerCase();
    const iconSpan = document.createElement("span");
    iconSpan.style.fontSize = "16px";
    if (ext === "pdf") iconSpan.textContent = "📕";
    else if (["ppt", "pptx"].includes(ext)) iconSpan.textContent = "📊";
    else if (["doc", "docx"].includes(ext)) iconSpan.textContent = "📘";
    else if (["txt", "md"].includes(ext)) iconSpan.textContent = "📄";
    else iconSpan.textContent = "📁";

    const nameSpan = document.createElement("span");
    nameSpan.style.fontSize = "13px";
    nameSpan.style.fontWeight = "600";
    nameSpan.style.whiteSpace = "nowrap";
    nameSpan.style.overflow = "hidden";
    nameSpan.style.textOverflow = "ellipsis";
    nameSpan.textContent = file.name;

    const sizeSpan = document.createElement("span");
    sizeSpan.style.fontSize = "11px";
    sizeSpan.style.color = "var(--text-muted)";
    sizeSpan.textContent = fmtSize(file.size);

    left.append(iconSpan, nameSpan, sizeSpan);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "6px";
    right.style.flexShrink = "0";

    // Preview Button
    const prevBtn = document.createElement("button");
    prevBtn.className = "btn btn-secondary btn-sm";
    prevBtn.style.padding = "3px 8px";
    prevBtn.style.fontSize = "11px";
    prevBtn.textContent = "Preview";
    prevBtn.onclick = () => openDocumentPreview(file);

    // Download Link
    const dlLink = document.createElement("a");
    dlLink.className = "btn btn-secondary btn-sm";
    dlLink.style.padding = "3px 8px";
    dlLink.style.fontSize = "11px";
    dlLink.textContent = "Download";
    dlLink.href = `/api/files/${file.id}?download=1`;
    dlLink.download = file.name;

    // Send to Assistant Chip
    if (file.extractable) {
      const aiBtn = document.createElement("button");
      aiBtn.className = "btn btn-secondary btn-sm";
      aiBtn.style.padding = "3px 8px";
      aiBtn.style.fontSize = "11px";
      aiBtn.textContent = "Ask AI";
      aiBtn.title = "Open in Study Assistant";
      aiBtn.onclick = () => {
        attachedDocIds.add(file.id);
        activateWorkspaceTab("assistant");
      };
      right.append(aiBtn);
    }

    // Rename file
    const renBtn = document.createElement("button");
    renBtn.className = "btn btn-secondary btn-sm";
    renBtn.style.padding = "3px 6px";
    renBtn.style.fontSize = "11px";
    renBtn.textContent = "Rename";
    renBtn.onclick = async () => {
      const newName = prompt("Rename document:", file.name);
      if (newName && newName.trim()) {
        await api(`/api/files/${file.id}`, { method: "PATCH", body: JSON.stringify({ name: newName.trim() }) });
        currentSubject = await api(`/api/subjects/${currentSubject.id}`);
        renderCurrentFolderFiles();
      }
    };

    // Delete file
    const delFileBtn = document.createElement("button");
    delFileBtn.className = "btn btn-danger btn-sm";
    delFileBtn.style.padding = "3px 6px";
    delFileBtn.style.fontSize = "11px";
    delFileBtn.textContent = "\u2715";
    delFileBtn.title = "Delete File";
    delFileBtn.onclick = async () => {
      if (!confirm(`Delete "${file.name}"?`)) return;
      await api(`/api/files/${file.id}`, { method: "DELETE" });
      currentSubject = await api(`/api/subjects/${currentSubject.id}`);
      renderCurrentFolderFiles();
    };

    right.append(prevBtn, dlLink, renBtn, delFileBtn);
    item.append(left, right);
    list.append(item);
  }
  container.append(list);
}

// Upload Documents Handler & Drag-Drop Zone
async function handleMaterialsUpload(files) {
  if (!currentFolderId || !files.length) return;
  const statusEl = document.getElementById("materials-upload-status");
  if (statusEl) statusEl.textContent = `Uploading ${files.length} document${files.length === 1 ? "" : "s"}...`;

  const form = new FormData();
  for (const f of files) form.append("files", f);

  try {
    const res = await fetch(`/api/folders/${currentFolderId}/files`, { method: "POST", body: form });
    const body = await res.json();
    if (body.rejected && body.rejected.length) {
      alert(`Some files were rejected (unsupported format): ${body.rejected.join(", ")}`);
    }
    if (statusEl) {
      statusEl.textContent = "Upload completed successfully!";
      setTimeout(() => { statusEl.textContent = ""; }, 3000);
    }
    currentSubject = await api(`/api/subjects/${currentSubject.id}`);
    renderCurrentFolderFiles();
  } catch (e) {
    if (statusEl) statusEl.textContent = `Upload error: ${e.message}`;
  }
}

const materialsFileInput = document.getElementById("materials-file-input");
if (materialsFileInput) {
  materialsFileInput.onchange = () => {
    if (materialsFileInput.files) handleMaterialsUpload(materialsFileInput.files);
    materialsFileInput.value = "";
  };
}

const btnTriggerUpload = document.getElementById("btn-trigger-upload");
if (btnTriggerUpload) {
  btnTriggerUpload.onclick = () => {
    const input = document.getElementById("materials-file-input");
    if (input) input.click();
  };
}

const dropzone = document.getElementById("materials-dropzone");
if (dropzone) {
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--accent-terracotta)";
      dropzone.style.backgroundColor = "var(--bg-hover)";
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--border-color)";
      dropzone.style.backgroundColor = "var(--bg-card-subtle)";
    });
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      handleMaterialsUpload(dt.files);
    }
  });
}

// New Folder Modal
const btnNewFolder = document.getElementById("btn-new-folder");
const folderModal = document.getElementById("folder-modal");
const folderModalClose = document.getElementById("folder-modal-close");
const folderModalCancel = document.getElementById("folder-modal-cancel");
const folderModalForm = document.getElementById("folder-modal-form");

if (btnNewFolder) {
  btnNewFolder.onclick = () => {
    if (folderModal) {
      document.getElementById("folder-modal-name").value = "";
      document.getElementById("folder-modal-kind").value = "materials";
      folderModal.classList.remove("hidden");
    }
  };
}

if (folderModalClose) folderModalClose.onclick = () => folderModal.classList.add("hidden");
if (folderModalCancel) folderModalCancel.onclick = () => folderModal.classList.add("hidden");

if (folderModalForm) {
  folderModalForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("folder-modal-name").value.trim();
    const kind = document.getElementById("folder-modal-kind").value;
    if (!name || !currentSubject) return;

    try {
      const created = await api(`/api/subjects/${currentSubject.id}/folders`, {
        method: "POST",
        body: JSON.stringify({ name, kind }),
      });
      folderModal.classList.add("hidden");
      currentSubject = await api(`/api/subjects/${currentSubject.id}`);
      if (kind === "playlist") {
        activateWorkspaceTab("lectures");
      } else {
        currentFolderId = created.id;
        initStudyMaterialsTab();
      }
    } catch (err) {
      alert(err.message);
    }
  };
}

// Document Preview Modal
function openDocumentPreview(file) {
  const modal = document.getElementById("preview-modal");
  const filenameEl = document.getElementById("preview-modal-filename");
  const bodyEl = document.getElementById("preview-modal-body");
  const dlBtn = document.getElementById("preview-download-btn");
  if (!modal || !bodyEl) return;

  filenameEl.textContent = `Preview: ${file.name}`;
  dlBtn.href = `/api/files/${file.id}?download=1`;
  dlBtn.download = file.name;
  bodyEl.replaceChildren();

  const ext = file.name.split(".").pop().toLowerCase();
  const fileUrl = `/api/files/${file.id}`;

  if (ext === "pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = fileUrl;
    iframe.style.width = "100%";
    iframe.style.height = "520px";
    iframe.style.border = "none";
    iframe.style.borderRadius = "var(--radius-sm)";
    bodyEl.append(iframe);
  } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    const img = document.createElement("img");
    img.src = fileUrl;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "500px";
    img.style.display = "block";
    img.style.margin = "0 auto";
    bodyEl.append(img);
  } else if (["txt", "md", "csv", "py", "js", "cpp", "c", "java", "json"].includes(ext)) {
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.fontFamily = "monospace";
    pre.style.fontSize = "13px";
    pre.style.lineHeight = "1.5";
    pre.style.padding = "16px";
    pre.style.backgroundColor = "var(--bg-main)";
    pre.style.borderRadius = "var(--radius-sm)";
    pre.style.overflow = "auto";
    pre.style.maxHeight = "500px";
    pre.textContent = "Loading file preview...";
    fetch(fileUrl)
      .then((r) => r.text())
      .then((t) => { pre.textContent = t.slice(0, 50000); })
      .catch((e) => { pre.textContent = `Could not load preview: ${e.message}`; });
    bodyEl.append(pre);
  } else {
    // Other supported academic formats (PPTX, DOCX)
    bodyEl.innerHTML = `
      <div style="text-align:center; padding: 48px 20px;">
        <div style="font-size: 40px; margin-bottom: 12px;">📑</div>
        <h4 style="font-family: var(--font-serif); font-size: 18px; margin-bottom: 6px;">${file.name}</h4>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          This presentation or document is indexed for the AI Study Assistant.
        </p>
        <div style="display:flex; justify-content:center; gap:10px;">
          <a class="btn btn-primary" href="${fileUrl}?download=1" download="${file.name}">Download File</a>
          <button class="btn btn-secondary" onclick="attachedDocIds.add(${file.id}); document.getElementById('preview-modal').classList.add('hidden'); activateWorkspaceTab('assistant');">Analyze with AI Assistant</button>
        </div>
      </div>
    `;
  }

  modal.classList.remove("hidden");
}

const previewClose = document.getElementById("preview-modal-close");
if (previewClose) previewClose.onclick = () => document.getElementById("preview-modal").classList.add("hidden");

// ==================== BUILT-IN LECTURE NOTEPAD ====================

async function initNotepad() {
  if (!currentSubject) return;

  const notesListEl = document.getElementById("subject-notes-list");
  const notesCountBadge = document.getElementById("notes-count-badge");
  const titleField = document.getElementById("note-title-field");
  const bodyField = document.getElementById("note-body-field");
  const statusIndicator = document.getElementById("note-autosave-indicator");
  const statusText = document.getElementById("note-autosave-text");

  try {
    const notes = await api(`/api/subjects/${currentSubject.id}/notes`);
    if (notesCountBadge) notesCountBadge.textContent = notes.length;

    if (notesListEl) {
      notesListEl.replaceChildren();

      if (!notes.length) {
        notesListEl.innerHTML = `<p style="font-size:12px; color:var(--text-muted); padding:10px;">No notes yet. Click "+ New Note" to start writing.</p>`;
        if (titleField) titleField.value = "";
        if (bodyField) bodyField.value = "";
        currentNoteId = null;
        return;
      }

      // Default to first note if none selected or deleted
      if (!currentNoteId || !notes.some((n) => n.id === currentNoteId)) {
        currentNoteId = notes[0].id;
      }

      for (const note of notes) {
        const btn = document.createElement("button");
        btn.className = `note-item-btn${note.id === currentNoteId ? " active" : ""}`;
        btn.onclick = () => selectNote(note.id);

        const titleDiv = document.createElement("div");
        titleDiv.className = "note-item-title";
        titleDiv.textContent = note.title || "Untitled Note";

        const dateDiv = document.createElement("div");
        dateDiv.className = "note-item-date";
        dateDiv.textContent = note.updated_at ? new Date(note.updated_at).toLocaleDateString() : "";

        btn.append(titleDiv, dateDiv);
        notesListEl.append(btn);
      }
    }

    // Populate active note in editor
    if (currentNoteId) {
      const activeNote = notes.find((n) => n.id === currentNoteId);
      if (activeNote && titleField && bodyField) {
        titleField.value = activeNote.title || "";
        bodyField.value = activeNote.content || "";
      }
    }
  } catch (err) {
    console.error("Error loading notes:", err);
  }
}

async function selectNote(noteId) {
  currentNoteId = noteId;
  await initNotepad();
}

// Autosave implementation with debounce
function triggerNoteAutosave() {
  const statusIndicator = document.getElementById("note-autosave-indicator");
  const statusText = document.getElementById("note-autosave-text");
  if (statusIndicator) {
    statusIndicator.className = "note-save-status saving";
    if (statusText) statusText.textContent = "Saving...";
  }

  clearTimeout(noteAutosaveTimer);
  noteAutosaveTimer = setTimeout(async () => {
    if (!currentNoteId) return;
    const title = document.getElementById("note-title-field").value;
    const content = document.getElementById("note-body-field").value;

    try {
      await api(`/api/notes/${currentNoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, content }),
      });
      if (statusIndicator) {
        statusIndicator.className = "note-save-status saved";
        if (statusText) statusText.textContent = "Saved";
      }
      // Update sidebar title silently
      const activeBtn = document.querySelector(`.note-item-btn.active .note-item-title`);
      if (activeBtn) activeBtn.textContent = title || "Untitled Note";
    } catch (e) {
      if (statusIndicator) {
        statusIndicator.className = "note-save-status";
        if (statusText) statusText.textContent = "Error saving";
      }
    }
  }, 600);
}

const noteTitleField = document.getElementById("note-title-field");
const noteBodyField = document.getElementById("note-body-field");
if (noteTitleField) noteTitleField.oninput = triggerNoteAutosave;
if (noteBodyField) noteBodyField.oninput = triggerNoteAutosave;

// New Note Button
const btnCreateNote = document.getElementById("btn-create-note");
if (btnCreateNote) {
  btnCreateNote.onclick = async () => {
    if (!currentSubject) return;
    try {
      const created = await api(`/api/subjects/${currentSubject.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ title: "New Lecture Note", content: "" }),
      });
      currentNoteId = created.id;
      await initNotepad();
      const body = document.getElementById("note-body-field");
      if (body) body.focus();
    } catch (err) {
      alert(`Could not create note: ${err.message}`);
    }
  };
}

// Delete Active Note
const btnDeleteActiveNote = document.getElementById("btn-delete-active-note");
if (btnDeleteActiveNote) {
  btnDeleteActiveNote.onclick = async () => {
    if (!currentNoteId) return;
    if (!confirm("Are you sure you want to delete this note?")) return;
    try {
      await api(`/api/notes/${currentNoteId}`, { method: "DELETE" });
      currentNoteId = null;
      await initNotepad();
    } catch (err) {
      alert(err.message);
    }
  };
}

// Download Note as TXT
const btnDownloadNote = document.getElementById("btn-download-note");
if (btnDownloadNote) {
  btnDownloadNote.onclick = () => {
    const title = document.getElementById("note-title-field").value || "Note";
    const content = document.getElementById("note-body-field").value || "";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
}

// ==================== SUB-TAB 2: VIDEO LECTURES ====================

function initLecturesTab() {
  if (!currentSubject) return;

  const selector = document.getElementById("playlist-folder-selector");
  const playlists = currentSubject.folders.filter((f) => f.kind === "playlist");

  if (!playlists.length) {
    // If no playlist folder exists, create default "Lectures"
    api(`/api/subjects/${currentSubject.id}/folders`, {
      method: "POST",
      body: JSON.stringify({ name: "Lectures", kind: "playlist" }),
    }).then(async () => {
      currentSubject = await api(`/api/subjects/${currentSubject.id}`);
      initLecturesTab();
    });
    return;
  }

  let activePlaylist = playlists[0];

  if (selector) {
    selector.replaceChildren();
    for (const p of playlists) {
      const btn = document.createElement("button");
      btn.className = `btn ${p.id === activePlaylist.id ? "btn-primary" : "btn-secondary"} btn-sm`;
      btn.textContent = `🎬 ${p.name}`;
      btn.onclick = () => {
        activePlaylist = p;
        [...selector.children].forEach((el) => {
          el.className = "btn btn-secondary btn-sm";
        });
        btn.className = "btn btn-primary btn-sm";
        renderPlaylistView(activePlaylist);
      };
      selector.append(btn);
    }
  }

  // Render first playlist
  renderPlaylistView(activePlaylist);
}

// New Playlist Modal / Button
const btnNewPlaylist = document.getElementById("btn-new-lecture-playlist");
if (btnNewPlaylist) {
  btnNewPlaylist.onclick = () => {
    const name = prompt("Name for new video lecture playlist (e.g. Lab Recitations, Midterm Prep):");
    if (name && name.trim()) {
      api(`/api/subjects/${currentSubject.id}/folders`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), kind: "playlist" }),
      })
        .then(async () => {
          currentSubject = await api(`/api/subjects/${currentSubject.id}`);
          initLecturesTab();
        })
        .catch((e) => alert(e.message));
    }
  };
}

// ==================== SUB-TAB 3: STUDY ASSISTANT ====================

async function initAssistantTab() {
  if (!currentSubject) return;

  const stream = document.getElementById("assistant-chat-stream");
  const providerBadge = document.getElementById("assistant-provider-badge");

  // Check AI Status
  try {
    const st = await api("/api/ai/status");
    if (providerBadge) {
      providerBadge.textContent = st.configured
        ? `${st.provider.toUpperCase()} (${st.model})`
        : "AI Keys Not Set (Demo Mode)";
      providerBadge.style.backgroundColor = st.configured ? "var(--success-bg)" : "var(--warning-bg)";
      providerBadge.style.color = st.configured ? "var(--success)" : "var(--warning)";
    }
  } catch (e) {
    /* ignore */
  }

  // Load chat history from backend
  if (stream) {
    stream.replaceChildren();
    try {
      const history = await api(`/api/subjects/${currentSubject.id}/chat/history`);
      chatTurnHistory = [];

      if (!history.length) {
        const welcome = document.createElement("div");
        welcome.className = "chat-bubble assistant";
        welcome.innerHTML = `
          <strong>Study Assistant:</strong> Hello! I am your AI academic tutor for <em>${currentSubject.name}</em>.
          <br><br>
          You can attach lecture slides, PDFs, or assignments above, choose your preferred language (including full right-to-left support for Urdu and Arabic), or click any quick action below to begin!
        `;
        stream.append(welcome);
      } else {
        for (const msg of history) {
          appendMessageBubble(msg.role, msg.content);
          chatTurnHistory.push({ role: msg.role, content: msg.content });
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  renderAttachedDocChips();
}

function renderAttachedDocChips() {
  const container = document.getElementById("assistant-chips-container");
  if (!container || !currentSubject) return;
  container.replaceChildren();

  const allFiles = currentSubject.folders.flatMap((f) => f.files || []);

  for (const id of attachedDocIds) {
    const file = allFiles.find((f) => f.id === id);
    if (!file) continue;

    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.innerHTML = `
      <span>📄 ${file.name}</span>
      <button type="button" title="Remove attachment">&times;</button>
    `;
    chip.querySelector("button").onclick = () => {
      attachedDocIds.delete(id);
      renderAttachedDocChips();
    };
    container.append(chip);
  }
}

// Modal for attaching existing documents
const btnAttachFromMaterials = document.getElementById("btn-attach-from-materials");
const attachDocsModal = document.getElementById("attach-docs-modal");
const attachDocsClose = document.getElementById("attach-docs-modal-close");
const attachDocsDone = document.getElementById("attach-docs-modal-done");
const attachDocsContainer = document.getElementById("attach-docs-checkboxes-container");

if (btnAttachFromMaterials) {
  btnAttachFromMaterials.onclick = () => {
    if (!attachDocsModal || !currentSubject) return;
    attachDocsModal.classList.remove("hidden");
    attachDocsContainer.replaceChildren();

    const extractableFiles = currentSubject.folders
      .flatMap((f) => f.files || [])
      .filter((f) => f.extractable);

    if (!extractableFiles.length) {
      attachDocsContainer.innerHTML = `<p style="font-size:13px; color:var(--text-muted);">No readable study documents found in this subject. Upload PDFs, PPTX, or DOCX in Study Materials first.</p>`;
      return;
    }

    for (const f of extractableFiles) {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "8px";
      label.style.fontSize = "13px";
      label.style.cursor = "pointer";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = attachedDocIds.has(f.id);
      chk.onchange = () => {
        if (chk.checked) {
          if (attachedDocIds.size >= 5) {
            alert("Maximum 5 documents can be attached at a time.");
            chk.checked = false;
            return;
          }
          attachedDocIds.add(f.id);
        } else {
          attachedDocIds.delete(f.id);
        }
      };

      label.append(chk, document.createTextNode(` ${f.name} (${fmtSize(f.size)})`));
      attachDocsContainer.append(label);
    }
  };
}

if (attachDocsClose) attachDocsClose.onclick = () => attachDocsModal.classList.add("hidden");
if (attachDocsDone) {
  attachDocsDone.onclick = () => {
    attachDocsModal.classList.add("hidden");
    renderAttachedDocChips();
  };
}

// Upload direct chat document
const uploadChatDocInput = document.getElementById("assistant-upload-doc-input");
if (uploadChatDocInput) {
  uploadChatDocInput.onchange = async () => {
    if (!currentSubject || !uploadChatDocInput.files.length) return;
    const form = new FormData();
    for (const f of uploadChatDocInput.files) form.append("files", f);

    try {
      const res = await fetch(`/api/subjects/${currentSubject.id}/documents`, { method: "POST", body: form });
      const data = await res.json();
      for (const saved of data.files || []) {
        if (attachedDocIds.size < 5) attachedDocIds.add(saved.id);
      }
      currentSubject = await api(`/api/subjects/${currentSubject.id}`);
      renderAttachedDocChips();
    } catch (e) {
      alert(`Could not attach document: ${e.message}`);
    }
    uploadChatDocInput.value = "";
  };
}

// Assistant Send Message Form
const assistantChatForm = document.getElementById("assistant-chat-form");
const assistantChatInput = document.getElementById("assistant-chat-input");

function isRTLText(text) {
  const rtlChars = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  return rtlChars.test(text);
}

function appendMessageBubble(role, text) {
  const stream = document.getElementById("assistant-chat-stream");
  if (!stream) return null;

  const bubble = document.createElement("div");
  const isRTL = isRTLText(text);
  bubble.className = `chat-bubble ${role}${isRTL ? " rtl" : ""}`;
  bubble.textContent = text;
  stream.append(bubble);
  stream.scrollTop = stream.scrollHeight;
  return bubble;
}

if (assistantChatForm && assistantChatInput) {
  assistantChatInput.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      assistantChatForm.requestSubmit();
    }
  };

  assistantChatForm.onsubmit = async (e) => {
    e.preventDefault();
    const prompt = assistantChatInput.value.trim();
    if (!prompt || !currentSubject) return;

    assistantChatInput.value = "";
    appendMessageBubble("user", prompt);
    chatTurnHistory.push({ role: "user", content: prompt });

    const pending = appendMessageBubble("assistant", "Thinking...");
    const langSelect = document.getElementById("assistant-language-select");
    const lang = langSelect ? langSelect.value.trim() : "";

    try {
      const res = await api(`/api/subjects/${currentSubject.id}/chat`, {
        method: "POST",
        body: JSON.stringify({
          messages: chatTurnHistory,
          file_ids: [...attachedDocIds],
          language: lang,
        }),
      });

      pending.textContent = res.reply;
      if (isRTLText(res.reply)) pending.classList.add("rtl");
      chatTurnHistory.push({ role: "assistant", content: res.reply });

      if (res.notes && res.notes.length) {
        const stream = document.getElementById("assistant-chat-stream");
        for (const n of res.notes) {
          const noteEl = document.createElement("div");
          noteEl.style.fontSize = "11px";
          noteEl.style.color = "var(--text-muted)";
          noteEl.style.padding = "2px 8px";
          noteEl.textContent = `Note: ${n}`;
          stream.append(noteEl);
        }
      }
    } catch (err) {
      pending.textContent = `Assistant: ${err.message}`;
      pending.style.color = "var(--danger)";
      chatTurnHistory.pop(); // Remove failed user message turn
    }
  };
}

// Quick Action Prompts
document.querySelectorAll(".quick-action-pill[data-action]").forEach((btn) => {
  btn.onclick = () => {
    const action = btn.dataset.action;
    const input = document.getElementById("assistant-chat-input");
    if (!input) return;

    const prompts = {
      explain: "Please explain the fundamental concepts in the attached documents step-by-step in clear, accessible language with an illustrative example.",
      summarize: "Summarize the key points, core definitions, and formulas from the attached study materials into structured revision bullet points.",
      quiz: "Generate a 10-question practice multiple-choice quiz (with options A, B, C, D) based on the attached materials. Provide the answer key at the end.",
      solve: "Solve the practice problems and sample exercises in the attached documents with complete step-by-step working and reasoning.",
      assignment: "Help me outline and structure this assignment: identify the key requirements, provide a suggested outline, and highlight important topics to research.",
    };

    input.value = prompts[action] || "";
    input.focus();
  };
});

// Clear Chat History
const btnClearChat = document.getElementById("btn-clear-chat");
if (btnClearChat) {
  btnClearChat.onclick = async () => {
    if (!currentSubject) return;
    if (!confirm("Clear this subject's assistant conversation history?")) return;
    await api(`/api/subjects/${currentSubject.id}/chat/history`, { method: "DELETE" });
    initAssistantTab();
  };
}

// ==================== SUB-TAB 4: SUBJECT TO-DO LIST ====================

function initSubjectTodosTab() {
  if (!currentSubject) return;

  const pendingList = document.getElementById("ws-pending-todos-list");
  const completedList = document.getElementById("ws-completed-todos-list");
  const pendingCountEl = document.getElementById("ws-pending-todos-count");
  const completedCountEl = document.getElementById("ws-completed-todos-count");

  const todos = currentSubject.todos || [];
  const pending = todos.filter((t) => !t.done);
  const completed = todos.filter((t) => t.done);

  if (pendingCountEl) pendingCountEl.textContent = pending.length;
  if (completedCountEl) completedCountEl.textContent = completed.length;

  if (pendingList) {
    pendingList.replaceChildren();
    if (!pending.length) {
      pendingList.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:12px;">No pending tasks! Add assignments or study goals above.</p>`;
    } else {
      pending.forEach((t) => pendingList.append(renderTodoItem(t)));
    }
  }

  if (completedList) {
    completedList.replaceChildren();
    if (!completed.length) {
      completedList.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:12px;">Completed tasks will appear here.</p>`;
    } else {
      completed.forEach((t) => completedList.append(renderTodoItem(t)));
    }
  }
}

function renderTodoItem(todo) {
  const item = document.createElement("div");
  item.style.display = "flex";
  item.style.alignItems = "center";
  item.style.justifyContent = "space-between";
  item.style.padding = "8px 12px";
  item.style.borderRadius = "var(--radius-md)";
  item.style.backgroundColor = "var(--bg-card-subtle)";
  item.style.border = "1px solid var(--border-subtle)";
  item.style.gap = "10px";

  const left = document.createElement("div");
  left.style.display = "flex";
  left.style.alignItems = "center";
  left.style.gap = "8px";
  left.style.minWidth = "0";

  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = !!todo.done;
  chk.onchange = async () => {
    await api(`/api/todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ done: chk.checked }) });
    currentSubject = await api(`/api/subjects/${currentSubject.id}`);
    initSubjectTodosTab();
    if (typeof updateDashboard === "function") updateDashboard();
  };

  const textSpan = document.createElement("span");
  textSpan.style.fontSize = "13px";
  textSpan.style.fontWeight = "500";
  if (todo.done) {
    textSpan.style.textDecoration = "line-through";
    textSpan.style.opacity = "0.6";
  }
  textSpan.textContent = todo.text;

  left.append(chk, textSpan);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "6px";

  if (todo.priority) {
    const pBadge = document.createElement("span");
    pBadge.className = "stat-pill";
    pBadge.style.fontSize = "10px";
    pBadge.style.padding = "2px 6px";
    if (todo.priority === "High") pBadge.style.color = "var(--danger)";
    else if (todo.priority === "Medium") pBadge.style.color = "var(--warning)";
    pBadge.textContent = todo.priority;
    right.append(pBadge);
  }

  if (todo.due_date) {
    const dBadge = document.createElement("span");
    dBadge.className = "stat-pill";
    dBadge.style.fontSize = "10px";
    dBadge.textContent = todo.due_date;
    right.append(dBadge);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-danger btn-sm";
  delBtn.style.padding = "2px 6px";
  delBtn.style.fontSize = "10px";
  delBtn.textContent = "\u2715";
  delBtn.onclick = async () => {
    await api(`/api/todos/${todo.id}`, { method: "DELETE" });
    currentSubject = await api(`/api/subjects/${currentSubject.id}`);
    initSubjectTodosTab();
    if (typeof updateDashboard === "function") updateDashboard();
  };

  right.append(delBtn);
  item.append(left, right);
  return item;
}

// Add Subject To-Do Form Submit
const wsAddTodoForm = document.getElementById("ws-add-todo-form");
if (wsAddTodoForm) {
  wsAddTodoForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!currentSubject) return;

    const text = document.getElementById("todo-text-input").value.trim();
    const category = document.getElementById("todo-category-input").value;
    const priority = document.getElementById("todo-priority-input").value;
    const due_date = document.getElementById("todo-due-input").value || null;
    if (!text) return;

    try {
      await api(`/api/subjects/${currentSubject.id}/todos`, {
        method: "POST",
        body: JSON.stringify({ text, category, priority, due_date }),
      });
      document.getElementById("todo-text-input").value = "";
      currentSubject = await api(`/api/subjects/${currentSubject.id}`);
      initSubjectTodosTab();
      if (typeof updateDashboard === "function") updateDashboard();
    } catch (err) {
      alert(err.message);
    }
  };
}
