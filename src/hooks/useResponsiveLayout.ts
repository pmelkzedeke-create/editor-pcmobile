import { useCallback, useEffect, useState } from 'react';

export type DeviceMode = 'desktop' | 'tablet' | 'mobile';
export type ScreenOrientation = 'portrait' | 'landscape';
export type MobileDrawer = 'none' | 'media' | 'text' | 'effects' | 'shapes' | 'audio' | 'inspector';

export interface ResponsiveLayoutState {
  width: number;
  height: number;
  deviceMode: DeviceMode;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  orientation: ScreenOrientation;
  isPortrait: boolean;
  isLandscape: boolean;
  isTouch: boolean;
  hasCoarsePointer: boolean;
  mobileDrawer: MobileDrawer;
  tabletSidebarOpen: boolean;
  tabletInspectorOpen: boolean;
  openMobileDrawer: (drawer: MobileDrawer) => void;
  closeMobileDrawer: () => void;
  toggleMobileDrawer: (drawer: MobileDrawer) => void;
  toggleTabletSidebar: () => void;
  toggleTabletInspector: () => void;
  setTabletSidebarOpen: (open: boolean) => void;
  setTabletInspectorOpen: (open: boolean) => void;
}

function detectIsTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

function calculateLayout(w: number, h: number, touch: boolean): {
  deviceMode: DeviceMode;
  orientation: ScreenOrientation;
} {
  const orientation: ScreenOrientation = w >= h ? 'landscape' : 'portrait';

  // Mobile: screens with width < 680px, OR phone landscape (width < 960px and height < 500px on touch devices)
  const isMobile = w < 768 || (w < 960 && h < 520 && touch);

  // Tablet: screens with 768px <= width < 1024px (unless already classified as mobile landscape)
  const isTablet = !isMobile && w < 1024;

  // Desktop: screens with width >= 1024px
  const deviceMode: DeviceMode = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  return { deviceMode, orientation };
}

export function useResponsiveLayout(): ResponsiveLayoutState {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 1440, height: 900 };
    return { width: window.innerWidth, height: window.innerHeight };
  });

  const [isTouch, setIsTouch] = useState<boolean>(() => detectIsTouch());
  const [hasCoarsePointer, setHasCoarsePointer] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  });

  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawer>('none');
  const [tabletSidebarOpen, setTabletSidebarOpen] = useState<boolean>(false);
  const [tabletInspectorOpen, setTabletInspectorOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDimensions((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      setIsTouch(detectIsTouch());
      setHasCoarsePointer(window.matchMedia('(pointer: coarse)').matches);

      // Auto-close mobile drawer if resizing into large desktop
      if (w >= 1024) {
        setMobileDrawer('none');
      }
    };

    // orientationchange fires before the new size is applied on some browsers.
    const handleOrientation = () => {
      handleResize();
      window.setTimeout(handleResize, 250);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientation);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientation);
    };
  }, []);

  const { deviceMode, orientation } = calculateLayout(dimensions.width, dimensions.height, isTouch);

  const isMobile = deviceMode === 'mobile';
  const isTablet = deviceMode === 'tablet';
  const isDesktop = deviceMode === 'desktop';
  const isPortrait = orientation === 'portrait';
  const isLandscape = orientation === 'landscape';

  const openMobileDrawer = useCallback((drawer: MobileDrawer) => {
    setMobileDrawer(drawer);
  }, []);

  const closeMobileDrawer = useCallback(() => {
    setMobileDrawer('none');
  }, []);

  const toggleMobileDrawer = useCallback((drawer: MobileDrawer) => {
    setMobileDrawer((prev) => (prev === drawer ? 'none' : drawer));
  }, []);

  const toggleTabletSidebar = useCallback(() => {
    setTabletSidebarOpen((prev) => !prev);
  }, []);

  const toggleTabletInspector = useCallback(() => {
    setTabletInspectorOpen((prev) => !prev);
  }, []);

  return {
    width: dimensions.width,
    height: dimensions.height,
    deviceMode,
    isMobile,
    isTablet,
    isDesktop,
    orientation,
    isPortrait,
    isLandscape,
    isTouch,
    hasCoarsePointer,
    mobileDrawer,
    tabletSidebarOpen,
    tabletInspectorOpen,
    openMobileDrawer,
    closeMobileDrawer,
    toggleMobileDrawer,
    toggleTabletSidebar,
    toggleTabletInspector,
    setTabletSidebarOpen,
    setTabletInspectorOpen,
  };
}
