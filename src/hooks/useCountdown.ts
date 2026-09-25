"use client";
import { useMemo, useSyncExternalStore } from "react";

export interface CountdownResult {
  days: number;       // whole days remaining (0 if < 1 day)
  hours: number;      // hours within current day (0-23)
  minutes: number;    // minutes within current hour (0-59)
  seconds: number;    // seconds within current minute (0-59)
  isExpired: boolean; // true when countdown has ended
  formatted: string;  // "Xd Xh Xm remaining" or "Xh Xm Xs remaining" or "Xm Xs remaining"
}

// What the server and the hydration pass render, so their markup never depends on when they run.
// React swaps in the real time right after hydration.
const PLACEHOLDER: CountdownResult = {
  days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: false, formatted: "",
};

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}

// Whole seconds, so repeated reads within one second return the same snapshot; the floor means the
// displayed time and the expiry flip can lag real time by up to about a second.
const getNow = () => Math.floor(Date.now() / 1000) * 1000;
const getServerNow = () => null;

function calcTime(expiresAt: string | Date, now: number): CountdownResult {
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, formatted: "Expired" };
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  let formatted: string;
  if (days > 0) formatted = `${days}d ${hours}h ${minutes}m remaining`;
  else if (hours > 0) formatted = `${hours}h ${minutes}m ${seconds}s remaining`;
  else formatted = `${minutes}m ${seconds}s remaining`;
  return { days, hours, minutes, seconds, isExpired: false, formatted };
}

export function useCountdown(expiresAt: string | Date): CountdownResult {
  const now = useSyncExternalStore<number | null>(subscribe, getNow, getServerNow);
  return useMemo(() => (now === null ? PLACEHOLDER : calcTime(expiresAt, now)), [expiresAt, now]);
}
