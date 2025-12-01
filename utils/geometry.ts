import { HandLandmark, Point } from '../types';

export const distance = (p1: HandLandmark | Point, p2: HandLandmark | Point): number => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

export const lerp = (start: number, end: number, t: number) => {
  return start * (1 - t) + end * t;
};

export const lerpPoint = (p1: Point, p2: Point, t: number): Point => {
  return {
    x: lerp(p1.x, p2.x, t),
    y: lerp(p1.y, p2.y, t)
  };
};

// Check if fingers are extended based on landmark positions
export const isFingerExtended = (landmarks: HandLandmark[], fingerTipIdx: number, fingerPipIdx: number): boolean => {
  // Comparing Y is okay for upright hand, but distance from wrist is more robust for all angles
  const wrist = landmarks[0];
  const tip = landmarks[fingerTipIdx];
  const pip = landmarks[fingerPipIdx];
  
  return distance(wrist, tip) > distance(wrist, pip);
};

// Specifically for thumb 
export const isThumbExtended = (landmarks: HandLandmark[]): boolean => {
  const thumbTip = landmarks[4];
  const indexMCP = landmarks[5];
  const pinkyMCP = landmarks[17];
  
  return distance(thumbTip, pinkyMCP) > distance(indexMCP, pinkyMCP);
};