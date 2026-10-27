import React from 'react';
import type { PhotoView } from '../api/client';

const AVATAR_MAP: Record<PhotoView, string> = {
  front: '/avatars/placeholder_front.jpg',
  side: '/avatars/placeholder_side.jpg',
  back: '/avatars/placeholder_back.jpg',
};

/**
 * User avatar placeholder image for pose reference.
 * Displays high-quality avatar photos for Front, Side, and Back views.
 */
export const PoseGuide: React.FC<{ view: PhotoView; className?: string }> = ({
  view,
  className = 'size-28',
}) => {
  const src = AVATAR_MAP[view] || AVATAR_MAP.front;
  return (
    <div className={`relative inline-block overflow-hidden rounded-full ${className}`}>
      <img
        src={src}
        alt={`${view} view avatar pose`}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    </div>
  );
};
