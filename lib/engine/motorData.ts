// Motor box size and weight, looked up by material + size + HP from the motor
// item code (see parseMotorCode). Box sizes are kept in inches, as supplied,
// and converted to mm when looked up.
interface MotorBox {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  netKg: number;  // motor weight per box
}

export type MotorMaterial = 'C' | 'S'; // C = CI (cast iron), S = SI (stainless)
export type MotorSize = 'V4' | 'V6' | 'V8'; // 4", 6", 8"

const MM_PER_INCH = 25.4;

// Foam/packing is neglected for motors (boss's call), so gross = net
export const MOTOR_PACKING_KG = 0;

// Key: `${material}-${size}-${hp}`, HP as written in the item code (e.g. C-V4-7.5)
const MOTOR_DATA: Record<string, MotorBox> = {
  // ── 4" CI ──
  'C-V4-0.5':  { lengthIn: 24, widthIn: 4.5, heightIn: 4.5, netKg: 12 },
  'C-V4-0.75': { lengthIn: 25, widthIn: 4.5, heightIn: 4.5, netKg: 14 },
  'C-V4-1':    { lengthIn: 27, widthIn: 4.5, heightIn: 4.5, netKg: 18 },
  'C-V4-1.5':  { lengthIn: 29, widthIn: 4.5, heightIn: 4.5, netKg: 21 },
  'C-V4-2':    { lengthIn: 30, widthIn: 4.5, heightIn: 4.5, netKg: 23 },
  'C-V4-3':    { lengthIn: 33, widthIn: 4.5, heightIn: 4.5, netKg: 28 },
  'C-V4-4':    { lengthIn: 35, widthIn: 4.5, heightIn: 4.5, netKg: 31 },
  'C-V4-5.5':  { lengthIn: 36, widthIn: 4.5, heightIn: 4.5, netKg: 34 },
  'C-V4-7.5':  { lengthIn: 43, widthIn: 4.5, heightIn: 4.5, netKg: 40 },
  'C-V4-10':   { lengthIn: 48, widthIn: 4.5, heightIn: 4.5, netKg: 46 },

  // ── 6" CI ──
  'C-V6-5.5':  { lengthIn: 30, widthIn: 7, heightIn: 9, netKg: 50 },
  'C-V6-7.5':  { lengthIn: 33, widthIn: 7, heightIn: 9, netKg: 52 },
  'C-V6-10':   { lengthIn: 35, widthIn: 7, heightIn: 9, netKg: 55 },
  'C-V6-12.5': { lengthIn: 36, widthIn: 7, heightIn: 9, netKg: 61 },
  'C-V6-15':   { lengthIn: 38, widthIn: 7, heightIn: 9, netKg: 65 },
  'C-V6-17.5': { lengthIn: 41, widthIn: 7, heightIn: 9, netKg: 72 },
  'C-V6-20':   { lengthIn: 42, widthIn: 7, heightIn: 9, netKg: 77 },
  'C-V6-25':   { lengthIn: 45, widthIn: 7, heightIn: 9, netKg: 83 },
  'C-V6-30':   { lengthIn: 46, widthIn: 7, heightIn: 9, netKg: 88 },
  'C-V6-35':   { lengthIn: 48, widthIn: 7, heightIn: 9, netKg: 94 },
  'C-V6-40':   { lengthIn: 50, widthIn: 7, heightIn: 9, netKg: 100 },
  'C-V6-50':   { lengthIn: 58, widthIn: 7, heightIn: 9, netKg: 120 },
  'C-V6-60':   { lengthIn: 60, widthIn: 7, heightIn: 9, netKg: 130 },

  // ── 8" CI ── stub, data not yet available

  // ── 4" / 6" / 8" SI ── stub, data not yet available
};

export function motorKey(material: MotorMaterial, size: MotorSize, hp: number): string {
  return `${material}-${size}-${hp}`;
}

export function calcMotorBox(material: MotorMaterial, size: MotorSize, hp: number) {
  const m = MOTOR_DATA[motorKey(material, size, hp)];
  if (!m) return null;
  const mm = (inches: number) => Math.round(inches * MM_PER_INCH);
  return {
    L: mm(m.lengthIn),
    W: mm(m.widthIn),
    H: mm(m.heightIn),
    netKg: m.netKg,
    grossKg: Math.round((m.netKg + MOTOR_PACKING_KG) * 1000) / 1000,
  };
}

// Motor item codes: SM-<material>-<x>-<HP>-<size>-..., e.g. SM-C-I-10-V4-50.
// Returns null unless material, HP and size are all recognised.
export function parseMotorCode(code: string): { material: MotorMaterial; size: MotorSize; hp: number } | null {
  const parts = code.trim().toUpperCase().split('-');
  if (parts[0] !== 'SM') return null;
  const [, material = '', , hpPart = '', size = ''] = parts;
  if (material !== 'C' && material !== 'S') return null;
  if (size !== 'V4' && size !== 'V6' && size !== 'V8') return null;
  if (!/^\d+(\.\d+)?$/.test(hpPart)) return null;
  return { material, size, hp: Number(hpPart) };
}
