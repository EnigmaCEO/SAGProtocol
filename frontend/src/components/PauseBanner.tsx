import React from "react";

interface PauseBannerProps {
  paused: boolean;
}

export default function PauseBanner({ paused }: PauseBannerProps) {
  if (!paused) return null;

  return (
    <div className="bg-red-600 text-white px-4 py-3 rounded-md mb-4">
      <strong>⚠️ Protocol Paused</strong> — All actions are currently disabled.
    </div>
  );
}
