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
    // fork:gap07-attachments — 任意文件都可拖入（之前非图片直接标为“拒收”）。
    // `kind === "file"` 才是文件；拖选中的文本/HTML 仍然不算。
    const hasFiles = items.some((item) => item.kind === "file");
    if (!hasFiles) {
      flagRejected();
      return;
    }
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, [flagRejected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasFiles = Array.from(e.dataTransfer.items).some((item) => item.kind === "file");
    if (!hasFiles) return;
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