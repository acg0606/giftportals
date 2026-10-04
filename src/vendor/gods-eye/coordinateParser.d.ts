export function formatCoordinateLabel(lat: number, lon: number): string;
export function parseCoordinateQuery(query: string): { lat: number; lon: number; label: string } | null;
