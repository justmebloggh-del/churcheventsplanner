// Mock data and AI logic for Church Event Planner

export const categories = ["Worship", "Youth", "Community", "Bible Study", "Fundraiser", "Special Service"];

export const venues = ["Main Sanctuary", "Fellowship Hall", "Youth Room", "Chapel", "Outdoor Grounds"];

export const sampleEvents = [
  {
    id: 1,
    title: "Sunday Morning Worship",
    category: "Worship",
    date: "2026-03-29",
    time: "10:00",
    duration: 90,
    venue: "Main Sanctuary",
    description: "Weekly Sunday worship service",
    recurring: "weekly",
    attendees: [],
    reminders: ["1 day before", "1 hour before"],
  },
  {
    id: 2,
    title: "Youth Bible Study",
    category: "Youth",
    date: "2026-04-02",
    time: "18:00",
    duration: 60,
    venue: "Youth Room",
    description: "Weekly youth group Bible study session",
    recurring: "weekly",
    attendees: [],
    reminders: ["1 day before"],
  },
  {
    id: 3,
    title: "Easter Sunday Service",
    category: "Special Service",
    date: "2026-04-05",
    time: "09:00",
    duration: 120,
    venue: "Main Sanctuary",
    description: "Special Easter celebration service",
    recurring: "none",
    attendees: [],
    reminders: ["1 week before", "1 day before", "2 hours before"],
  },
  {
    id: 4,
    title: "Community Food Drive",
    category: "Community",
    date: "2026-04-10",
    time: "09:00",
    duration: 240,
    venue: "Fellowship Hall",
    description: "Monthly community food drive and distribution",
    recurring: "monthly",
    attendees: [],
    reminders: ["1 week before", "1 day before"],
  },
];

// AI: Detect scheduling conflicts
export function detectConflicts(events, newEvent) {
  const conflicts = [];
  const newStart = new Date(`${newEvent.date}T${newEvent.time}`);
  const newEnd = new Date(newStart.getTime() + newEvent.duration * 60000);

  for (const event of events) {
    if (event.id === newEvent.id) continue;
    if (event.venue !== newEvent.venue) continue;
    if (event.date !== newEvent.date) continue;

    const existStart = new Date(`${event.date}T${event.time}`);
    const existEnd = new Date(existStart.getTime() + event.duration * 60000);

    if (newStart < existEnd && newEnd > existStart) {
      conflicts.push(event);
    }
  }
  return conflicts;
}

// AI: Suggest optimal time slots based on venue usage
export function suggestTimeSlots(events, date, venue, duration) {
  const dayEvents = events
    .filter((e) => e.date === date && e.venue === venue)
    .sort((a, b) => a.time.localeCompare(b.time));

  const slots = [];
  const churchHours = [
    { start: "08:00", end: "21:00" },
  ];

  const busySlots = dayEvents.map((e) => {
    const start = new Date(`${date}T${e.time}`);
    const end = new Date(start.getTime() + e.duration * 60000);
    return { start, end };
  });

  // Generate candidate slots every 30 min
  const baseDate = new Date(`${date}T08:00`);
  const endDate = new Date(`${date}T21:00`);

  for (let t = new Date(baseDate); t < endDate; t = new Date(t.getTime() + 30 * 60000)) {
    const slotEnd = new Date(t.getTime() + duration * 60000);
    if (slotEnd > endDate) break;

    const hasConflict = busySlots.some(
      (b) => t < b.end && slotEnd > b.start
    );

    if (!hasConflict) {
      slots.push(t.toTimeString().slice(0, 5));
    }
    if (slots.length >= 4) break;
  }

  return slots;
}

// AI: Generate invitation message
export function generateInvitation(event, style = "formal") {
  const dateObj = new Date(`${event.date}T${event.time}`);
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const formattedTime = dateObj.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
  });

  const templates = {
    formal: `Dear Brothers and Sisters in Christ,

We warmly invite you to join us for "${event.title}", a ${event.category.toLowerCase()} gathering at ${event.venue}.

Date: ${formattedDate}
Time: ${formattedTime}
Location: ${event.venue}

${event.description}

We look forward to your presence and fellowship. Please share this invitation with family and friends.

In His Service,
Church Administration`,

    casual: `Hey Church Family! 🙏

You're invited to "${event.title}"!

📅 ${formattedDate}
⏰ ${formattedTime}
📍 ${event.venue}

${event.description}

Come as you are — bring a friend! See you there! ✨`,

    sms: `Reminder: "${event.title}" on ${formattedDate} at ${formattedTime}, ${event.venue}. ${event.description} — Your Church Family`,
  };

  return templates[style] || templates.formal;
}

// AI: Generate smart reminder schedule
export function generateReminderSchedule(event) {
  const eventDate = new Date(`${event.date}T${event.time}`);
  const now = new Date();
  const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));

  const reminders = [];

  if (daysUntil >= 14) reminders.push({ label: "2 weeks before", date: new Date(eventDate.getTime() - 14 * 86400000) });
  if (daysUntil >= 7) reminders.push({ label: "1 week before", date: new Date(eventDate.getTime() - 7 * 86400000) });
  if (daysUntil >= 3) reminders.push({ label: "3 days before", date: new Date(eventDate.getTime() - 3 * 86400000) });
  if (daysUntil >= 1) reminders.push({ label: "1 day before", date: new Date(eventDate.getTime() - 86400000) });
  reminders.push({ label: "2 hours before", date: new Date(eventDate.getTime() - 2 * 3600000) });

  return reminders.map((r) => ({
    ...r,
    dateStr: r.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    timeStr: r.date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  }));
}
