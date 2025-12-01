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

/**
 * Checks if a finger is extended.
 * A finger is considered extended if the tip is further from the wrist than the PIP joint.
 */
export const isFingerExtended = (landmarks: HandLandmark[], fingerTipIdx: number, fingerPipIdx: number): boolean => {
  const wrist = landmarks[0];
  const tip = landmarks[fingerTipIdx];
  const pip = landmarks[fingerPipIdx];
  return distance(wrist, tip) > distance(wrist, pip) * 1.1; // 1.1 multiplier for robustness
};

/**
 * Checks if a finger is curled/folded.
 * Stricter check: Tip must be closer to wrist than PIP or very close to MCP.
 */
export const isFingerFolded = (landmarks: HandLandmark[], fingerTipIdx: number, fingerPipIdx: number, fingerMcpIdx: number): boolean => {
  const wrist = landmarks[0];
  const tip = landmarks[fingerTipIdx];
  const pip = landmarks[fingerPipIdx];
  const mcp = landmarks[fingerMcpIdx];
  
  const distTip = distance(wrist, tip);
  const distPip = distance(wrist, pip);
  const distMcp = distance(wrist, mcp);
  
  // Folded if tip is closer to wrist than PIP, or very close to MCP
  return distTip < distPip || distance(tip, mcp) < 0.05;
};

/**
 * Returns true only if ALL 5 fingers are extended and spread.
 */
export const isOpenPalm = (landmarks: HandLandmark[]): boolean => {
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  
  // 1. Check Thumb (Special case)
  const thumbTip = landmarks[4];
  const indexMCP = landmarks[5];
  const pinkyMCP = landmarks[17];
  const isThumbOpen = distance(thumbTip, pinkyMCP) > distance(indexMCP, pinkyMCP);

  // 2. Check other 4 fingers
  const areFingersOpen = tips.every((tipIdx, i) => isFingerExtended(landmarks, tipIdx, pips[i]));

  return isThumbOpen && areFingersOpen;
};

/**
 * Returns true if Index and Middle are open, others are folded (Victory/Peace sign).
 */
export const isVictorySign = (landmarks: HandLandmark[]): boolean => {
  const isIndexOpen = isFingerExtended(landmarks, 8, 6);
  const isMiddleOpen = isFingerExtended(landmarks, 12, 10);
  
  // Ring and Pinky MUST be folded to differentiate from Open Palm
  const isRingFolded = isFingerFolded(landmarks, 16, 14, 13);
  const isPinkyFolded = isFingerFolded(landmarks, 20, 18, 17);

  return isIndexOpen && isMiddleOpen && isRingFolded && isPinkyFolded;
};

/**
 * Returns true if only Index is open (Pointing).
 */
export const isPointing = (landmarks: HandLandmark[]): boolean => {
  const isIndexOpen = isFingerExtended(landmarks, 8, 6);
  const isMiddleFolded = isFingerFolded(landmarks, 12, 10, 9);
  const isRingFolded = isFingerFolded(landmarks, 16, 14, 13);
  const isPinkyFolded = isFingerFolded(landmarks, 20, 18, 17);
  
  return isIndexOpen && isMiddleFolded && isRingFolded && isPinkyFolded;
};
