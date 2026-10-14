import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { palette } from '@/theme';

/**
 * The IRIS icon set, drawn as vectors.
 *
 * Why vectors rather than images: these five marks are simple geometry, and
 * geometry stays sharp at every size and density. The previous raster set had to
 * be cropped, rescaled and brightness-corrected, and it still came out soft and
 * slightly uneven — because a bitmap has exactly one correct size and everything
 * else is a compromise. Drawn as paths, they are exact at 20dp or 200dp.
 *
 * Symmetry is structural, not eyeballed. Every icon is drawn on the SAME 24x24
 * grid, uses the SAME stroke width, and is centred on the SAME point (12,12), so
 * they line up with each other by construction rather than by cropping them to
 * matching boxes and hoping.
 *
 * They also take `color`, which means the active/inactive states are a prop
 * change instead of two separate images.
 */

export interface IrisIconProps {
  size?: number;
  color?: string;
  /** Stroke weight. Kept thin — these are line marks, not filled glyphs. */
  strokeWidth?: number;
}

const GRID = 24;
const CENTRE = 12;
const DEFAULT_STROKE = 1.4;

/**
 * A four-pointed star — the motif that runs through the whole set.
 * Concave sides, so it reads as a spark rather than a diamond.
 */
const STAR_PATH = `M${CENTRE} 5.2 C${CENTRE + 0.7} 9.6 14.4 11.3 18.8 12 C14.4 12.7 ${
  CENTRE + 0.7
} 14.4 ${CENTRE} 18.8 C${CENTRE - 0.7} 14.4 9.6 12.7 5.2 12 C9.6 11.3 ${
  CENTRE - 0.7
} 9.6 ${CENTRE} 5.2 Z`;

/** CHAT — a speech bubble with the spark inside. */
export function ChatIcon({ size, color = palette.text, strokeWidth }: IrisIconProps): React.JSX.Element {
  const sw = strokeWidth ?? DEFAULT_STROKE;
  return (
    <Svg width={size ?? 28} height={size ?? 28} viewBox={`0 0 ${GRID} ${GRID}`} fill="none">
      <Path
        d="M12 3.4c4.7 0 8.6 3.4 8.6 7.6S16.7 18.6 12 18.6c-1 0-2-.15-2.9-.42l-4.3 2.06a.5.5 0 0 1-.71-.55l.5-2.9C3.5 15.5 3.4 13.4 3.4 11 3.4 6.8 7.3 3.4 12 3.4Z"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <Path d={STAR_PATH} fill={color} />
    </Svg>
  );
}

/** CONTACTS — two overlapping circles, with a spark where they meet. */
export function ContactsIcon({ size, color = palette.text, strokeWidth }: IrisIconProps): React.JSX.Element {
  const sw = strokeWidth ?? DEFAULT_STROKE;
  return (
    <Svg width={size ?? 28} height={size ?? 28} viewBox={`0 0 ${GRID} ${GRID}`} fill="none">
      <Circle cx={8.6} cy={CENTRE} r={5.6} stroke={color} strokeWidth={sw} />
      <Circle cx={15.4} cy={CENTRE} r={5.6} stroke={color} strokeWidth={sw} />
      <Circle cx={CENTRE} cy={CENTRE} r={1.5} fill={color} />
    </Svg>
  );
}

/** SETTINGS — the instrument: a ring, a needle, the spark, and one satellite. */
export function SettingsIcon({ size, color = palette.text, strokeWidth }: IrisIconProps): React.JSX.Element {
  const sw = strokeWidth ?? DEFAULT_STROKE;
  return (
    <Svg width={size ?? 28} height={size ?? 28} viewBox={`0 0 ${GRID} ${GRID}`} fill="none">
      <Circle cx={CENTRE} cy={CENTRE} r={7.4} stroke={color} strokeWidth={sw} />
      {/* The needle runs through the whole mark, top to bottom. */}
      <Path d={`M${CENTRE} 2.6 V21.4`} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Path d={STAR_PATH} fill={color} />
      {/* Satellite, sitting on the ring at the upper right. */}
      <Circle cx={17.9} cy={7.5} r={1.5} fill={color} />
    </Svg>
  );
}

/** CREATE GROUP — three points of a triangle, joined. */
export function CreateGroupIcon({ size, color = palette.text, strokeWidth }: IrisIconProps): React.JSX.Element {
  const sw = strokeWidth ?? DEFAULT_STROKE;
  // An equilateral triangle centred on (12,12), so it sits level with the others.
  const top = { x: 12, y: 5.4 };
  const left = { x: 5.4, y: 17.2 };
  const right = { x: 18.6, y: 17.2 };
  return (
    <Svg width={size ?? 28} height={size ?? 28} viewBox={`0 0 ${GRID} ${GRID}`} fill="none">
      <Path
        d={`M${top.x} ${top.y} L${left.x} ${left.y} L${right.x} ${right.y} Z`}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <Circle cx={top.x} cy={top.y} r={2.1} fill={color} />
      <Circle cx={left.x} cy={left.y} r={2.1} fill={color} />
      <Circle cx={right.x} cy={right.y} r={2.1} fill={color} />
    </Svg>
  );
}

/** NEW CHAT — a ring broken top and bottom, with the spark inside. */
export function NewChatIcon({ size, color = palette.text, strokeWidth }: IrisIconProps): React.JSX.Element {
  const sw = strokeWidth ?? DEFAULT_STROKE;
  // Two arcs, leaving deliberate gaps at the top and bottom — the open ring.
  const r = 7.6;
  const d = `M${CENTRE} ${CENTRE - r} A${r} ${r} 0 0 1 ${CENTRE} ${CENTRE + r} A${r} ${r} 0 0 1 ${
    CENTRE
  } ${CENTRE - r}`;
  return (
    <Svg width={size ?? 28} height={size ?? 28} viewBox={`0 0 ${GRID} ${GRID}`} fill="none">
      <Path
        d={d}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        // The gaps: most of the ring drawn, a slice omitted at top and bottom.
        strokeDasharray="20.5 3.4"
      />
      <Path d={STAR_PATH} fill={color} />
    </Svg>
  );
}
