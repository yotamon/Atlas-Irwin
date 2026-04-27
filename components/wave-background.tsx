"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

type WaveBackgroundProps = {
  className?: string;
};

export function WaveBackground({ className = "" }: WaveBackgroundProps) {
  const { scrollY } = useScroll();
  const shouldReduceMotion = useReducedMotion();
  const y = useTransform(scrollY, [0, 500], [0, shouldReduceMotion ? 0 : -42]);

  return (
    <motion.div
      aria-hidden="true"
      style={{ y }}
      className={`pointer-events-none absolute bottom-0 left-[-10vw] w-[64vw] min-w-[24rem] max-w-[48rem] text-ink ${className}`}
    >
      <svg
        viewBox="0 0 760 350"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-auto w-full opacity-95"
      >
        {Array.from({ length: 10 }).map((_, index) => {
          const yOffset = 26 + index * 31;
          const variance = index % 2 === 0 ? 12 : 18;

          return (
            <path
              key={yOffset}
              d={`M-10 ${yOffset} C 65 ${yOffset - variance}, 145 ${yOffset + variance}, 230 ${yOffset} S 405 ${yOffset - variance}, 505 ${yOffset} 655 ${yOffset + variance}, 760 ${yOffset - variance}, 820 ${yOffset}`}
              stroke="currentColor"
              strokeWidth={index > 7 ? 4.8 : 3.2}
              strokeLinecap="round"
              className={index > 6 ? "opacity-100" : "opacity-92"}
            />
          );
        })}
      </svg>
    </motion.div>
  );
}
