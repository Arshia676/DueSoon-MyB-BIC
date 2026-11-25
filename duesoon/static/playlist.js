/**
 * DueSoon Lecture Playlist & Built-in Player Module
 * Supports local video uploads (MP4, WebM, MKV) and YouTube embeds in the same doubly linked playlist.
 */

const prefs = {
  get(key, fallback) {
    try { return localStorage.getItem(`duesoon.${key}`) || fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`duesoon.${key}`, value); }
    catch { /* ignore */ }
  },
};

function fmtSize(n) {
  if (!n) return "";
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function renderPlaylistView(folder, mountEl) {
  const layout = prefs.get("layout", "list");
  const cols = prefs.get("cols", "3");

  const state = {
    folderId: folder.id,
    lectures: [],
    currentId: null,
    layout: layout === "grid" ? "grid" : "list",
    cols: ["2", "3", "4"].includes(cols) ? cols : "3",
  };

  // Wire layout toggle buttons from HTML
  const listBtn = document.getElementById("btn-layout-list");
  const gridBtn = document.getElementById("btn-layout-grid");
  const colsSelect = document.getElementById("grid-cols-select");
  const playerContainer = document.getElementById("lecture-player-container");
  const cardsContainer = document.getElementById("playlist-cards-container");
  const statsText = document.getElementById("playlist-stats-text");
  const uploadInput = document.getElementById("lecture-upload-input");
  const uploadStatus = document.getElementById("lecture-upload-status");
  const ytForm = document.getElementById("youtube-add-form");

  if (listBtn && gridBtn && colsSelect) {
    listBtn.className = state.layout === "list" ? "active" : "";
    gridBtn.className = state.layout === "grid" ? "active" : "";
    colsSelect.value = state.cols;
    colsSelect.style.display = state.layout === "grid" ? "inline-block" : "none";

    listBtn.onclick = () => {
      state.layout = "list";
      prefs.set("layout", "list");
      listBtn.className = "active";
      gridBtn.className = "";
      colsSelect.style.display = "none";
      drawCards();
    };

    gridBtn.onclick = () => {
      state.layout = "grid";
      prefs.set("layout", "grid");
      gridBtn.className = "active";
      listBtn.className = "";
      colsSelect.style.display = "inline-block";
      drawCards();
    };

    colsSelect.onchange = () => {
      state.cols = colsSelect.value;
      prefs.set("cols", state.cols);
      drawCards();
    };
  }

  async function reload() {
    try {
      const data = await api(`/api/folders/${state.folderId}/playlist`);
      state.lectures = data.lectures;
      if (statsText) {
        statsText.textContent = data.total
          ? `${data.total} lecture${data.total === 1 ? "" : "s"} \u2022 ${data.watched} watched (${data.total ? Math.round((data.watched / data.total) * 100) : 0}%)`
          : "No lectures in this playlist yet. Upload videos or add YouTube links below.";
      }
      drawCards();
    } catch (e) {
      if (statsText) statsText.textContent = `Error loading playlist: ${e.message}`;
    }
  }

  async function moveLecture(id, body) {
    try {
      await api(`/api/lectures/${id}/move`, { method: "POST", body: JSON.stringify(body) });
      await reload();
    } catch (e) {
      alert(`Could not reorder lecture: ${e.message}`);
    }
  }

  function drawCards() {
    if (!cardsContainer) return;
    cardsContainer.replaceChildren();
    cardsContainer.className = `video-cards-container ${state.layout}`;
    cardsContainer.style.setProperty("--cols", state.cols);

    if (!state.lectures.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.style.textAlign = "center";
      empty.style.padding = "36px 20px";
      empty.innerHTML = `
        <div style="font-size: 32px; margin-bottom: 8px;">🎬</div>
        <h4 style="font-family: var(--font-serif); font-size: 18px; margin-bottom: 6px;">No lectures added yet</h4>
        <p style="font-size: 13px; color: var(--text-muted);">Use the upload button or add a YouTube URL below to build your study playlist.</p>
      `;
      cardsContainer.append(empty);
      return;
    }

    for (const l of state.lectures) {
      const card = document.createElement("div");
      card.className = `video-card${l.watched ? " watched" : ""}${l.id === state.currentId ? " active-playing" : ""}`;
      card.onclick = () => playLecture(l.id);

      // Thumbnail
      const thumbBox = document.createElement("div");
      thumbBox.className = "video-thumbnail-box";

      if (l.kind === "youtube") {
        const img = document.createElement("img");
        img.src = `https://i.ytimg.com/vi/${encodeURIComponent(l.youtube_id)}/hqdefault.jpg`;
        img.alt = l.title;
        img.loading = "lazy";
        thumbBox.append(img);
      } else {
        const vid = document.createElement("video");
        vid.preload = "metadata";
        vid.muted = true;
        vid.src = `/api/files/${l.file_id}#t=0.5`;
        thumbBox.append(vid);
      }

      if (l.watched) {
        const badge = document.createElement("span");
        badge.className = "watched-badge-overlay";
        badge.textContent = "\u2713 Watched";
        thumbBox.append(badge);
      }

      // Details
      const details = document.createElement("div");
      details.className = "video-details-box";

      const title = document.createElement("div");
      title.className = "video-title-text";
      title.textContent = `${l.index}. ${l.title}`;

      const meta = document.createElement("div");
      meta.className = "video-meta-text";
      meta.textContent = l.kind === "youtube" ? "YouTube Lecture" : `${fmtSize(l.size)}`;

      // Action toolbar (Up, Down, Place, Rename, Delete)
      const actions = document.createElement("div");
      actions.className = "video-card-actions";
      actions.onclick = (e) => e.stopPropagation();

      const playBtn = document.createElement("button");
      playBtn.className = "btn btn-primary btn-sm";
      playBtn.style.padding = "3px 8px";
      playBtn.style.fontSize = "11px";
      playBtn.innerHTML = "\u25B6 Play";
      playBtn.onclick = () => playLecture(l.id);

      const upBtn = document.createElement("button");
      upBtn.className = "btn btn-secondary btn-sm";
      upBtn.style.padding = "3px 6px";
      upBtn.textContent = "\u2191";
      upBtn.title = "Move Up";
      upBtn.onclick = () => moveLecture(l.id, { direction: "up" });

      const downBtn = document.createElement("button");
      downBtn.className = "btn btn-secondary btn-sm";
      downBtn.style.padding = "3px 6px";
      downBtn.textContent = "\u2193";
      downBtn.title = "Move Down";
      downBtn.onclick = () => moveLecture(l.id, { direction: "down" });

      const placeBtn = document.createElement("button");
      placeBtn.className = "btn btn-secondary btn-sm";
      placeBtn.style.padding = "3px 6px";
      placeBtn.textContent = "#";
      placeBtn.title = "Move to position";
      placeBtn.onclick = () => {
        const pos = Number(prompt(`Move "${l.title}" to position (1 to ${state.lectures.length}):`, l.index));
        if (Number.isInteger(pos) && pos >= 1 && pos <= state.lectures.length) {
          moveLecture(l.id, { position: pos });
        }
      };

      const renameBtn = document.createElement("button");
      renameBtn.className = "btn btn-secondary btn-sm";
      renameBtn.style.padding = "3px 8px";
      renameBtn.style.fontSize = "11px";
      renameBtn.textContent = "Rename";
      renameBtn.onclick = async () => {
        const newTitle = prompt("Edit lecture title:", l.title);
        if (newTitle && newTitle.trim()) {
          try {
            await api(`/api/lectures/${l.id}`, { method: "PATCH", body: JSON.stringify({ title: newTitle.trim() }) });
            await reload();
          } catch (e) {
            alert(e.message);
          }
        }
      };

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.style.padding = "3px 6px";
      delBtn.textContent = "\u2715";
      delBtn.title = "Delete Lecture";
      delBtn.onclick = async () => {
        if (!confirm(`Delete "${l.title}" from this playlist?`)) return;
        try {
          await api(`/api/lectures/${l.id}`, { method: "DELETE" });
          if (state.currentId === l.id) {
            state.currentId = null;
            if (playerContainer) {
              playerContainer.style.display = "none";
              playerContainer.replaceChildren();
            }
          }
          await reload();
        } catch (e) {
          alert(e.message);
        }
      };

      actions.append(playBtn, upBtn, downBtn, placeBtn, renameBtn, delBtn);
      details.append(title, meta, actions);
      card.append(thumbBox, details);
      cardsContainer.append(card);
    }
  }

  function playLecture(id, autoplay = true) {
    const l = state.lectures.find((x) => x.id === id);
    if (!l || !playerContainer) return;
    state.currentId = id;
    playerContainer.style.display = "block";
    playerContainer.replaceChildren();

    const playerCard = document.createElement("div");
    playerCard.className = "video-player-card";

    let mediaEl;
    if (l.kind === "youtube") {
      mediaEl = document.createElement("iframe");
      mediaEl.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(l.youtube_id)}?autoplay=${autoplay ? 1 : 0}&enablejsapi=1`;
      mediaEl.title = l.title;
      mediaEl.allowFullscreen = true;
      mediaEl.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    } else {
      mediaEl = document.createElement("video");
      mediaEl.controls = true;
      mediaEl.playsInline = true;
      mediaEl.src = `/api/files/${l.file_id}`;

      // Resume position
      mediaEl.onloadedmetadata = () => {
        if (l.resume_at > 5 && l.resume_at < mediaEl.duration - 5) {
          mediaEl.currentTime = l.resume_at;
        }
      };

      let lastSave = 0;
      const saveProgress = () => {
        if (!mediaEl.duration) return;
        l.resume_at = mediaEl.currentTime;
        api(`/api/lectures/${l.id}`, { method: "PATCH", body: JSON.stringify({ resume_at: mediaEl.currentTime }) }).catch(() => {});
      };

      mediaEl.ontimeupdate = () => {
        if (Date.now() - lastSave > 8000) {
          lastSave = Date.now();
          saveProgress();
        }
      };

      mediaEl.onpause = () => {
        if (!mediaEl.ended) saveProgress();
      };

      mediaEl.onended = () => {
        l.watched = true;
        l.resume_at = 0;
        api(`/api/lectures/${l.id}`, { method: "PATCH", body: JSON.stringify({ watched: true, resume_at: 0 }) }).catch(() => {});
        if (l.next_id) {
          playLecture(l.next_id, true);
        } else {
          drawCards();
        }
      };

      if (autoplay) {
        mediaEl.play().catch(() => {});
      }
    }

    // Player bottom bar
    const bar = document.createElement("div");
    bar.className = "player-bottom-bar";

    const titleGroup = document.createElement("div");
    titleGroup.innerHTML = `
      <div class="player-lecture-title">${l.index}. ${l.title}</div>
      <div style="font-size: 11px; color: var(--text-muted);">${l.kind === "youtube" ? "YouTube Embedded Player" : "Local Video Player"}</div>
    `;

    const controlsGroup = document.createElement("div");
    controlsGroup.className = "player-controls-group";

    // Playback Speed Selector (for HTML5 video)
    if (l.kind !== "youtube") {
      const speedSelect = document.createElement("select");
      speedSelect.className = "form-select";
      speedSelect.style.width = "auto";
      speedSelect.style.padding = "4px 8px";
      speedSelect.style.fontSize = "12px";
      for (const spd of [0.75, 1, 1.25, 1.5, 2]) {
        const opt = document.createElement("option");
        opt.value = spd;
        opt.textContent = `${spd}x`;
        if (spd === 1) opt.selected = true;
        speedSelect.append(opt);
      }
      speedSelect.onchange = () => {
        mediaEl.playbackRate = Number(speedSelect.value);
      };
      controlsGroup.append(speedSelect);
    }

    // Prev / Next Buttons (doubly linked list O(1))
    const prevBtn = document.createElement("button");
    prevBtn.className = "btn btn-secondary btn-sm";
    prevBtn.textContent = "\u2190 Previous";
    prevBtn.disabled = !l.prev_id;
    prevBtn.onclick = () => playLecture(l.prev_id);

    const nextBtn = document.createElement("button");
    nextBtn.className = "btn btn-secondary btn-sm";
    nextBtn.textContent = "Next \u2192";
    nextBtn.disabled = !l.next_id;
    nextBtn.onclick = () => playLecture(l.next_id);

    // Watched toggle checkbox
    const watchedLabel = document.createElement("label");
    watchedLabel.style.display = "flex";
    watchedLabel.style.alignItems = "center";
    watchedLabel.style.gap = "6px";
    watchedLabel.style.fontSize = "13px";
    watchedLabel.style.cursor = "pointer";

    const watchedBox = document.createElement("input");
    watchedBox.type = "checkbox";
    watchedBox.checked = l.watched;
    watchedBox.onchange = async () => {
      l.watched = watchedBox.checked;
      await api(`/api/lectures/${l.id}`, { method: "PATCH", body: JSON.stringify({ watched: watchedBox.checked }) });
      await reload();
    };
    watchedLabel.append(watchedBox, document.createTextNode("Watched"));

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-secondary btn-sm";
    closeBtn.textContent = "\u2715 Close";
    closeBtn.onclick = () => {
      state.currentId = null;
      playerContainer.style.display = "none";
      playerContainer.replaceChildren();
      drawCards();
    };

    controlsGroup.append(prevBtn, nextBtn, watchedLabel, closeBtn);
    bar.append(titleGroup, controlsGroup);
    playerCard.append(mediaEl, bar);
    playerContainer.replaceChildren(playerCard);

    drawCards();
    playerContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Device Upload Event Handlers
  if (uploadInput) {
    uploadInput.onchange = async () => {
      const files = [...uploadInput.files].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
      if (!files.length) return;

      const failed = [];
      let count = 0;
      for (const f of files) {
        if (uploadStatus) {
          uploadStatus.textContent = `Uploading ${++count} of ${files.length}: ${f.name} ...`;
        }
        const formData = new FormData();
        formData.append("files", f);
        try {
          const res = await fetch(`/api/folders/${state.folderId}/lectures`, { method: "POST", body: formData });
          if (!res.ok) {
            failed.push(res.status === 413 ? `${f.name} (too large)` : f.name);
          }
        } catch {
          failed.push(f.name);
        }
      }

      if (uploadStatus) {
        uploadStatus.textContent = failed.length
          ? `Upload finished with issues: ${failed.join(", ")}`
          : "All videos uploaded successfully!";
        setTimeout(() => { uploadStatus.textContent = ""; }, 4000);
      }
      uploadInput.value = "";
      await reload();
    };
  }

  // YouTube Form Submit
  if (ytForm) {
    ytForm.onsubmit = async (e) => {
      e.preventDefault();
      const urlInput = document.getElementById("yt-url-input");
      const titleInput = document.getElementById("yt-title-input");
      if (!urlInput || !urlInput.value.trim()) return;

      try {
        await api(`/api/folders/${state.folderId}/lectures/youtube`, {
          method: "POST",
          body: JSON.stringify({ url: urlInput.value.trim(), title: titleInput ? titleInput.value.trim() : "" }),
        });
        ytForm.reset();
        await reload();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  reload();
}
