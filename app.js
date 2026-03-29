import {
  categories, venues,
  detectConflicts, suggestTimeSlots,
  generateInvitation, generateReminderSchedule,
} from "./data.js";
import { signIn, signUp, signOut, onAuthChange } from "./auth.js";
import { supabase } from "./supabase.js";

// --- State ---
let events = [];
let currentAdmin = null;
let editingId = null;
let invitesSent = 0;

const catColors = {
  "Worship": "cat-worship", "Youth": "cat-youth", "Community": "cat-community",
  "Bible Study": "cat-bible", "Fundraiser": "cat-fundraiser", "Special Service": "cat-special",
};

// --- Init ---
async function init() {
  populateSelects();
  bindEvents();

  // Auth state drives everything
  onAuthChange((user) => {
    currentAdmin = user;
    updateAuthUI();
  });

  await loadEvents();
}

// --- Supabase: load events ---
async function loadEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (error) { console.error("Load events error:", error.message); return; }

  // Normalize: supabase returns snake_case, map to our shape
  events = (data || []).map(dbToEvent);
  renderDashboard();
  renderEventsList();
  populateReminderSelect();
  populateInviteSelect();
}

function dbToEvent(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    venue: row.venue,
    date: row.date,
    time: row.time.slice(0, 5), // "HH:MM:SS" → "HH:MM"
    duration: row.duration,
    recurring: row.recurring,
    description: row.description || "",
  };
}

function eventToDb(event) {
  return {
    title: event.title,
    category: event.category,
    venue: event.venue,
    date: event.date,
    time: event.time,
    duration: event.duration,
    recurring: event.recurring,
    description: event.description,
  };
}

// --- Supabase: save event ---
async function saveEvent(e) {
  e.preventDefault();
  const formEvent = getFormEvent();
  const payload = eventToDb(formEvent);

  let error;
  if (editingId) {
    ({ error } = await supabase.from("events").update(payload).eq("id", editingId));
  } else {
    ({ error } = await supabase.from("events").insert(payload));
  }

  if (error) { alert("Error saving event: " + error.message); return; }
  closeModal();
  await loadEvents();
}

// --- Supabase: delete event ---
async function deleteEventById(id) {
  if (!confirm("Delete this event?")) return;
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) { alert("Error deleting event: " + error.message); return; }
  await loadEvents();
}

// --- Populate selects ---
function populateSelects() {
  const catSelect = document.getElementById("eventCategory");
  const filterCat = document.getElementById("filterCategory");
  categories.forEach((c) => {
    catSelect.innerHTML += `<option value="${c}">${c}</option>`;
    filterCat.innerHTML += `<option value="${c}">${c}</option>`;
  });
  const venueSelect = document.getElementById("eventVenue");
  venues.forEach((v) => { venueSelect.innerHTML += `<option value="${v}">${v}</option>`; });
}

// --- Dashboard ---
function renderDashboard() {
  const totalReminders = events.reduce((sum, e) => sum + generateReminderSchedule(e).length, 0);
  const conflicts = countAllConflicts();
  document.getElementById("statTotal").textContent = events.length;
  document.getElementById("statReminders").textContent = totalReminders;
  document.getElementById("statInvites").textContent = invitesSent;
  document.getElementById("statConflicts").textContent = conflicts;

  const upcoming = [...events]
    .filter((e) => new Date(`${e.date}T${e.time}`) >= new Date())
    .slice(0, 5);

  const container = document.getElementById("upcomingEvents");
  container.innerHTML = upcoming.length
    ? upcoming.map(renderEventCard).join("")
    : emptyState("No upcoming events", "📅");
}

function countAllConflicts() {
  let count = 0;
  for (const event of events) {
    if (detectConflicts(events, event).length > 0) count++;
  }
  return Math.floor(count / 2);
}

// --- Events list ---
function renderEventsList() {
  const search = document.getElementById("searchEvents").value.toLowerCase();
  const category = document.getElementById("filterCategory").value;
  const filtered = events.filter((e) => {
    const matchSearch = e.title.toLowerCase().includes(search) || e.description.toLowerCase().includes(search);
    const matchCat = !category || e.category === category;
    return matchSearch && matchCat;
  });
  const container = document.getElementById("eventsList");
  container.innerHTML = filtered.length
    ? filtered.map(renderEventCard).join("")
    : emptyState("No events found", "🔍");
}

function renderEventCard(event) {
  const dateObj = new Date(`${event.date}T${event.time}`);
  const dateStr = dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = dateObj.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const colorClass = catColors[event.category] || "cat-worship";
  const conflicts = detectConflicts(events, event);
  const conflictBadge = conflicts.length ? `<span style="color:#e65100;font-size:0.78rem;">⚠️ Conflict</span>` : "";

  return `
    <div class="event-card" data-id="${event.id}">
      <div class="event-color-bar ${colorClass}"></div>
      <div class="event-info">
        <div class="event-badge">${event.category}</div>
        <div class="event-title">${event.title} ${conflictBadge}</div>
        <div class="event-meta">
          <span>📅 ${dateStr}</span>
          <span>⏰ ${timeStr}</span>
          <span>📍 ${event.venue}</span>
          <span>⏱ ${event.duration} min</span>
          ${event.recurring !== "none" ? `<span>🔁 ${event.recurring}</span>` : ""}
        </div>
      </div>
      <div class="event-actions">
        ${currentAdmin ? `
          <button class="btn-icon" title="Edit" onclick="window.editEvent('${event.id}')">✏️</button>
          <button class="btn-icon" title="Delete" onclick="window.deleteEvent('${event.id}')">🗑️</button>
        ` : ""}
      </div>
    </div>`;
}

function emptyState(msg, icon) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
}

// --- Reminders ---
function populateReminderSelect() {
  const sel = document.getElementById("reminderEventSelect");
  sel.innerHTML = `<option value="">-- Select an event --</option>` +
    events.map((e) => `<option value="${e.id}">${e.title} (${e.date})</option>`).join("");
}

function renderReminderSchedule(eventId) {
  const event = events.find((e) => e.id === eventId);
  const container = document.getElementById("reminderSchedule");
  if (!event) { container.innerHTML = ""; return; }
  const schedule = generateReminderSchedule(event);
  container.innerHTML = schedule.map((r, i) => `
    <div class="reminder-item">
      <div class="reminder-dot" style="background:${i === schedule.length - 1 ? "#e65100" : "#6b3fa0"}"></div>
      <div>
        <div class="reminder-label">${r.label}</div>
        <div class="reminder-date">${r.dateStr} at ${r.timeStr}</div>
      </div>
    </div>`).join("");
}

// --- Invitations ---
function populateInviteSelect() {
  const sel = document.getElementById("inviteEventSelect");
  sel.innerHTML = `<option value="">-- Select an event --</option>` +
    events.map((e) => `<option value="${e.id}">${e.title}</option>`).join("");
}

function renderInvitation() {
  const eventId = document.getElementById("inviteEventSelect").value;
  const style = document.getElementById("inviteStyle").value;
  const event = events.find((e) => e.id === eventId);
  if (!event) return;
  const text = generateInvitation(event, style);
  document.getElementById("invitationText").textContent = text;
  document.getElementById("invitationOutput").classList.remove("hidden");
  invitesSent++;
  renderDashboard();
}

// --- Modal ---
function openModal(eventId = null) {
  if (!currentAdmin) return;
  editingId = eventId;
  const form = document.getElementById("eventForm");
  form.reset();
  document.getElementById("aiSuggestions").classList.add("hidden");
  document.getElementById("conflictWarning").classList.add("hidden");
  document.getElementById("timeSuggestions").classList.add("hidden");

  if (eventId) {
    const event = events.find((e) => e.id === eventId);
    document.getElementById("modalTitle").textContent = "Edit Event";
    document.getElementById("eventTitle").value = event.title;
    document.getElementById("eventCategory").value = event.category;
    document.getElementById("eventVenue").value = event.venue;
    document.getElementById("eventDate").value = event.date;
    document.getElementById("eventTime").value = event.time;
    document.getElementById("eventDuration").value = event.duration;
    document.getElementById("eventRecurring").value = event.recurring;
    document.getElementById("eventDescription").value = event.description;
  } else {
    document.getElementById("modalTitle").textContent = "New Event";
    document.getElementById("eventDate").value = new Date().toISOString().split("T")[0];
  }
  document.getElementById("eventModal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("eventModal").classList.add("hidden");
  editingId = null;
}

function checkConflicts() {
  const newEvent = getFormEvent();
  if (!newEvent.date || !newEvent.time || !newEvent.venue) return;
  const conflicts = detectConflicts(events, newEvent);
  const slots = suggestTimeSlots(events, newEvent.date, newEvent.venue, newEvent.duration);
  const aiBox = document.getElementById("aiSuggestions");
  const conflictWarn = document.getElementById("conflictWarning");
  const timeSug = document.getElementById("timeSuggestions");
  aiBox.classList.remove("hidden");
  conflictWarn.classList.remove("hidden");
  if (conflicts.length) {
    conflictWarn.style.cssText = "";
    conflictWarn.innerHTML = `⚠️ Conflict with: <strong>${conflicts.map((c) => c.title).join(", ")}</strong> at ${newEvent.venue}`;
  } else {
    conflictWarn.style.background = "#e8f5e9";
    conflictWarn.style.borderColor = "#81c784";
    conflictWarn.style.color = "#2e7d32";
    conflictWarn.innerHTML = `✅ No conflicts detected.`;
  }
  if (slots.length) {
    timeSug.classList.remove("hidden");
    document.getElementById("slotButtons").innerHTML = slots.map((s) =>
      `<button class="slot-btn" onclick="window.applySlot('${s}')">${s}</button>`
    ).join("");
  }
}

function getFormEvent() {
  return {
    id: editingId || null,
    title: document.getElementById("eventTitle").value,
    category: document.getElementById("eventCategory").value,
    venue: document.getElementById("eventVenue").value,
    date: document.getElementById("eventDate").value,
    time: document.getElementById("eventTime").value,
    duration: parseInt(document.getElementById("eventDuration").value) || 60,
    recurring: document.getElementById("eventRecurring").value,
    description: document.getElementById("eventDescription").value,
  };
}

// --- Auth UI ---
function updateAuthUI() {
  const userInfo = document.getElementById("userInfo");
  const signInBtn = document.getElementById("signInHeaderBtn");
  const adminEls = document.querySelectorAll(".admin-only");

  if (currentAdmin) {
    userInfo.classList.remove("hidden");
    const name = currentAdmin.user_metadata?.full_name || currentAdmin.email;
    document.getElementById("userName").textContent = name;
    signInBtn.classList.add("hidden");
    adminEls.forEach((el) => el.classList.remove("hidden"));
  } else {
    userInfo.classList.add("hidden");
    signInBtn.classList.remove("hidden");
    adminEls.forEach((el) => el.classList.add("hidden"));
  }
  renderDashboard();
  renderEventsList();
}

function openAuthModal(tab = "signin") {
  document.getElementById("authModal").classList.remove("hidden");
  switchAuthTab(tab);
}

function closeAuthModal() {
  document.getElementById("authModal").classList.add("hidden");
  document.getElementById("signInForm").reset();
  document.getElementById("signUpForm").reset();
  document.getElementById("siError").classList.add("hidden");
  document.getElementById("suError").classList.add("hidden");
}

function switchAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
  document.querySelector(`.auth-tab[data-auth="${tab}"]`).classList.add("active");
  document.getElementById("signInForm").classList.toggle("hidden", tab !== "signin");
  document.getElementById("signUpForm").classList.toggle("hidden", tab !== "signup");
}

// --- Global handlers ---
window.editEvent = (id) => openModal(id);
window.deleteEvent = (id) => deleteEventById(id);
window.applySlot = (time) => { document.getElementById("eventTime").value = time; };

// --- Bind events ---
function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
    });
  });

  document.getElementById("newEventBtn").addEventListener("click", () => openModal());
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("cancelModal").addEventListener("click", closeModal);
  document.getElementById("eventModal").querySelector(".modal-overlay").addEventListener("click", closeModal);
  document.getElementById("eventForm").addEventListener("submit", saveEvent);
  document.getElementById("checkConflictsBtn").addEventListener("click", checkConflicts);
  document.getElementById("searchEvents").addEventListener("input", renderEventsList);
  document.getElementById("filterCategory").addEventListener("change", renderEventsList);
  document.getElementById("reminderEventSelect").addEventListener("change", (e) => renderReminderSchedule(e.target.value));
  document.getElementById("generateInviteBtn").addEventListener("click", renderInvitation);
  document.getElementById("copyInviteBtn").addEventListener("click", () => {
    const text = document.getElementById("invitationText").textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("copyInviteBtn");
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 2000);
    });
  });

  // Auth
  document.getElementById("signInHeaderBtn").addEventListener("click", () => openAuthModal("signin"));
  document.getElementById("closeAuthModal").addEventListener("click", closeAuthModal);
  document.getElementById("authOverlay").addEventListener("click", closeAuthModal);
  document.getElementById("signOutBtn").addEventListener("click", async () => { await signOut(); });
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchAuthTab(tab.dataset.auth));
  });

  document.getElementById("signInForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.textContent = "Signing in..."; btn.disabled = true;
    const result = await signIn(
      document.getElementById("siEmail").value,
      document.getElementById("siPassword").value
    );
    btn.textContent = "Sign In"; btn.disabled = false;
    if (result.ok) {
      closeAuthModal();
    } else {
      const err = document.getElementById("siError");
      err.textContent = result.error;
      err.classList.remove("hidden");
    }
  });

  document.getElementById("signUpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.textContent = "Creating account..."; btn.disabled = true;
    const result = await signUp(
      document.getElementById("suName").value.trim(),
      document.getElementById("suEmail").value,
      document.getElementById("suPassword").value
    );
    btn.textContent = "Create Account"; btn.disabled = false;
    if (result.ok) {
      closeAuthModal();
      if (result.confirmEmail) {
        alert("Account created! Check your email to confirm before signing in.");
      }
    } else {
      const err = document.getElementById("suError");
      err.textContent = result.error;
      err.classList.remove("hidden");
    }
  });
}

init();
