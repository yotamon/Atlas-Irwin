import type { CSSProperties } from "react";

type IconProps = {
  className?: string;
  style?: CSSProperties;
};

export function StarMarkIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M16 2.5C16.6 8.6 18.2 13.3 21 16C18.2 18.7 16.6 23.4 16 29.5C15.4 23.4 13.8 18.7 11 16C13.8 13.3 15.4 8.6 16 2.5Z"
        fill="currentColor"
      />
      <path
        d="M29.5 16C23.4 16.6 18.7 18.2 16 21C13.3 18.2 8.6 16.6 2.5 16C8.6 15.4 13.3 13.8 16 11C18.7 13.8 23.4 15.4 29.5 16Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SoundMotionIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 40"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M11 23V17"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M16 26V14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M21 28V12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M26 25V15"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M31 22V18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ScrollArrowIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24" r="22.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M24 14.5V28.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M18.5 24L24 29.5L29.5 24"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WaveStampIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 36"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {[7, 15, 23, 31].map((yOffset) => (
        <path
          key={yOffset}
          d={`M2 ${yOffset} C 24 ${yOffset - 4}, 42 ${yOffset + 4}, 66 ${yOffset} S 110 ${yOffset - 4}, 134 ${yOffset} 176 ${yOffset + 4}, 198 ${yOffset}`}
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function PlayIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 6.5L18 12L8 17.5V6.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 6.5H10.8V17.5H8V6.5Z" fill="currentColor" />
      <path d="M13.2 6.5H16V17.5H13.2V6.5Z" fill="currentColor" />
    </svg>
  );
}

export function SunIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <path d="M12 2.5V5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18.8V21.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M21.5 12H18.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5.2 12H2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.9 5.1L17 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 17L5.1 18.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.9 18.9L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 7L5.1 5.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.7 3.4C14.4 3.3 13 3.6 11.7 4.2A8.8 8.8 0 1 0 20 17c.6-1.3.9-2.7.8-4-1.2 1-2.8 1.6-4.5 1.6-4 0-7.2-3.2-7.2-7.2 0-1.6.5-3 1.6-4.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ArrowRightIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 12H19"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M13.5 6.5L19 12L13.5 17.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WaveformIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 96 20"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {[
        [4, 10, 10],
        [14, 7, 13],
        [24, 4, 16],
        [34, 8, 12],
        [44, 3, 17],
        [54, 6, 14],
        [64, 9, 11],
        [74, 4, 16],
        [84, 7, 13],
        [92, 10, 10],
      ].map(([x, y1, y2]) => (
        <path
          key={`${x}-${y1}`}
          d={`M${x} ${y1}V${y2}`}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function ExternalLinkIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14 5H19V10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 14L19 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 13V17.2C19 18.19 18.19 19 17.2 19H6.8C5.81 19 5 18.19 5 17.2V6.8C5 5.81 5.81 5 6.8 5H11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.5 12.5L9.5 16.5L18.5 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SpotifyIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12S6.2 22.5 12 22.5 22.5 17.8 22.5 12 17.8 1.5 12 1.5Zm4.82 15.13a.83.83 0 0 1-1.14.27c-3.12-1.91-7.06-2.34-11.73-1.28a.83.83 0 1 1-.37-1.62c5.1-1.16 9.48-.66 12.96 1.48a.83.83 0 0 1 .28 1.15Zm1.63-3.63a1.04 1.04 0 0 1-1.44.34c-3.56-2.18-8.98-2.81-13.19-1.54a1.04 1.04 0 0 1-.6-2c4.82-1.45 10.81-.75 14.88 1.74.49.3.64.94.35 1.46Zm.14-3.77C14.2 6.62 7.1 6.39 3.01 7.63a1.25 1.25 0 1 1-.72-2.39c4.7-1.42 12.52-1.15 17.58 1.86a1.25 1.25 0 0 1-1.28 2.13Z" />
    </svg>
  );
}

export function SoundCloudIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M10.69 7.2a6.17 6.17 0 0 1 6.03 4.52 3.92 3.92 0 0 1 .46-.03A4.32 4.32 0 1 1 17.2 20H6.07a1.32 1.32 0 0 1-1.32-1.32V7.18c0-.54.33-1.03.83-1.23a6.18 6.18 0 0 1 5.11 1.25Zm-7.24 6.16c-.52 0-.95.43-.95.95v4.37c0 .52.43.95.95.95s.95-.43.95-.95V14.3c0-.52-.43-.95-.95-.95Zm2.22-2.3c-.52 0-.95.43-.95.95v6.67c0 .52.43.95.95.95s.95-.43.95-.95V12c0-.52-.43-.95-.95-.95Zm2.22-1.55c-.52 0-.95.43-.95.95v8.22c0 .52.43.95.95.95s.95-.43.95-.95v-8.22c0-.52-.43-.95-.95-.95Zm2.22-.2c-.52 0-.95.42-.95.94v8.42c0 .52.43.95.95.95s.95-.43.95-.95v-8.42c0-.52-.43-.95-.95-.95Z" />
    </svg>
  );
}

export function DeezerIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M3 15.5H6.1V19H3V15.5Z" />
      <path d="M7.15 13.2H10.25V19H7.15V13.2Z" />
      <path d="M11.3 10.6H14.4V19H11.3V10.6Z" />
      <path d="M15.45 8H18.55V19H15.45V8Z" />
      <path d="M19.6 12.1H22.7V19H19.6V12.1Z" />
    </svg>
  );
}

export function AppleMusicIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.8 5.5V14.8C15.8 16.2 14.55 17.35 12.95 17.35C11.35 17.35 10.1 16.2 10.1 14.8C10.1 13.4 11.35 12.25 12.95 12.25C13.56 12.25 14.07 12.39 14.55 12.68V8.05L8.2 9.35V16.1C8.2 17.5 6.95 18.65 5.35 18.65C3.75 18.65 2.5 17.5 2.5 16.1C2.5 14.7 3.75 13.55 5.35 13.55C5.96 13.55 6.47 13.69 6.95 13.98V7.55L15.8 5.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function YouTubeIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21.3 8.1C21.07 7.26 20.42 6.61 19.58 6.38C18.06 5.95 12 5.95 12 5.95C12 5.95 5.94 5.95 4.42 6.38C3.58 6.61 2.93 7.26 2.7 8.1C2.27 9.62 2.27 12.8 2.27 12.8C2.27 12.8 2.27 15.98 2.7 17.5C2.93 18.34 3.58 18.99 4.42 19.22C5.94 19.65 12 19.65 12 19.65C12 19.65 18.06 19.65 19.58 19.22C20.42 18.99 21.07 18.34 21.3 17.5C21.73 15.98 21.73 12.8 21.73 12.8C21.73 12.8 21.73 9.62 21.3 8.1Z"
        fill="currentColor"
      />
      <path d="M10.1 15.7V9.9L15.15 12.8L10.1 15.7Z" fill="var(--paper)" />
    </svg>
  );
}

export function InstagramIcon({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.3" cy="6.9" r="1.1" fill="currentColor" />
    </svg>
  );
}
