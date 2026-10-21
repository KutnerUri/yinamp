export const UPDATE_DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_UPDATE_DELAY_MS = 30 * 1000;
export const MAX_UPDATE_DELAY_MS = 5 * 60 * 1000;

export function updateJitter(random = Math.random) {
  return MIN_UPDATE_DELAY_MS + Math.floor(random() * (MAX_UPDATE_DELAY_MS - MIN_UPDATE_DELAY_MS));
}

export function automaticCheckDue(lastCheckAt, now) {
  return !Number.isFinite(lastCheckAt) || lastCheckAt <= 0 || now - lastCheckAt >= UPDATE_DAY_MS;
}

export function nextUpdateCheck(lastCheckAt, scheduledAt, now, random = Math.random) {
  const earliest = Number.isFinite(lastCheckAt) && lastCheckAt > 0 ? lastCheckAt + UPDATE_DAY_MS : now;
  // Reuse a persisted appointment so restarting the app does not reset its random delay.
  if (Number.isFinite(scheduledAt) && scheduledAt > now && scheduledAt >= earliest) return scheduledAt;
  return Math.max(now, earliest) + updateJitter(random);
}
