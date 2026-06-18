import { useEffect, useState } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
}

function readViewportSize(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(readViewportSize);

  useEffect(() => {
    const handleResize = (): void => setSize(readViewportSize());

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return size;
}
