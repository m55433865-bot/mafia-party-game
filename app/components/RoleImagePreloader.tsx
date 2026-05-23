"use client";

import { useEffect } from "react";
import { roleCards } from "../lib/roles";

export function RoleImagePreloader() {
  useEffect(() => {
    const preloadedImages = roleCards.map((roleCard) => {
      const image = new Image();
      image.src = roleCard.imageSrc;
      return image;
    });

    return () => {
      preloadedImages.length = 0;
    };
  }, []);

  return (
    <div aria-hidden="true" className="hidden">
      {roleCards.map((roleCard) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={roleCard.title}
          alt=""
          loading="eager"
          src={roleCard.imageSrc}
        />
      ))}
    </div>
  );
}
