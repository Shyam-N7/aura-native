import { fetchAuthed } from '../lib/auth';
// Quiet-panel feed wrappers. Best-effort like the presence API: the panel
// shows what it can get; a server without the routes yet (pre-deploy) just
// reads as an empty feed.

// Recent recorded notifications, newest first: [{id, type, payload, createdAt, seenAt}].
export async function getNotifications() {
  try {
    const res = await fetchAuthed('/api/notifications');
    if (!res.ok) {
      return [];
    }
    const { notifications } = await res.json();
    return notifications ?? [];
  } catch {
    return [];
  }
}

export async function markNotificationsSeen() {
  try {
    await fetchAuthed('/api/notifications/seen', { method: 'POST' });
  } catch {
    /* best-effort */
  }
}
