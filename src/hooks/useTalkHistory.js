import { useEffect, useState } from 'react';
import { storage } from '../storage/mmkv';

// Ported from web src/hooks/useTalkHistory.js. Singleton talk history in
// module scope so any consumer sees the same conversation across mounts,
// mirrored to storage so it survives restarts (cleared on sign-out by
// lib/auth clearSession). One adaptation: the web hook takes a seed argument
// because its greeting is synchronous; the native greeting waits on a mood
// fetch, so seeding is the explicit seedTalkHistory() call instead.
const STORAGE_KEY = 'aura.talkHistory';
const MAX_MESSAGES = 50;

function readStored() {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function writeStored(arr) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-MAX_MESSAGES)));
  } catch {
    // ignore
  }
}

let messages = readStored() ?? [];
const subscribers = new Set();
function notify() {
  subscribers.forEach(fn => fn(messages));
}

function setMessages(next) {
  messages = next.slice(-MAX_MESSAGES);
  writeStored(messages);
  notify();
}

export function addTalkMessage(msg) {
  setMessages([...messages, msg]);
}

export function resetTalkHistory() {
  setMessages([]);
}

// First-ever load (or right after a reset): drop the greeting in — but only
// while the history is still empty, so a race with a user send can't clobber.
export function seedTalkHistory(seed) {
  if (messages.length === 0 && seed) {
    setMessages([seed]);
  }
}

export function useTalkHistory() {
  const [snap, setSnap] = useState(messages);
  useEffect(() => {
    subscribers.add(setSnap);
    // The store can have moved between render and subscribe (another
    // consumer seeded/added) — resync once on mount.
    setSnap(messages);
    return () => {
      subscribers.delete(setSnap);
    };
  }, []);
  return { messages: snap };
}

// Test-only: drop module state between cases.
export function _resetTalkStore() {
  messages = [];
  storage.removeItem(STORAGE_KEY);
  notify();
}
