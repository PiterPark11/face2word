export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  size: number;
  isEraser: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
}

export enum HandGesture {
  NONE = 'NONE',
  PINCH_DRAW = 'PINCH_DRAW', // Index + Thumb touching
  OPEN_PALM = 'OPEN_PALM',   // All fingers open
  POINTING = 'POINTING',     // Index finger only
  PEACE_CLEAR = 'PEACE_CLEAR', // Index + Middle (Victory sign)
  TWO_FINGER_ZOOM = 'TWO_FINGER_ZOOM' // Logic handles this outside simple enum usually
}

export enum Tool {
  PEN = 'PEN',
  ERASER = 'ERASER'
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

// MediaPipe Type Stubs (since we load via CDN)
export interface Results {
  multiHandLandmarks: HandLandmark[][];
  multiHandedness: any[];
  image: any;
}