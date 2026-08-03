/**
 * DOM input binding for {@link OrbitCamera}.
 *
 * Kept separate from the camera itself so the motion model stays testable
 * without a browser. This file is only event plumbing.
 */
import type { OrbitCamera } from './orbitCamera.js';

export interface ControlsHandle {
  dispose(): void;
}

/** Keyboard step sizes, chosen to feel like a short drag / one wheel notch. */
const KEY_DRAG_PIXELS = 40;
const KEY_ZOOM_NOTCHES = 1;

export function bindControls(element: HTMLElement, camera: OrbitCamera): ControlsHandle {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let activePointer: number | undefined;

  const onPointerDown = (e: PointerEvent): void => {
    if (activePointer !== undefined) {
      return;
    }
    dragging = true;
    activePointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    element.setPointerCapture(e.pointerId);
    // Grabbing the globe stops it — matches every map interface.
    camera.halt();
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== activePointer) {
      return;
    }
    camera.drag(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const endDrag = (e: PointerEvent): void => {
    if (e.pointerId !== activePointer) {
      return;
    }
    dragging = false;
    activePointer = undefined;
    if (element.hasPointerCapture(e.pointerId)) {
      element.releasePointerCapture(e.pointerId);
    }
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // deltaMode 1 is lines, 2 is pages; normalise both to notch-ish units.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    camera.zoom((e.deltaY * unit) / 100);
  };

  // Keyboard fallbacks, for accessibility (PRD R18).
  const onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowLeft':
        camera.drag(-KEY_DRAG_PIXELS, 0);
        break;
      case 'ArrowRight':
        camera.drag(KEY_DRAG_PIXELS, 0);
        break;
      case 'ArrowUp':
        camera.drag(0, -KEY_DRAG_PIXELS);
        break;
      case 'ArrowDown':
        camera.drag(0, KEY_DRAG_PIXELS);
        break;
      case '+':
      case '=':
        camera.zoom(-KEY_ZOOM_NOTCHES);
        break;
      case '-':
      case '_':
        camera.zoom(KEY_ZOOM_NOTCHES);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('keydown', onKeyDown);
  element.tabIndex = 0;

  return {
    dispose(): void {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('keydown', onKeyDown);
    },
  };
}
