import {
  categories, venues,
  detectConflicts, suggestTimeSlots,
  generateInvitation, generateReminderSchedule,
} from "./data.js";
import { signIn, signUp, signOut, onAuthChange } from "./auth.js";
import { supabase } from "./supabase.js";
import { calendar2026, sermonShotsIntro } from "./calendar2026.js";

// --- State ---
let events = [];
let currentAdmin = null;
let editingId = null;
let invitesSent = 0;

const catColors = {
  "Worship": "cat-worship", "Youth": "cat-youth", "Community": "cat-community",
  "Bible Study": "cat-bible", "Fundraiser": "cat-fundraiser", "Special Service": "cat-special",
};

// Church address used for map fallback
const CHURCH_ADDRESS = "123 Church Street, Your City, State 00000";

// --- Init ---
async function init() {
  populateSelects();
  bindEvents();
  initCalendar();
  initAdminVideo();
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
  events = (data || []).map(dbToEvent);
  injectJsonLd(events);
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
    time: row.time.slice(0, 5),
    duration: row.duration,
    recurring: row.recurring,
    description: row.description || "",
    address: row.address || "",
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
    address: event.address || "",
  };
}

// --- SEO: inject JSON-LD Event structured data ---
function injectJsonLd(evts) {
  const structured = evts.map((e) => {
    const startDate = `${e.date}T${e.time}:00`;
    const endMs = new Date(startDate).getTime() + e.duration * 60000;
    const endDate = new Date(endMs).toISOString();
    return {
      "@context": "https://schema.org",
      "@type": "Event",
      "name": e.title,
      "description": e.description,
      "startDate": startDate,
      "endDate": endDate,
      "eventStatus": "https://schema.org/EventScheduled",
      "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
      "location": {
        "@type": "Place",
        "name": e.venue,
        "address": e.address || CHURCH_ADDRESS,
      },
      "organizer": {
        "@type": "Organization",
        "name": "Your Church Name",
        "url": "https://your-church-domain.com",
      },
    };
  });
  const el = document.getElementById("jsonld-events");
  if (el) el.textContent = JSON.stringify(structured);
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
    const matchSearch = e.title.toLowerCase().includes(search) ||
      e.description.toLowerCase().includes(search) ||
      e.venue.toLowerCase().includes(search) ||
      e.category.toLowerCase().includes(search);
    const matchCat = !category || e.category === category;
    return matchSearch && matchCat;
  });
  const container = document.getElementById("eventsList");
  container.innerHTML = filtered.length
    ? filtered.map(renderEventCard).join("")
    : emptyState("No events found", "🔍");
}

// --- Event card with map + social share ---
function renderEventCard(event) {
  const dateObj = new Date(`${event.date}T${event.time}`);
  const dateStr = dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = dateObj.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const colorClass = catColors[event.category] || "cat-worship";
  const conflicts = detectConflicts(events, event);
  const conflictBadge = conflicts.length ? `<span style="color:#e65100;font-size:0.78rem;">⚠️ Conflict</span>` : "";

  const shareText = encodeURIComponent(`${event.title} — ${dateStr} at ${timeStr}, ${event.venue}`);
  const shareUrl = encodeURIComponent(window.location.href);
  const fbShare = `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}&quote=${shareText}`;
  const twShare = `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`;
  const waShare = `https://wa.me/?text=${shareText}%20${shareUrl}`;

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
        <div class="event-footer">
          <button class="btn-map" onclick="window.openMap('${event.id}')" title="View on map">🗺 Map</button>
          <div class="share-buttons">
            <span class="share-label">Share:</span>
            <a href="${fbShare}" target="_blank" rel="noopener" class="share-btn fb" title="Share on Facebook">f</a>
            <a href="${twShare}" target="_blank" rel="noopener" class="share-btn tw" title="Share on X / Twitter">𝕏</a>
            <a href="${waShare}" target="_blank" rel="noopener" class="share-btn wa" title="Share on WhatsApp">💬</a>
          </div>
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

// --- Map modal ---
function openMap(eventId) {
  const event = events.find((e) => e.id === eventId);
  if (!event) return;
  const address = encodeURIComponent(event.address || `${event.venue}, ${CHURCH_ADDRESS}`);
  const label = encodeURIComponent(event.venue);

  document.getElementById("mapModalTitle").textContent = event.venue;
  document.getElementById("directionsLink").href =
    `https://www.google.com/maps/dir/?api=1&destination=${address}`;
  document.getElementById("mapsSearchLink").href =
    `https://www.google.com/maps/search/?api=1&query=${address}`;

  // Embed map via iframe (no API key needed for basic embed)
  document.getElementById("mapContainer").innerHTML = `
    <iframe
      title="Event location map"
      width="100%" height="320"
      style="border:0;border-radius:8px;"
      loading="lazy"
      allowfullscreen
      src="https://maps.google.com/maps?q=${address}&output=embed">
    </iframe>`;

  document.getElementById("mapModal").classList.remove("hidden");
}

function closeMapModal() {
  document.getElementById("mapModal").classList.add("hidden");
  document.getElementById("mapContainer").innerHTML = "";
}

// --- Voice search ---
function initVoiceSearch() {
  const btn = document.getElementById("voiceSearchBtn");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    btn.title = "Voice search not supported in this browser";
    btn.style.opacity = "0.4";
    btn.style.cursor = "not-allowed";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  btn.addEventListener("click", () => {
    recognition.start();
    btn.classList.add("listening");
    showVoiceStatus("🎤 Listening...");
  });

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    document.getElementById("searchEvents").value = transcript;
    renderEventsList();
    showVoiceStatus(`✅ Heard: "${transcript}"`);
    btn.classList.remove("listening");
    // Switch to events tab
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    document.querySelector('[data-tab="events"]').classList.add("active");
    document.getElementById("events").classList.add("active");
  };

  recognition.onerror = (e) => {
    showVoiceStatus(`❌ Error: ${e.error}`);
    btn.classList.remove("listening");
  };

  recognition.onend = () => btn.classList.remove("listening");
}

function showVoiceStatus(msg) {
  const el = document.getElementById("voiceStatus");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
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

// --- Event modal ---
function openModal(eventId = null) {
  if (!currentAdmin) return;
  editingId = eventId;
  document.getElementById("eventForm").reset();
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
    document.getElementById("eventAddress").value = event.address || "";
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
    address: document.getElementById("eventAddress").value,
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
window.openMap = (id) => openMap(id);

// --- 2026 Calendar ---
function initCalendar() {
  const months = [...new Set(calendar2026.map((w) => w.month))];
  const sel = document.getElementById("calMonthFilter");
  months.forEach((m) => { sel.innerHTML += `<option value="${m}">${m}</option>`; });

  renderCalendar();
  renderSermonShotsTips();

  document.getElementById("calMonthFilter").addEventListener("change", renderCalendar);
  document.getElementById("calSearch").addEventListener("input", renderCalendar);
  document.getElementById("downloadCalBtn").addEventListener("click", downloadCalendarCSV);
}

// --- Admin: Sermon Shots video ---
function initAdminVideo() {
  loadSavedVideo();

  document.getElementById("saveVideoBtn").addEventListener("click", () => {
    const url = document.getElementById("videoUrlInput").value.trim();
    if (!url) return;
    localStorage.setItem("ss_video_url", url);
    loadSavedVideo();
  });

  document.getElementById("removeVideoBtn").addEventListener("click", () => {
    localStorage.removeItem("ss_video_url");
    document.getElementById("videoUrlInput").value = "";
    document.getElementById("videoPreview").classList.add("hidden");
    document.getElementById("sermonShotsVideoSection").classList.add("hidden");
  });
}

function loadSavedVideo() {
  const url = localStorage.getItem("ss_video_url");
  const homeSec = document.getElementById("sermonShotsVideoSection");
  const homePlayer = document.getElementById("sermonShotsVideoPlayer");
  const previewSec = document.getElementById("videoPreview");
  const previewPlayer = document.getElementById("videoPreviewPlayer");

  if (!url) {
    homeSec.classList.add("hidden");
    previewSec.classList.add("hidden");
    return;
  }

  const embedHtml = buildVideoEmbed(url);
  homePlayer.innerHTML = embedHtml;
  previewPlayer.innerHTML = embedHtml;
  homeSec.classList.remove("hidden");
  previewSec.classList.remove("hidden");

  // Pre-fill input if on admin tab
  const input = document.getElementById("videoUrlInput");
  if (input && !input.value) input.value = url;
}

function buildVideoEmbed(url) {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="border-radius:10px;"></iframe>`;
  }
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return `<iframe width="100%" height="400" src="https://player.vimeo.com/video/${vimeoMatch[1]}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen style="border-radius:10px;"></iframe>`;
  }
  // Direct video file
  return `<video controls width="100%" style="border-radius:10px;max-height:400px;"><source src="${url}"><p>Your browser doesn't support this video format.</p></video>`;
}

function renderCalendar() {
  const month = document.getElementById("calMonthFilter").value;
  const search = document.getElementById("calSearch").value.toLowerCase();

  const filtered = calendar2026.filter((w) => {
    const matchMonth = !month || w.month === month;
    const matchSearch = !search ||
      w.theme.toLowerCase().includes(search) ||
      w.scripture.toLowerCase().includes(search) ||
      w.keyDate.toLowerCase().includes(search) ||
      w.postIdeas.some((p) => p.toLowerCase().includes(search)) ||
      w.sermonShot.toLowerCase().includes(search);
    return matchMonth && matchSearch;
  });

  const grid = document.getElementById("calendarGrid");
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No results found.</p></div>`;
    return;
  }

  // Group by month
  const byMonth = {};
  filtered.forEach((w) => {
    if (!byMonth[w.month]) byMonth[w.month] = [];
    byMonth[w.month].push(w);
  });

  grid.innerHTML = Object.entries(byMonth).map(([month, weeks]) => `
    <div class="cal-month-group">
      <div class="cal-month-label">${month}</div>
      ${weeks.map((w) => `
        <div class="cal-week-card">
          <div class="cal-week-header">
            <span class="cal-week-num">Week ${w.week}</span>
            <span class="cal-dates">${w.dates}</span>
            <span class="cal-key-date">🗓 ${w.keyDate}</span>
          </div>
          <div class="cal-theme">
            <span class="cal-theme-label">Theme</span>
            <span class="cal-theme-value">${w.theme}</span>
          </div>
          <div class="cal-scripture">
            <span class="cal-scripture-icon">📖</span>
            <strong>${w.scripture}</strong>
          </div>
          <div class="cal-post-ideas">
            <div class="cal-section-label">Post Ideas</div>
            <ul>${w.postIdeas.map((p) => `<li>${p}</li>`).join("")}</ul>
          </div>
          <div class="cal-sermon-shot">
            <span class="ss-badge">🎬 Sermon Shots Tip</span>
            <p>${w.sermonShot}</p>
          </div>
        </div>
      `).join("")}
    </div>
  `).join("");
}

function renderSermonShotsTips() {
  const container = document.getElementById("sermonShotsTips");
  container.innerHTML = sermonShotsIntro.tips.map((t) => `
    <div class="ss-tip-card">
      <div class="ss-tip-icon">${t.icon}</div>
      <div class="ss-tip-title">${t.title}</div>
      <div class="ss-tip-text">${t.tip}</div>
    </div>
  `).join("");
}

function downloadCalendarCSV() {
  const headers = ["Week", "Month", "Dates", "Key Date", "Scripture", "Theme", "Post Idea 1", "Post Idea 2", "Post Idea 3", "Sermon Shots Tip"];
  const rows = calendar2026.map((w) => [
    w.week, w.month, w.dates, w.keyDate, w.scripture, w.theme,
    w.postIdeas[0] || "", w.postIdeas[1] || "", w.postIdeas[2] || "",
    w.sermonShot,
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Church_2026_Content_Calendar.csv";
  a.click();
  URL.revokeObjectURL(url);
}

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

  // Map modal
  document.getElementById("closeMapModal").addEventListener("click", closeMapModal);
  document.getElementById("mapOverlay").addEventListener("click", closeMapModal);

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
    if (result.ok) { closeAuthModal(); }
    else {
      const err = document.getElementById("siError");
      err.textContent = result.error; err.classList.remove("hidden");
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
      if (result.confirmEmail) alert("Account created! Check your email to confirm before signing in.");
    } else {
      const err = document.getElementById("suError");
      err.textContent = result.error; err.classList.remove("hidden");
    }
  });

  // Voice search init
  initVoiceSearch();
}

init();
