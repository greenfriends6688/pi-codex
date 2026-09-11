"use client";

import { useState, useCallback, useRef } from "react";

export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRejectedDrag, setIsRejectedDrag] = useState(false);
  const counterRef = useRef(0);
  const rejectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flagRejected = useCallback(() => {
    setIsRejectedDrag(true);
    if (rejectTimerRef.current) clearTimeout(rejectTimerRef.current);
    rejectTimerRef.current = setTimeout(() => setIsRejectedDrag(false), 1200);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const items = Array.from(e.dataTransfer.items);
    if (items.length === 0) return;
    const hasImages = items.some((item) => item.type.startsWith("image/"));
    if (!hasImages) {
      flagRejected();
      return;
    }
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, [flagRejected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasImages = Array.from(e.dataTransfer.items).some((item) => item.type.startsWith("image/"));
    if (!hasImages) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    setIsRejectedDrag(false);
    const files = Array.from(e.dataTransfer.files);
    onDrop(files);
  }, [onDrop]);

  return { isDragOver, isRejectedDrag, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}