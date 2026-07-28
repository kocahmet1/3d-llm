/**
 * A portal landing is one comfortable step inside the chamber's navigable
 * boundary. Keeping this shared prevents timeline jumps, guided travel,
 * machine-room dives, director shots, and physical tunnel arrivals from
 * disagreeing about where a chamber begins.
 */
export const CHAMBER_ENTRY_CLEARANCE = 1.4;

export function chamberEntranceZ(maxZ: number): number {
  return maxZ - CHAMBER_ENTRY_CLEARANCE;
}

export function chamberExitZ(minZ: number): number {
  return minZ + CHAMBER_ENTRY_CLEARANCE;
}
