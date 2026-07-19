/**
 * CropOverlay.tsx
 * SVG polygon crop overlay with 4 draggable corner handles.
 *
 * Each handle is a PanResponder that:
 *   - Tracks start position in a ref
 *   - Computes delta from last move position (not cumulative gesture.dx)
 *   - Calls onCornersChange with updated corners
 */

import React, { useRef, useCallback } from 'react';
import {
  View, StyleSheet, PanResponder, GestureResponderEvent, PanResponderGestureState,
} from 'react-native';
import Svg, { Defs, Mask, Rect, Polygon, Line, Circle } from 'react-native-svg';

import {
  FourCorners, ImageRect, NormalizedPoint,
  normalizedToDisplay,
} from '../utils/imageCoordinates';

type HandleName = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

interface CropOverlayProps {
  corners: FourCorners;
  imgRect: ImageRect;
  onCornersChange: (corners: FourCorners) => void;
  onDragStart?: (handle: HandleName) => void;
  onDragEnd?: (handle: HandleName) => void;
}

const HANDLE_R = 14;   // visual circle radius
const TOUCH_SLOP = 44; // invisible touch target size

function clampNorm(pt: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, pt.x)),
    y: Math.max(0, Math.min(1, pt.y)),
  };
}

function moveCorner(
  corners: FourCorners,
  name: HandleName,
  dx: number,   // normalized delta from last position
  dy: number,
): FourCorners {
  return {
    ...corners,
    [name]: clampNorm({
      x: corners[name].x + dx,
      y: corners[name].y + dy,
    }),
  };
}

// ─── Per-handle PanResponder factory ───────────────────────────────────────────

function makeResponder(
  name: HandleName,
  imgRect: ImageRect,
  onCornersChange: (updater: FourCorners | ((c: FourCorners) => FourCorners)) => void,
  onDragStart?: () => void,
  onDragEnd?: () => void,
) {
  // Track last move position in gesture coordinates
  const lastX = { value: 0 };
  const lastY = { value: 0 };
  // Track start of gesture for cumulative delta
  const startNorm = { x: 0, y: 0 };

  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant() {
      onDragStart?.();
    },

    onPanResponderMove(
      _: GestureResponderEvent,
      gestureState: PanResponderGestureState,
    ) {
      // dx/dy is accumulated since gesture start; we compute per-event delta ourselves
      const dxNorm = (gestureState.dx - lastX.value) / imgRect.width;
      const dyNorm = (gestureState.dy - lastY.value) / imgRect.height;
      if (Math.abs(dxNorm) < 0.0001 && Math.abs(dyNorm) < 0.0001) return;
      // Update last accumulated position
      lastX.value = gestureState.dx;
      lastY.value = gestureState.dy;
      // Move the specific corner by delta
      onCornersChange(prev => moveCorner(prev, name, dxNorm, dyNorm));
    },

    onPanResponderRelease() {
      lastX.value = 0;
      lastY.value = 0;
      onDragEnd?.();
    },

    onPanResponderTerminate() {
      lastX.value = 0;
      lastY.value = 0;
      onDragEnd?.();
    },

    onPanResponderTerminationRequest: () => false,
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CropOverlay({
  corners, imgRect, onCornersChange, onDragStart, onDragEnd,
}: CropOverlayProps) {
  // Peek at current corners without setState overhead
  const cornersRef = useRef(corners);
  cornersRef.current = corners;

  const safeOnChange = useCallback(
    (updater: FourCorners | ((c: FourCorners) => FourCorners)): void => {
      const next = typeof updater === 'function'
        ? updater(cornersRef.current)
        : updater;
      cornersRef.current = next;
      onCornersChange(next);
    },
    [onCornersChange],
  );

  const tlResp = useCallback(
    () => makeResponder('topLeft',     imgRect, safeOnChange,
      () => onDragStart?.('topLeft'),
      () => onDragEnd?.('topLeft')),
    [imgRect, safeOnChange, onDragStart, onDragEnd]);

  const trResp = useCallback(
    () => makeResponder('topRight',    imgRect, safeOnChange,
      () => onDragStart?.('topRight'),
      () => onDragEnd?.('topRight')),
    [imgRect, safeOnChange, onDragStart, onDragEnd]);

  const brResp = useCallback(
    () => makeResponder('bottomRight', imgRect, safeOnChange,
      () => onDragStart?.('bottomRight'),
      () => onDragEnd?.('bottomRight')),
    [imgRect, safeOnChange, onDragStart, onDragEnd]);

  const blResp = useCallback(
    () => makeResponder('bottomLeft',  imgRect, safeOnChange,
      () => onDragStart?.('bottomLeft'),
      () => onDragEnd?.('bottomLeft')),
    [imgRect, safeOnChange, onDragStart, onDragEnd]);

  const tl = normalizedToDisplay(corners.topLeft, imgRect);
  const tr = normalizedToDisplay(corners.topRight, imgRect);
  const br = normalizedToDisplay(corners.bottomRight, imgRect);
  const bl = normalizedToDisplay(corners.bottomLeft, imgRect);

  const pts = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;

  const handles: { name: HandleName; pt: NormalizedPoint; resp: ReturnType<typeof makeResponder> }[] = [
    { name: 'topLeft',     pt: tl, resp: tlResp() },
    { name: 'topRight',    pt: tr, resp: trResp() },
    { name: 'bottomRight',  pt: br, resp: brResp() },
    { name: 'bottomLeft',  pt: bl, resp: blResp() },
  ];

  return (
    <View
      style={[styles.container, {
        left: imgRect.left, top: imgRect.top,
        width: imgRect.width, height: imgRect.height,
      }]}
      pointerEvents="box-none"
    >
      {/* SVG overlay: dark mask + border lines */}
      <Svg
        width={imgRect.width}
        height={imgRect.height}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Defs>
          <Mask id="cropMask" maskUnits="userSpaceOnUse">
            <Rect x={0} y={0}
              width={imgRect.width} height={imgRect.height} fill="white" />
            <Polygon points={pts} fill="black" />
          </Mask>
        </Defs>

        {/* Semi-transparent dark overlay outside polygon */}
        <Rect x={0} y={0}
          width={imgRect.width} height={imgRect.height}
          fill="rgba(0,0,0,0.55)"
          mask="url(#cropMask)"
        />

        {/* Polygon border — 4 line segments connecting the corners in order */}
        {([[tl, tr], [tr, br], [br, bl], [bl, tl]] as [NormalizedPoint, NormalizedPoint][]).map(([pa, pb], i) => (
          <Line
            key={i}
            x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke="#14B8A6" strokeWidth={2.5} strokeLinecap="round"
          />
        ))}

        {/* Corner dots */}
        {[tl, tr, br, bl].map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#14B8A6" />
        ))}
      </Svg>

      {/* Draggable handle touch targets */}
      {handles.map(({ name, pt, resp }) => (
        <View
          key={name}
          {...resp.panHandlers}
          style={[
            styles.touchTarget,
            { left: pt.x - TOUCH_SLOP / 2, top: pt.y - TOUCH_SLOP / 2 },
          ]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={[
            styles.handleCircle,
            name === 'topLeft'     && styles.hTL,
            name === 'topRight'    && styles.hTR,
            name === 'bottomRight' && styles.hBR,
            name === 'bottomLeft'  && styles.hBL,
          ]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 10,
  },
  touchTarget: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleCircle: {
    width: HANDLE_R * 2,
    height: HANDLE_R * 2,
    borderRadius: HANDLE_R,
    backgroundColor: '#14B8A6',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  hTL: {},
  hTR: {},
  hBR: {},
  hBL: {},
});
