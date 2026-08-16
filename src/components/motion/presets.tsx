import { animate, m, type HTMLMotionProps, type Variants } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const spring = { type: "spring", stiffness: 420, damping: 32 } as const;

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: "easeOut" } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
};

export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};

export function Reveal({
  children,
  className,
  ...props
}: HTMLMotionProps<"div"> & { children: ReactNode }) {
  return (
    <m.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.1 }}
      variants={fadeUp}
      className={className}
      {...props}
    >
      {children}
    </m.div>
  );
}

export function AnimatedNumber({
  value,
  format = (number) => Math.round(number).toLocaleString("en-IN"),
}: {
  value: number;
  format?: (value: number) => string;
}) {
  const [display, setDisplay] = useState(0);
  const previous = useRef(0);

  useEffect(() => {
    const controls = animate(previous.current, value, {
      duration: 0.65,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setDisplay,
    });
    previous.current = value;
    return controls.stop;
  }, [value]);

  return <>{format(display)}</>;
}

export function StaggerGroup({
  children,
  className,
  ...props
}: HTMLMotionProps<"div"> & { children: ReactNode }) {
  return (
    <m.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.08 }}
      variants={stagger}
      className={className}
      {...props}
    >
      {children}
    </m.div>
  );
}

export function StaggerItem({
  children,
  className,
  ...props
}: HTMLMotionProps<"div"> & { children: ReactNode }) {
  return (
    <m.div variants={fadeUp} className={className} {...props}>
      {children}
    </m.div>
  );
}
