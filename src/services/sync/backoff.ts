const STEPS_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

/** Espera progresiva con tope de 5 min y variación aleatoria de ±20 %. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = STEPS_MS[Math.min(Math.max(attempt, 1), STEPS_MS.length) - 1];
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(base * jitter);
}
