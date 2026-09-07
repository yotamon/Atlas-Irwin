"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

export function StudioMotionStage({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="ensemblis-motion-stage"
        initial={
          reduceMotion
            ? false
            : { opacity: 0, y: 14, scale: 0.996, filter: "blur(7px)" }
        }
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={
          reduceMotion
            ? { opacity: 1 }
            : { opacity: 0, y: -8, scale: 1.002, filter: "blur(5px)" }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.42, ease: [0.22, 1, 0.36, 1] }
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
