import { useEffect, useRef } from "react";

export interface CreditFlight {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function CreditFlightAnimation({
  flight,
  onComplete,
}: {
  flight: CreditFlight | null;
  onComplete: () => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !flight) return;

    const target = document.querySelector<HTMLElement>(
      '[data-credit-animation-target="campaigns"]',
    );
    const finish = () => {
      if (target) {
        target.animate(
          [
            { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(34 197 94 / 0)" },
            {
              transform: "scale(1.06)",
              boxShadow: "0 0 0 8px rgb(34 197 94 / 0.22)",
            },
            { transform: "scale(1)", boxShadow: "0 0 0 0 rgb(34 197 94 / 0)" },
          ],
          { duration: 480, easing: "ease-out" },
        );
      }
      onCompleteRef.current();
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }

    const deltaX = flight.endX - flight.startX;
    const deltaY = flight.endY - flight.startY;
    const animation = element.animate(
      [
        {
          opacity: 0,
          transform: "translate(-50%, -50%) scale(0.45) rotate(-10deg)",
        },
        {
          offset: 0.14,
          opacity: 1,
          transform: "translate(-50%, -65%) scale(1.2) rotate(0deg)",
        },
        {
          offset: 0.58,
          opacity: 1,
          transform: `translate(calc(-50% + ${deltaX * 0.55}px), calc(-50% + ${deltaY * 0.55 - 70}px)) scale(1) rotate(8deg)`,
        },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px)) scale(0.32) rotate(16deg)`,
        },
      ],
      {
        duration: 2000,
        easing: "cubic-bezier(0.22, 0.8, 0.24, 1)",
        fill: "forwards",
      },
    );
    animation.onfinish = finish;
    return () => animation.cancel();
  }, [flight]);

  if (!flight) return null;

  return (
    <div
      ref={elementRef}
      aria-hidden="true"
      className="pointer-events-none fixed z-[70] flex size-14 items-center justify-center rounded-full border-2 border-green-400 bg-green-50 text-2xl font-black text-green-600 shadow-[0_0_24px_rgb(34_197_94_/_0.5)]"
      style={{ left: flight.startX, top: flight.startY }}
    >
      +1
    </div>
  );
}
