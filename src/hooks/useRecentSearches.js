import { useEffect, useState } from 'react';
import { storage } from '../storage/mmkv';

// Ported from web src/hooks/useRecentSearches.js (localStorage → MMKV).
// Singleton recent-searches store: state lives in module scope so every
// consumer sees the same array, mirrored to storage capped at 10 entries.
const STORAGE_KEY = 'aura.recentSearches';
const MAX = 10;

function read() {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(s => typeof s === 'string' && s.trim())
      : [];
  } catch {
    return [];
  }
}
function write(arr) {
  storage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, MAX)));
}

let items = read();
const subs = new Set();
function notify() {
  subs.forEach(fn => fn(items));
}

export function pushRecentSearch(q) {
  const trimmed = (q ?? '').trim();
  if (!trimmed) {
    return;
  }
  const lower = trimmed.toLowerCase();
  // Newest-first; drop case-insensitive duplicate.
  items = [trimmed, ...items.filter(x => x.toLowerCase() !== lower)].slice(
    0,
    MAX,
  );
  write(items);
  notify();
}
export function clearRecentSearches() {
  items = [];
  write(items);
  notify();
}

export function useRecentSearches() {
  const [snap, setSnap] = useState(items);
  useEffect(() => {
    subs.add(setSnap);
    return () => {
      subs.delete(setSnap);
    };
  }, []);
  return { items: snap, push: pushRecentSearch, clear: clearRecentSearches };
}
