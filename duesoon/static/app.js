/**
 * DueSoon Core Platform Application Logic
 * Coordinates:
 * - Multi-page view routing and sidebar navigation
 * - Dashboard stats, today's study plan, and deadlines
 * - Planner timetable, assignments, grade projections, and daily capacity
 * - Master To-Do board across all subjects
 * - Student opportunities & research fellowship catalog
 * - Settings & visual theme customization (Warm Light / Dark modes)
 */

// Global API helper
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const msg = (body && body.errors) ? (Array.isArray(body.errors) ? body.errors.join(", ") : body.errors) : "Request failed";
    throw new Error(msg);
  }
  return body;
}

const weekday = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
const shortDate = (iso) => `${weekday(iso)} ${iso.slice(5)}`;

// ==================== VIEW ROUTING & BREADCRUMBS ====================

const VIEWS = ["dashboard", "subjects", "planner", "todos", "opportunities", "settings", "subject-workspace"];
let currentActiveView = "dashboard";

function switchView(viewName) {
  if (!VIEWS.includes(viewName)) viewName = "dashboard";
  currentActiveView = viewName;

  // Update nav item active states
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });

  // Toggle sections
  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.add("hidden");
  });

  const activeSection = document.getElementById(`${viewName}-view`);
  if (activeSection) activeSection.classList.remove("hidden");

  // Close mobile sidebar if open
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.remove("open");

  // Update breadcrumbs and trigger view loaders
  if (viewName === "dashboard") {
    updateBreadcrumbs([{ label: "Dashboard" }]);
    updateDashboard();
  } else if (viewName === "subjects") {
    updateBreadcrumbs([{ label: "My Subjects" }]);
    if (typeof loadSubjectsList === "function") loadSubjectsList();
  } else if (viewName === "planner") {
    updateBreadcrumbs([{ label: "Planner" }]);
    loadPlanner();
  } else if (viewName === "todos") {
    updateBreadcrumbs([{ label: "To-Do List" }]);
    loadGlobalTodos();
  } else if (viewName === "opportunities") {
    updateBreadcrumbs([{ label: "Opportunities & Fellowships" }]);
    loadOpportunities();
  } else if (viewName === "settings") {
    updateBreadcrumbs([{ label: "Settings" }]);
    loadSettings();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateBreadcrumbs(crumbs = []) {
  const container = document.getElementById("breadcrumbs-container");
  if (!container) return;
  container.replaceChildren();

  crumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "separator";
      sep.textContent = "/";
      container.append(sep);
    }

    if (idx === crumbs.length - 1 || !crumb.action) {
      const span = document.createElement("span");
      span.className = "current";
      span.textContent = crumb.label;
      container.append(span);
    } else {
      const btn = document.createElement("span");
      btn.className = "crumb-btn";
      btn.textContent = crumb.label;
      btn.onclick = crumb.action;
      container.append(btn);
    }
  });
}

// Wire Sidebar Navigation
document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
  item.onclick = () => {
    location.hash = item.dataset.view;
    switchView(item.dataset.view);
  };
});

const brandLink = document.getElementById("brand-link");
if (brandLink) {
  brandLink.onclick = (e) => {
    e.preventDefault();
    location.hash = "dashboard";
    switchView("dashboard");
  };
}

// Mobile Menu Toggle
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
if (mobileMenuToggle) {
  mobileMenuToggle.onclick = () => {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.toggle("open");
  };
}

// ==================== THEME MANAGEMENT ====================

function initTheme() {
  const saved = localStorage.getItem("duesoon.theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeControls(saved);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("duesoon.theme", theme);
  updateThemeControls(theme);
}

function updateThemeControls(theme) {
  const label = document.getElementById("theme-toggle-label");
  const icon = document.getElementById("theme-toggle-icon");
  if (label) label.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
  if (icon) {
    icon.innerHTML = theme === "dark"
      ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }
}

const themeToggleBtn = document.getElementById("theme-toggle-btn");
if (themeToggleBtn) {
  themeToggleBtn.onclick = () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    setTheme(current === "dark" ? "light" : "dark");
  };
}

// ==================== DASHBOARD VIEW ====================

async function updateDashboard() {
  const subjectsPromise = api("/api/subjects").catch(() => []);
  const assignmentsPromise = api("/api/assignments").catch(() => []);
  const planPromise = api("/api/plan?hours_per_day=3&autofill=1").catch(() => null);
  const todosPromise = api("/api/todos").catch(() => []);
  const oppsPromise = api("/api/opportunities").catch(() => ({ opportunities: [] }));

  const [subjects, assignments, plan, todos, oppsData] = await Promise.all([
    subjectsPromise,
    assignmentsPromise,
    planPromise,
    todosPromise,
    oppsPromise,
  ]);

  // Greeting and Today Date
  const greetingTitle = document.getElementById("greeting-title");
  const todayDateStr = document.getElementById("today-date-str");
  const studentName = localStorage.getItem("duesoon.student_name") || "Student";
  if (greetingTitle) greetingTitle.textContent = `Welcome back, ${studentName}`;
  if (todayDateStr) {
    const now = new Date();
    todayDateStr.textContent = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  // Stat 1: Subjects Count
  const statSubjects = document.getElementById("dash-stat-subjects");
  if (statSubjects) statSubjects.textContent = subjects.length;

  // Stat 2: Today's Hours & Progress
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayDay = plan && plan.days ? plan.days.find((d) => d.date === todayIso) : null;
  const statHours = document.getElementById("dash-stat-today-hours");
  const statHoursProgress = document.getElementById("dash-stat-today-progress");
  if (statHours) statHours.textContent = todayDay ? `${todayDay.total_hours}h` : "0h";
  if (statHoursProgress && todayDay) {
    const totalSessions = todayDay.items.length;
    const doneSessions = todayDay.items.filter((i) => i.done).length;
    statHoursProgress.textContent = `${doneSessions} of ${totalSessions} study sessions completed`;
  } else if (statHoursProgress) {
    statHoursProgress.textContent = "No sessions planned today";
  }

  // Stat 3: Todos Count
  const statTodos = document.getElementById("dash-stat-todos");
  const statTodosSub = document.getElementById("dash-stat-todos-sub");
  const pendingTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);
  if (statTodos) statTodos.textContent = pendingTodos.length;
  if (statTodosSub) statTodosSub.textContent = `${doneTodos.length} tasks completed`;

  // Sidebar Counts
  const sbTodoCount = document.getElementById("sidebar-todo-count");
  if (sbTodoCount) sbTodoCount.textContent = pendingTodos.length;
  const sbSubCount = document.getElementById("sidebar-subject-count");
  if (sbSubCount) sbSubCount.textContent = subjects.length;

  // Stat 4: Upcoming Deadline
  const statNextDue = document.getElementById("dash-stat-next-due");
  const statNextDueSub = document.getElementById("dash-stat-next-due-sub");
  const pendingAssigns = assignments.filter((a) => !a.done).sort((a, b) => a.due.localeCompare(b.due));
  if (statNextDue) {
    if (pendingAssigns.length) {
      statNextDue.textContent = pendingAssigns[0].title;
      if (statNextDueSub) statNextDueSub.textContent = `Due ${shortDate(pendingAssigns[0].due)} (${pendingAssigns[0].course})`;
    } else {
      statNextDue.textContent = "All clear";
      if (statNextDueSub) statNextDueSub.textContent = "No upcoming deadlines";
    }
  }

  // Today's Study Sessions List
  const todayListEl = document.getElementById("dash-today-sessions-list");
  if (todayListEl) {
    todayListEl.replaceChildren();
    if (!todayDay || !todayDay.items.length) {
      todayListEl.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:10px 0;">No study sessions scheduled for today. Take a break or add assignments in Planner!</p>`;
    } else {
      for (const item of todayDay.items) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.padding = "10px 14px";
        row.style.borderRadius = "var(--radius-md)";
        row.style.backgroundColor = "var(--bg-card-subtle)";
        row.style.border = "1px solid var(--border-subtle)";
        row.style.marginBottom = "8px";

        const left = document.createElement("label");
        left.style.display = "flex";
        left.style.alignItems = "center";
        left.style.gap = "10px";
        left.style.cursor = "pointer";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!item.done;
        chk.onchange = async () => {
          await api(`/api/assignments/${item.task_id}/allocations/${todayIso}`, {
            method: "PATCH",
            body: JSON.stringify({ done: chk.checked, hours: item.hours }),
          });
          updateDashboard();
        };

        const span = document.createElement("span");
        span.style.fontSize = "13px";
        span.style.fontWeight = "500";
        if (item.done) {
          span.style.textDecoration = "line-through";
          span.style.opacity = "0.6";
        }
        span.textContent = `${item.title} (${item.course})`;

        left.append(chk, span);

        const right = document.createElement("span");
        right.className = "stat-pill";
        right.textContent = `${item.hours}h${item.start_time ? " @" + item.start_time : ""}`;

        row.append(left, right);
        todayListEl.append(row);
      }
    }
  }

  // Upcoming Assignments List
  const upcomingListEl = document.getElementById("dash-upcoming-assignments-list");
  if (upcomingListEl) {
    upcomingListEl.replaceChildren();
    if (!pendingAssigns.length) {
      upcomingListEl.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:10px 0;">No upcoming assignments. Click "+ Add" to track your coursework.</p>`;
    } else {
      for (const a of pendingAssigns.slice(0, 5)) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.padding = "10px 14px";
        row.style.borderRadius = "var(--radius-md)";
        row.style.backgroundColor = "var(--bg-card-subtle)";
        row.style.border = "1px solid var(--border-subtle)";
        row.style.marginBottom = "8px";

        const info = document.createElement("div");
        info.innerHTML = `
          <div style="font-size:13px; font-weight:600;">${a.title}</div>
          <div style="font-size:11px; color:var(--text-muted);">${a.course} \u2022 Weight: ${a.weight}% \u2022 ${a.hours}h est.</div>
        `;

        const badge = document.createElement("span");
        badge.className = "stat-pill";
        badge.textContent = `Due ${shortDate(a.due)}`;

        row.append(info, badge);
        upcomingListEl.append(row);
      }
    }
  }

  // Subjects Preview Grid
  const subPreviewEl = document.getElementById("dash-subjects-preview-grid");
  if (subPreviewEl) {
    subPreviewEl.replaceChildren();
    if (!subjects.length) {
      subPreviewEl.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:10px 0;">No subjects added yet. Create one to organize materials and notes!</p>`;
    } else {
      for (const s of subjects.slice(0, 4)) {
        const card = document.createElement("div");
        card.style.display = "flex";
        card.style.alignItems = "center";
        card.style.justifyContent = "space-between";
        card.style.padding = "12px 14px";
        card.style.borderRadius = "var(--radius-md)";
        card.style.backgroundColor = "var(--bg-card-subtle)";
        card.style.border = "1px solid var(--border-subtle)";
        card.style.cursor = "pointer";

        const left = document.createElement("div");
        left.style.display = "flex";
        left.style.alignItems = "center";
        left.style.gap = "10px";

        const dot = document.createElement("span");
        dot.style.width = "10px";
        dot.style.height = "10px";
        dot.style.borderRadius = "50%";
        dot.style.backgroundColor = s.color || "#8A9A7B";

        const nameSpan = document.createElement("span");
        nameSpan.style.fontSize = "14px";
        nameSpan.style.fontWeight = "600";
        nameSpan.textContent = s.name;

        left.append(dot, nameSpan);

        const openBtn = document.createElement("span");
        openBtn.style.fontSize = "12px";
        openBtn.style.color = "var(--accent-primary)";
        openBtn.style.fontWeight = "600";
        openBtn.innerHTML = "Workspace &rarr;";

        card.append(left, openBtn);
        card.onclick = () => openSubjectWorkspace(s.id);
        subPreviewEl.append(card);
      }
    }
  }

  // Opportunities Spotlight
  const oppSpotlightEl = document.getElementById("dash-opportunities-spotlight");
  if (oppSpotlightEl && oppsData.opportunities) {
    oppSpotlightEl.replaceChildren();
    for (const opp of oppsData.opportunities.slice(0, 3)) {
      const card = document.createElement("div");
      card.style.padding = "12px 14px";
      card.style.borderRadius = "var(--radius-md)";
      card.style.backgroundColor = "var(--bg-card-subtle)";
      card.style.border = "1px solid var(--border-subtle)";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
          <strong style="font-size:13px;">${opp.title}</strong>
          <span class="stat-pill" style="font-size:10px;">${opp.mode}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">${opp.organization} \u2022 ${opp.stipend}</div>
        <a href="${opp.apply_url}" target="_blank" rel="noopener noreferrer" style="font-size:12px; color:var(--accent-terracotta); text-decoration:none; font-weight:600;">View & Apply &rarr;</a>
      `;
      oppSpotlightEl.append(card);
    }
  }
}

// Dash button connections
const dashOpenPlanner = document.getElementById("dash-open-planner");
const dashViewAllSubjects = document.getElementById("dash-view-all-subjects");
const dashBrowseOpps = document.getElementById("dash-browse-opps");
const dashAddAssignment = document.getElementById("dash-add-assignment-btn");
if (dashOpenPlanner) dashOpenPlanner.onclick = () => switchView("planner");
if (dashViewAllSubjects) dashViewAllSubjects.onclick = () => switchView("subjects");
if (dashBrowseOpps) dashBrowseOpps.onclick = () => switchView("opportunities");
if (dashAddAssignment) dashAddAssignment.onclick = () => openAssignmentModal();

// ==================== PLANNER VIEW ====================

let activePlannerTab = "schedule";

function loadPlanner() {
  setupPlannerTabs();
  renderPlannerSubTab(activePlannerTab);
}

function setupPlannerTabs() {
  const btnSched = document.getElementById("btn-planner-tab-schedule");
  const btnAssign = document.getElementById("btn-planner-tab-assignments");
  const btnCap = document.getElementById("btn-planner-tab-capacity");

  if (btnSched) btnSched.onclick = () => renderPlannerSubTab("schedule");
  if (btnAssign) btnAssign.onclick = () => renderPlannerSubTab("assignments");
  if (btnCap) btnCap.onclick = () => renderPlannerSubTab("capacity");
}

function renderPlannerSubTab(tab) {
  activePlannerTab = tab;
  const secSched = document.getElementById("planner-schedule-section");
  const secAssign = document.getElementById("planner-assignments-section");
  const secCap = document.getElementById("planner-capacity-section");

  const btnSched = document.getElementById("btn-planner-tab-schedule");
  const btnAssign = document.getElementById("btn-planner-tab-assignments");
  const btnCap = document.getElementById("btn-planner-tab-capacity");

  if (secSched) secSched.classList.toggle("hidden", tab !== "schedule");
  if (secAssign) secAssign.classList.toggle("hidden", tab !== "assignments");
  if (secCap) secCap.classList.toggle("hidden", tab !== "capacity");

  if (btnSched) btnSched.classList.toggle("btn-primary", tab === "schedule");
  if (btnAssign) btnAssign.classList.toggle("btn-primary", tab === "assignments");
  if (btnCap) btnCap.classList.toggle("btn-primary", tab === "capacity");

  if (tab === "schedule") renderPlannerSchedule();
  else if (tab === "assignments") renderPlannerAssignments();
  else if (tab === "capacity") renderPlannerCapacity();
}

async function renderPlannerSchedule() {
  const container = document.getElementById("planner-days-container");
  const alertsBox = document.getElementById("planner-alerts-box");
  const hpdInput = document.getElementById("hpd-input");
  const autofillBox = document.getElementById("autofill-checkbox");
  if (!container) return;

  const hpd = hpdInput ? hpdInput.value : 3;
  const autofill = autofillBox && autofillBox.checked ? 1 : 0;

  try {
    const plan = await api(`/api/plan?hours_per_day=${encodeURIComponent(hpd)}&autofill=${autofill}`);

    // Render Alerts (At risk & Missed)
    if (alertsBox) {
      alertsBox.replaceChildren();
      if (plan.at_risk && plan.at_risk.length) {
        for (const r of plan.at_risk) {
          const alertEl = document.createElement("div");
          alertEl.style.padding = "10px 14px";
          alertEl.style.borderRadius = "var(--radius-md)";
          alertEl.style.backgroundColor = "var(--danger-bg)";
          alertEl.style.color = "var(--danger)";
          alertEl.style.fontSize = "13px";
          alertEl.style.marginBottom = "8px";
          alertEl.textContent = `⚠️ Warning: "${r.title}" is short by ${r.short_by_hours}h before deadline ${r.due}${r.overdue ? " (Overdue)" : ""}`;
          alertsBox.append(alertEl);
        }
      }

      if (plan.missed && plan.missed.length) {
        for (const m of plan.missed) {
          const missedEl = document.createElement("div");
          missedEl.style.padding = "10px 14px";
          missedEl.style.borderRadius = "var(--radius-md)";
          missedEl.style.backgroundColor = "var(--warning-bg)";
          missedEl.style.color = "var(--warning)";
          missedEl.style.fontSize = "13px";
          missedEl.style.display = "flex";
          missedEl.style.alignItems = "center";
          missedEl.style.justifyContent = "space-between";
          missedEl.style.marginBottom = "8px";

          const txt = document.createElement("span");
          txt.textContent = `Missed session: ${m.hours}h on ${m.date} for "${m.title}". Hours returned to plan.`;

          const doneBtn = document.createElement("button");
          doneBtn.className = "btn btn-secondary btn-sm";
          doneBtn.style.fontSize = "11px";
          doneBtn.textContent = "Mark as Done";
          doneBtn.onclick = async () => {
            await api(`/api/assignments/${m.task_id}/allocations/${m.date}`, {
              method: "PATCH",
              body: JSON.stringify({ done: true, hours: m.hours }),
            });
            renderPlannerSchedule();
          };

          missedEl.append(txt, doneBtn);
          alertsBox.append(missedEl);
        }
      }
    }

    container.replaceChildren();
    if (!plan.days || !plan.days.length) {
      container.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:20px 0;">No active study days planned. Add assignments or adjust capacity.</p>`;
      return;
    }

    for (const day of plan.days) {
      const dayCard = document.createElement("div");
      dayCard.style.padding = "14px 18px";
      dayCard.style.borderRadius = "var(--radius-md)";
      dayCard.style.backgroundColor = "var(--bg-card-subtle)";
      dayCard.style.border = "1px solid var(--border-subtle)";

      const dayHeader = document.createElement("div");
      dayHeader.style.display = "flex";
      dayHeader.style.alignItems = "center";
      dayHeader.style.justifyContent = "space-between";
      dayHeader.style.marginBottom = "10px";

      const title = document.createElement("strong");
      title.style.fontSize = "14px";
      title.textContent = `${weekday(day.date)}, ${day.date}`;

      const capInfo = document.createElement("span");
      capInfo.style.fontSize = "12px";
      capInfo.style.color = day.overbooked ? "var(--danger)" : "var(--text-muted)";
      capInfo.textContent = `${day.total_hours}h of ${day.capacity}h capacity${day.overbooked ? " (Overbooked!)" : ""}`;

      dayHeader.append(title, capInfo);
      dayCard.append(dayHeader);

      const itemsList = document.createElement("div");
      itemsList.style.display = "flex";
      itemsList.style.flexDirection = "column";
      itemsList.style.gap = "6px";

      for (const item of day.items) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.padding = "6px 10px";
        row.style.borderRadius = "var(--radius-sm)";
        row.style.backgroundColor = "var(--bg-card)";
        row.style.border = "1px solid var(--border-subtle)";

        const left = document.createElement("label");
        left.style.display = "flex";
        left.style.alignItems = "center";
        left.style.gap = "8px";
        left.style.cursor = "pointer";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!item.done;
        chk.onchange = async () => {
          await api(`/api/assignments/${item.task_id}/allocations/${day.date}`, {
            method: "PATCH",
            body: JSON.stringify({ done: chk.checked, hours: item.hours }),
          });
          renderPlannerSchedule();
        };

        const span = document.createElement("span");
        span.style.fontSize = "13px";
        if (item.done) {
          span.style.textDecoration = "line-through";
          span.style.opacity = "0.6";
        }
        span.textContent = `${item.title} (${item.course})`;

        left.append(chk, span);

        const badge = document.createElement("span");
        badge.className = "stat-pill";
        badge.style.fontSize = "11px";
        badge.textContent = `${item.hours}h${item.start_time ? " @" + item.start_time : ""}${item.manual ? " (pinned)" : ""}`;

        row.append(left, badge);
        itemsList.append(row);
      }

      dayCard.append(itemsList);
      container.append(dayCard);
    }
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger)">Error loading plan: ${err.message}</div>`;
  }
}

const btnRefreshPlan = document.getElementById("btn-refresh-plan");
if (btnRefreshPlan) btnRefreshPlan.onclick = () => renderPlannerSchedule();

// Assignments List & Grade Projection
async function renderPlannerAssignments() {
  const container = document.getElementById("planner-assignments-list");
  const gradesContainer = document.getElementById("grade-summary-container");
  const targetInput = document.getElementById("grade-target-input");
  if (!container) return;

  try {
    const assignments = await api("/api/assignments");
    container.replaceChildren();

    if (!assignments.length) {
      container.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:16px;">No assignments recorded yet. Click "+ Add Assignment" above.</p>`;
    } else {
      for (const a of assignments) {
        const item = document.createElement("div");
        item.style.padding = "14px 18px";
        item.style.borderRadius = "var(--radius-md)";
        item.style.backgroundColor = "var(--bg-card-subtle)";
        item.style.border = "1px solid var(--border-subtle)";
        item.style.display = "flex";
        item.style.flexDirection = "column";
        item.style.gap = "8px";

        const top = document.createElement("div");
        top.style.display = "flex";
        top.style.alignItems = "center";
        top.style.justifyContent = "space-between";
        top.style.flexWrap = "wrap";
        top.style.gap = "8px";

        const left = document.createElement("div");
        left.style.display = "flex";
        left.style.alignItems = "center";
        left.style.gap = "8px";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!a.done;
        chk.onchange = async () => {
          await api(`/api/assignments/${a.id}`, { method: "PATCH", body: JSON.stringify({ done: chk.checked }) });
          renderPlannerAssignments();
        };

        const title = document.createElement("strong");
        title.style.fontSize = "14px";
        if (a.done) {
          title.style.textDecoration = "line-through";
          title.style.opacity = "0.6";
        }
        title.textContent = `${a.title} (${a.course})`;

        left.append(chk, title);

        const right = document.createElement("div");
        right.style.display = "flex";
        right.style.alignItems = "center";
        right.style.gap = "8px";

        // Score input
        const scoreLabel = document.createElement("label");
        scoreLabel.style.fontSize = "12px";
        scoreLabel.style.display = "flex";
        scoreLabel.style.alignItems = "center";
        scoreLabel.style.gap = "4px";
        scoreLabel.textContent = "Score %:";

        const scoreInput = document.createElement("input");
        scoreInput.type = "number";
        scoreInput.min = 0;
        scoreInput.max = 100;
        scoreInput.placeholder = "--";
        scoreInput.value = a.score ?? "";
        scoreInput.className = "form-input";
        scoreInput.style.width = "65px";
        scoreInput.style.padding = "3px 6px";
        scoreInput.style.fontSize = "12px";
        scoreInput.onchange = async () => {
          await api(`/api/assignments/${a.id}`, {
            method: "PATCH",
            body: JSON.stringify({ score: scoreInput.value === "" ? null : Number(scoreInput.value) }),
          });
          renderPlannerAssignments();
        };
        scoreLabel.append(scoreInput);

        // Delete button
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-danger btn-sm";
        delBtn.style.padding = "3px 8px";
        delBtn.textContent = "Delete";
        delBtn.onclick = async () => {
          if (!confirm(`Delete assignment "${a.title}"?`)) return;
          await api(`/api/assignments/${a.id}`, { method: "DELETE" });
          renderPlannerAssignments();
        };

        right.append(scoreLabel, delBtn);
        top.append(left, right);

        // Meta info row
        const meta = document.createElement("div");
        meta.style.fontSize = "12px";
        meta.style.color = "var(--text-muted)";
        meta.textContent = `${a.start ? a.start + " to " + a.due : "Due " + a.due} \u2022 Weight: ${a.weight}% \u2022 Total: ${a.hours}h (${a.done_hours || 0}h completed)`;

        item.append(top, meta);
        container.append(item);
      }
    }

    // Render Grade Projections
    if (gradesContainer) {
      const target = targetInput ? targetInput.value : 90;
      const grades = await api(`/api/grades?target=${encodeURIComponent(target)}`);
      gradesContainer.replaceChildren();

      const grid = document.createElement("div");
      grid.className = "dashboard-stats-grid";
      grid.style.marginBottom = "0";

      const c1 = document.createElement("div");
      c1.className = "stat-card";
      c1.innerHTML = `<span class="stat-label">Graded Weight</span><div class="stat-value">${grades.graded_weight}%</div><span class="stat-sub">of final grade</span>`;

      const c2 = document.createElement("div");
      c2.className = "stat-card";
      c2.innerHTML = `<span class="stat-label">Current Standing</span><div class="stat-value">${grades.current_average != null ? grades.current_average + "%" : "--"}</div><span class="stat-sub">${grades.points_earned} points secured</span>`;

      const c3 = document.createElement("div");
      c3.className = "stat-card";
      let statusStr = "Unknown";
      if (grades.already_secured) statusStr = "Target Already Secured! 🎉";
      else if (grades.achievable) statusStr = `Need ${grades.needed_on_remaining}% on remaining`;
      else statusStr = "Target out of reach mathematically";
      c3.innerHTML = `<span class="stat-label">Target (${target}%) Standing</span><div class="stat-value" style="font-size:22px; margin-top:8px;">${grades.needed_on_remaining != null ? grades.needed_on_remaining + "%" : "--"}</div><span class="stat-sub">${statusStr}</span>`;

      grid.append(c1, c2, c3);
      gradesContainer.append(grid);
    }
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger)">Error: ${err.message}</div>`;
  }
}

const gradeTargetInput = document.getElementById("grade-target-input");
if (gradeTargetInput) gradeTargetInput.onchange = () => renderPlannerAssignments();

// Daily Capacity Overrides
async function renderPlannerCapacity() {
  const container = document.getElementById("capacity-overrides-list");
  if (!container) return;

  try {
    const overrides = await api("/api/capacity");
    container.replaceChildren();

    if (!overrides.length) {
      container.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:10px 0;">No date-specific capacity overrides set. All dates use your default study hours.</p>`;
      return;
    }

    for (const ov of overrides) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.padding = "8px 14px";
      row.style.borderRadius = "var(--radius-md)";
      row.style.backgroundColor = "var(--bg-card-subtle)";
      row.style.border = "1px solid var(--border-subtle)";

      const info = document.createElement("span");
      info.style.fontSize = "13px";
      info.innerHTML = `<strong>${weekday(ov.day)}, ${ov.day}:</strong> ${ov.hours} available hours ${ov.hours === 0 ? "<em>(Day Off)</em>" : ""}`;

      const del = document.createElement("button");
      del.className = "btn btn-danger btn-sm";
      del.style.padding = "2px 6px";
      del.textContent = "Remove";
      del.onclick = async () => {
        await api(`/api/capacity/${ov.day}`, { method: "DELETE" });
        renderPlannerCapacity();
      };

      row.append(info, del);
      container.append(row);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--danger)">Error: ${e.message}</div>`;
  }
}

const capForm = document.getElementById("capacity-override-form");
if (capForm) {
  capForm.onsubmit = async (e) => {
    e.preventDefault();
    const day = document.getElementById("cap-override-date").value;
    const hours = document.getElementById("cap-override-hours").value;
    if (!day || hours === "") return;

    try {
      await api(`/api/capacity/${day}`, { method: "PUT", body: JSON.stringify({ hours: Number(hours) }) });
      document.getElementById("cap-override-hours").value = "";
      renderPlannerCapacity();
    } catch (err) {
      alert(err.message);
    }
  };
}

// Assignment Modal Handlers
function openAssignmentModal() {
  const modal = document.getElementById("assignment-modal");
  const datalist = document.getElementById("subject-datalist");
  if (!modal) return;

  // Populate subject datalist
  api("/api/subjects").then((subjects) => {
    if (datalist) {
      datalist.replaceChildren();
      for (const s of subjects) {
        const opt = document.createElement("option");
        opt.value = s.name;
        datalist.append(opt);
      }
    }
  });

  modal.classList.remove("hidden");
}

function closeAssignmentModal() {
  const modal = document.getElementById("assignment-modal");
  if (modal) modal.classList.add("hidden");
}

const assignModalClose = document.getElementById("assignment-modal-close");
const assignModalCancel = document.getElementById("assignment-modal-cancel");
const assignModalForm = document.getElementById("assignment-modal-form");
const plannerOpenAssign = document.getElementById("planner-open-assignment-modal");

if (plannerOpenAssign) plannerOpenAssign.onclick = openAssignmentModal;
if (assignModalClose) assignModalClose.onclick = closeAssignmentModal;
if (assignModalCancel) assignModalCancel.onclick = closeAssignmentModal;

if (assignModalForm) {
  assignModalForm.onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById("assign-modal-title").value.trim();
    const course = document.getElementById("assign-modal-course").value.trim();
    const start = document.getElementById("assign-modal-start").value || null;
    const due = document.getElementById("assign-modal-due").value;
    const weight = Number(document.getElementById("assign-modal-weight").value);
    const hours = Number(document.getElementById("assign-modal-hours").value);

    try {
      await api("/api/assignments", {
        method: "POST",
        body: JSON.stringify({ title, course, start, due, weight, hours }),
      });
      closeAssignmentModal();
      assignModalForm.reset();
      renderPlannerSubTab(activePlannerTab);
      updateDashboard();
    } catch (err) {
      alert(`Error saving assignment: ${err.message}`);
    }
  };
}

// ==================== GLOBAL TO-DO LIST VIEW ====================

async function loadGlobalTodos() {
  const container = document.getElementById("global-todos-container");
  const searchInput = document.getElementById("global-todo-search");
  const subjectFilter = document.getElementById("global-todo-subject-filter");
  const statusToggle = document.getElementById("global-todo-status-toggle");
  if (!container) return;

  const [todos, subjects] = await Promise.all([
    api("/api/todos").catch(() => []),
    api("/api/subjects").catch(() => []),
  ]);

  // Populate subject filter dropdown
  if (subjectFilter && subjectFilter.options.length <= 1) {
    for (const s of subjects) {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name;
      subjectFilter.append(opt);
    }
  }

  // Active filter states
  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : "";
  const selectedSub = subjectFilter ? subjectFilter.value : "all";
  const activeStatusBtn = statusToggle ? statusToggle.querySelector("button.active") : null;
  const statusVal = activeStatusBtn ? activeStatusBtn.dataset.status : "all";

  let filtered = todos;
  if (searchVal) filtered = filtered.filter((t) => t.text.toLowerCase().includes(searchVal));
  if (selectedSub !== "all") filtered = filtered.filter((t) => t.subject_name === selectedSub);
  if (statusVal === "pending") filtered = filtered.filter((t) => !t.done);
  else if (statusVal === "completed") filtered = filtered.filter((t) => t.done);

  container.replaceChildren();

  if (!filtered.length) {
    container.innerHTML = `<p style="font-size:13px; color:var(--text-muted); padding:24px; text-align:center;">No matching tasks found.</p>`;
    return;
  }

  for (const t of filtered) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.padding = "10px 14px";
    row.style.borderRadius = "var(--radius-md)";
    row.style.backgroundColor = "var(--bg-card-subtle)";
    row.style.border = "1px solid var(--border-subtle)";
    row.style.gap = "12px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "10px";
    left.style.minWidth = "0";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!t.done;
    chk.onchange = async () => {
      await api(`/api/todos/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: chk.checked }) });
      loadGlobalTodos();
    };

    const textSpan = document.createElement("span");
    textSpan.style.fontSize = "13px";
    textSpan.style.fontWeight = "500";
    if (t.done) {
      textSpan.style.textDecoration = "line-through";
      textSpan.style.opacity = "0.6";
    }
    textSpan.textContent = t.text;

    left.append(chk, textSpan);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";
    right.style.flexShrink = "0";

    const subBadge = document.createElement("span");
    subBadge.className = "stat-pill";
    subBadge.style.borderColor = t.subject_color || "#8A9A7B";
    subBadge.style.color = "var(--text-primary)";
    subBadge.textContent = t.subject_name;

    right.append(subBadge);

    if (t.priority) {
      const pBadge = document.createElement("span");
      pBadge.className = "stat-pill";
      pBadge.style.fontSize = "10px";
      pBadge.textContent = t.priority;
      right.append(pBadge);
    }

    if (t.due_date) {
      const dBadge = document.createElement("span");
      dBadge.className = "stat-pill";
      dBadge.style.fontSize = "10px";
      dBadge.textContent = t.due_date;
      right.append(dBadge);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.style.padding = "2px 6px";
    delBtn.style.fontSize = "10px";
    delBtn.textContent = "\u2715";
    delBtn.onclick = async () => {
      await api(`/api/todos/${t.id}`, { method: "DELETE" });
      loadGlobalTodos();
    };

    right.append(delBtn);
    row.append(left, right);
    container.append(row);
  }
}

// Global Todo Filter Listeners
const globalTodoSearch = document.getElementById("global-todo-search");
const globalTodoSubjectFilter = document.getElementById("global-todo-subject-filter");
const globalTodoStatusToggle = document.getElementById("global-todo-status-toggle");

if (globalTodoSearch) globalTodoSearch.oninput = loadGlobalTodos;
if (globalTodoSubjectFilter) globalTodoSubjectFilter.onchange = loadGlobalTodos;
if (globalTodoStatusToggle) {
  globalTodoStatusToggle.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      globalTodoStatusToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadGlobalTodos();
    };
  });
}

// Quick Add Task in Top Nav
const btnQuickAddTask = document.getElementById("btn-quick-add-task");
const btnMasterAddTodo = document.getElementById("btn-master-add-todo");

function promptQuickTask() {
  api("/api/subjects").then((subjects) => {
    if (!subjects.length) {
      alert("Please create a subject first before adding tasks.");
      openSubjectModal();
      return;
    }
    const text = prompt("Enter new task:");
    if (!text || !text.trim()) return;

    // Pick first subject or let user choose
    const subject = subjects[0];
    api(`/api/subjects/${subject.id}/todos`, {
      method: "POST",
      body: JSON.stringify({ text: text.trim(), priority: "Medium" }),
    }).then(() => {
      updateDashboard();
      if (currentActiveView === "todos") loadGlobalTodos();
    });
  });
}

if (btnQuickAddTask) btnQuickAddTask.onclick = promptQuickTask;
if (btnMasterAddTodo) btnMasterAddTodo.onclick = promptQuickTask;

// ==================== OPPORTUNITIES & FELLOWSHIPS ====================

async function loadOpportunities() {
  const container = document.getElementById("opportunities-container");
  const searchInput = document.getElementById("opp-search-input");
  const typeFilter = document.getElementById("opp-type-filter");
  const fieldFilter = document.getElementById("opp-field-filter");
  const modeFilter = document.getElementById("opp-mode-filter");
  if (!container) return;

  const q = searchInput ? searchInput.value.trim() : "";
  const type = typeFilter ? typeFilter.value : "all";
  const field = fieldFilter ? fieldFilter.value : "all";
  const mode = modeFilter ? modeFilter.value : "all";

  const queryParams = new URLSearchParams();
  if (q) queryParams.set("q", q);
  if (type !== "all") queryParams.set("type", type);
  if (field !== "all") queryParams.set("field", field);
  if (mode !== "all") queryParams.set("mode", mode);

  try {
    const data = await api(`/api/opportunities?${queryParams.toString()}`);
    container.replaceChildren();

    if (!data.opportunities.length) {
      container.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align:center; padding:36px 20px;">No opportunities matched your search criteria.</div>`;
      return;
    }

    for (const opp of data.opportunities) {
      const card = document.createElement("div");
      card.className = "opp-card";

      // Badge type
      const badge = document.createElement("span");
      badge.className = `opp-card-badge ${opp.type}`;
      badge.textContent = opp.type.toUpperCase();

      const title = document.createElement("h3");
      title.className = "opp-title";
      title.textContent = opp.title;

      const org = document.createElement("div");
      org.className = "opp-org";
      org.textContent = `${opp.organization} \u2022 ${opp.location}`;

      const desc = document.createElement("p");
      desc.className = "opp-desc";
      desc.textContent = opp.description;

      const metaRow = document.createElement("div");
      metaRow.className = "opp-meta-row";
      metaRow.innerHTML = `
        <span><strong>Stipend:</strong> ${opp.stipend}</span>
        <span><strong>Deadline:</strong> ${opp.deadline}</span>
      `;

      const tagsRow = document.createElement("div");
      tagsRow.style.display = "flex";
      tagsRow.style.gap = "6px";
      tagsRow.style.flexWrap = "wrap";
      tagsRow.style.marginBottom = "16px";
      for (const tag of opp.tags || []) {
        const tSpan = document.createElement("span");
        tSpan.className = "stat-pill";
        tSpan.style.fontSize = "10px";
        tSpan.textContent = tag;
        tagsRow.append(tSpan);
      }

      const applyBtn = document.createElement("a");
      applyBtn.className = "btn btn-primary";
      applyBtn.style.width = "100%";
      applyBtn.href = opp.apply_url;
      applyBtn.target = "_blank";
      applyBtn.rel = "noopener noreferrer";
      applyBtn.textContent = "Learn More & Apply \u2197";

      card.append(badge, title, org, desc, metaRow, tagsRow, applyBtn);
      container.append(card);
    }
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger)">Error: ${err.message}</div>`;
  }
}

// Opportunities Filter Listeners
const oppSearchInput = document.getElementById("opp-search-input");
const oppTypeFilter = document.getElementById("opp-type-filter");
const oppFieldFilter = document.getElementById("opp-field-filter");
const oppModeFilter = document.getElementById("opp-mode-filter");

if (oppSearchInput) oppSearchInput.oninput = loadOpportunities;
if (oppTypeFilter) oppTypeFilter.onchange = loadOpportunities;
if (oppFieldFilter) oppFieldFilter.onchange = loadOpportunities;
if (oppModeFilter) oppModeFilter.onchange = loadOpportunities;

// ==================== SETTINGS VIEW ====================

function loadSettings() {
  const nameInput = document.getElementById("settings-user-name");
  const degreeInput = document.getElementById("settings-user-degree");
  const aiProvider = document.getElementById("settings-ai-provider");
  const aiStatusAlert = document.getElementById("settings-ai-status-alert");

  if (nameInput) nameInput.value = localStorage.getItem("duesoon.student_name") || "";
  if (degreeInput) degreeInput.value = localStorage.getItem("duesoon.student_degree") || "";

  // Check current AI status
  api("/api/ai/status").then((st) => {
    if (aiStatusAlert) {
      aiStatusAlert.innerHTML = st.configured
        ? `<div style="padding:10px 14px; border-radius:var(--radius-md); background:var(--success-bg); color:var(--success);">✅ AI Assistant active: using ${st.provider} (${st.model})</div>`
        : `<div style="padding:10px 14px; border-radius:var(--radius-md); background:var(--warning-bg); color:var(--warning);">⚠️ AI API key not found in environment. Set ANTHROPIC_API_KEY or OPENAI_API_KEY before starting server.</div>`;
    }
    if (aiProvider && st.provider) aiProvider.value = st.provider;
  }).catch(() => {});
}

// Theme buttons in Settings
const btnThemeLight = document.getElementById("btn-theme-light");
const btnThemeDark = document.getElementById("btn-theme-dark");
if (btnThemeLight) btnThemeLight.onclick = () => setTheme("light");
if (btnThemeDark) btnThemeDark.onclick = () => setTheme("dark");

// Save Profile
const btnSaveProfile = document.getElementById("settings-save-profile");
if (btnSaveProfile) {
  btnSaveProfile.onclick = () => {
    const name = document.getElementById("settings-user-name").value.trim();
    const degree = document.getElementById("settings-user-degree").value.trim();
    localStorage.setItem("duesoon.student_name", name);
    localStorage.setItem("duesoon.student_degree", degree);
    alert("Profile saved successfully!");
    updateDashboard();
  };
}

// Save AI Config notice
const btnSaveAI = document.getElementById("settings-save-ai");
if (btnSaveAI) {
  btnSaveAI.onclick = () => {
    alert("To configure Claude or OpenAI API keys permanently, set them as environment variables (ANTHROPIC_API_KEY or OPENAI_API_KEY) in your shell as explained in README.md.");
  };
}

// ==================== INITIALIZATION ====================

window.addEventListener("DOMContentLoaded", () => {
  initTheme();

  // Handle URL hash navigation
  const hash = location.hash.slice(1);
  if (hash && VIEWS.includes(hash)) {
    switchView(hash);
  } else {
    switchView("dashboard");
  }

  // Pre-load counts
  api("/api/subjects").then((s) => {
    const sb = document.getElementById("sidebar-subject-count");
    if (sb) sb.textContent = s.length;
  }).catch(() => {});
});
