import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MenuLayer } from './components/MenuLayer';
import { Tool, Stroke, Point, HandGesture, HandLandmark, Results, Particle } from './types';
import { distance, isFingerExtended, lerpPoint } from './utils/geometry';

// Type definition for window.MediaPipe
declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

const App: React.FC = () => {
  // --- Refs (Mutable state for the loop) ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Logic State (Refs to avoid re-renders)
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const canvasTransformRef = useRef({ x: 0, y: 0, scale: 1 });
  
  // Input Smoothing
  const lastPointRef = useRef<Point | null>(null);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPinchCenterRef = useRef<Point | null>(null);
  const palmHoldStartRef = useRef<number>(0);
  const toggleCooldownRef = useRef<number>(0);
  const lastGestureRef = useRef<HandGesture>(HandGesture.NONE);

  // --- React State (Only for UI Overlay) ---
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [currentTool, setCurrentTool] = useState<Tool>(Tool.PEN);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  const [currentSize, setCurrentSize] = useState(6);
  const [cursorPos, setCursorPos] = useState<Point | null>(null); // Only for Menu
  const [debugMsg, setDebugMsg] = useState("Initializing Camera...");

  // --- Helpers ---
  
  const toCanvasPoint = (landmark: HandLandmark): Point => {
    // 1. Get raw screen coordinates (Mirrored X)
    const screenX = (1 - landmark.x) * window.innerWidth;
    const screenY = landmark.y * window.innerHeight;

    // 2. Inverse Transform to get World Space (for drawing)
    const t = canvasTransformRef.current;
    return {
      x: (screenX - t.x) / t.scale,
      y: (screenY - t.y) / t.scale
    };
  };

  const toScreenPoint = (landmark: HandLandmark): Point => {
    return {
      x: (1 - landmark.x) * window.innerWidth,
      y: landmark.y * window.innerHeight
    };
  };

  // --- Main Render & Logic Loop (Driven by MediaPipe) ---
  const onResults = useCallback((results: Results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    // Ensure canvas size matches window
    if (canvas) {
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. Draw Background (Video Feed)
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Important: Mirror the video feed
      ctx.scale(-1, 1);
      ctx.translate(-canvas.width, 0);
      
      // Use results.image if available, otherwise fallback to video element
      if (results.image) {
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      } else if (video && video.readyState >= 2) {
         ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      ctx.restore();

      // --- Logic Processing ---
      let gesture = HandGesture.NONE;
      let primaryHand = null;
      let secondaryHand = null;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Assume first hand is primary for drawing
        primaryHand = results.multiHandLandmarks[0];
        if (results.multiHandLandmarks.length > 1) {
          secondaryHand = results.multiHandLandmarks[1];
        }

        const indexTip = primaryHand[8];
        const indexPip = primaryHand[6];
        const thumbTip = primaryHand[4];
        const middleTip = primaryHand[12];
        const ringTip = primaryHand[16];
        const pinkyTip = primaryHand[20];

        // Finger States
        const isIndexOpen = isFingerExtended(primaryHand, 8, 6);
        const isMiddleOpen = isFingerExtended(primaryHand, 12, 10);
        const isRingOpen = isFingerExtended(primaryHand, 16, 14);
        const isPinkyOpen = isFingerExtended(primaryHand, 20, 18);
        
        // Calculate Pinch Distance (Index Tip <-> Thumb Tip)
        // Convert to screen space for consistent pixel distance checks or use raw normalized
        const pinchRawDist = distance(indexTip, thumbTip);
        
        // Gesture Detection Hierarchy

        // 1. Two Finger Zoom (Highest Priority)
        if (secondaryHand && isIndexOpen && isFingerExtended(secondaryHand, 8, 6)) {
           gesture = HandGesture.TWO_FINGER_ZOOM;
        }
        // 2. Open Palm (Menu) - All fingers open
        else if (isIndexOpen && isMiddleOpen && isRingOpen && isPinkyOpen && pinchRawDist > 0.1) {
          gesture = HandGesture.OPEN_PALM;
        }
        // 3. Clear (Peace Sign) - Index & Middle open, Ring & Pinky closed
        else if (isIndexOpen && isMiddleOpen && !isRingOpen && !isPinkyOpen) {
          gesture = HandGesture.PEACE_CLEAR;
        }
        // 4. Pointing (Menu Selection) - Only index open
        else if (isIndexOpen && !isMiddleOpen && !isRingOpen && !isPinkyOpen && pinchRawDist > 0.05) {
          gesture = HandGesture.POINTING;
        }
        // 5. Drawing (Pinch) - Index and Thumb close
        else if (pinchRawDist < 0.05) { // 0.05 is threshold for "touching"
          gesture = HandGesture.PINCH_DRAW;
        }
      }

      const now = Date.now();

      // --- Gesture Handling ---

      // Menu Toggle
      if (gesture === HandGesture.OPEN_PALM) {
        if (palmHoldStartRef.current === 0) palmHoldStartRef.current = now;
        if (now - palmHoldStartRef.current > 400 && now - toggleCooldownRef.current > 1000) {
          setIsMenuOpen(prev => !prev);
          toggleCooldownRef.current = now;
          palmHoldStartRef.current = 0;
          currentStrokeRef.current = null;
        }
      } else {
        palmHoldStartRef.current = 0;
      }

      // If Menu is Open, only handle pointing
      if (isMenuOpen) {
        if (gesture === HandGesture.POINTING && primaryHand) {
          const rawPoint = { x: 1 - primaryHand[8].x, y: primaryHand[8].y };
          setCursorPos(rawPoint);
        } else {
          setCursorPos(null);
        }
        // Skip drawing/zoom logic
      } else {
        // Menu Closed - Interactions
        setCursorPos(null);

        // Zoom Logic
        if (gesture === HandGesture.TWO_FINGER_ZOOM && primaryHand && secondaryHand) {
          const p1 = toScreenPoint(primaryHand[8]);
          const p2 = toScreenPoint(secondaryHand[8]);
          const currentDist = distance(p1, p2);
          const centerX = (p1.x + p2.x) / 2;
          const centerY = (p1.y + p2.y) / 2;

          if (lastPinchDistRef.current !== null && lastPinchCenterRef.current !== null) {
             const deltaScale = currentDist / lastPinchDistRef.current;
             const prev = canvasTransformRef.current;
             
             // Smooth Zoom
             const newScale = Math.min(Math.max(prev.scale * deltaScale, 0.5), 5);
             
             // Zoom towards center: Translate correction
             const newX = centerX - (centerX - prev.x) * (newScale / prev.scale);
             const newY = centerY - (centerY - prev.y) * (newScale / prev.scale);

             canvasTransformRef.current = { x: newX, y: newY, scale: newScale };
          }
          lastPinchDistRef.current = currentDist;
          lastPinchCenterRef.current = { x: centerX, y: centerY };
          currentStrokeRef.current = null;
          lastPointRef.current = null;
        } else {
          lastPinchDistRef.current = null;
        }

        // Clear (Peace) Logic
        if (gesture === HandGesture.PEACE_CLEAR) {
           if (strokesRef.current.length > 0) {
             // Explode strokes into particles
             strokesRef.current.forEach(s => {
               for (let i = 0; i < s.points.length; i += 3) {
                 const p = s.points[i];
                 particlesRef.current.push({
                   x: p.x,
                   y: p.y,
                   vx: (Math.random() - 0.5) * 6,
                   vy: (Math.random() * -2) - 2, // Upward burst
                   color: s.color,
                   size: Math.random() * s.size + 2,
                   life: 1.0 + Math.random() * 0.5
                 });
               }
             });
             strokesRef.current = [];
           }
           currentStrokeRef.current = null;
           lastPointRef.current = null;
        }

        // Drawing Logic
        if (gesture === HandGesture.PINCH_DRAW && primaryHand) {
          const rawTarget = toCanvasPoint(primaryHand[8]);
          
          // Smoothing: Exponential Moving Average
          const smoothFactor = 0.4;
          const point = lastPointRef.current 
            ? lerpPoint(lastPointRef.current, rawTarget, smoothFactor) 
            : rawTarget;
          
          lastPointRef.current = point;

          if (!currentStrokeRef.current) {
            // Start new stroke
            currentStrokeRef.current = {
              points: [point],
              color: currentTool === Tool.ERASER ? '#000000' : currentColor,
              size: currentSize,
              isEraser: currentTool === Tool.ERASER
            };
          } else {
            // Append to existing
            const pts = currentStrokeRef.current.points;
            const lastP = pts[pts.length - 1];
            if (distance(lastP, point) > 1) { // Min distance to reduce point density
               pts.push(point);
            }
          }
        } else {
           // Lift pen
           if (currentStrokeRef.current) {
             strokesRef.current.push(currentStrokeRef.current);
             currentStrokeRef.current = null;
           }
           lastPointRef.current = null;
        }
      }

      // --- Drawing the World (Ink & Particles) ---
      
      const t = canvasTransformRef.current;
      ctx.save();
      // Apply Pan/Zoom Transform
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);
      
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const drawStroke = (s: Stroke) => {
        if (s.points.length < 2) return;
        ctx.beginPath();
        ctx.lineWidth = s.size;
        ctx.strokeStyle = s.color;
        
        if (s.isEraser) {
          ctx.globalCompositeOperation = 'destination-out';
        } else {
          ctx.globalCompositeOperation = 'source-over';
        }

        // Quadratic Bezier smoothing
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length - 1; i++) {
          const p1 = s.points[i];
          const p2 = s.points[i + 1];
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          ctx.quadraticCurveTo(p1.x, p1.y, mid.x, mid.y);
        }
        ctx.lineTo(s.points[s.points.length - 1].x, s.points[s.points.length - 1].y);
        
        ctx.stroke();
      };

      // Draw History
      strokesRef.current.forEach(drawStroke);
      // Draw Active
      if (currentStrokeRef.current) drawStroke(currentStrokeRef.current);

      // Draw Particles (Snow)
      if (particlesRef.current.length > 0) {
        ctx.globalCompositeOperation = 'source-over';
        particlesRef.current.forEach(p => {
          ctx.beginPath();
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.life;
          ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
          
          // Update Logic inside render loop
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.15; // Gravity
          p.vx *= 0.99; // Drag
          p.life -= 0.015; // Fade
          p.size *= 0.99; // Shrink
        });
        ctx.globalAlpha = 1.0;
        // Clean up dead particles
        particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      }

      ctx.restore();
      
      // Visual Debug for Gesture
      if (!isMenuOpen) {
        setDebugMsg(`Mode: ${isMenuOpen ? "MENU" : gesture.replace('_', ' ')}`);
      }
    }
  }, [isMenuOpen, currentColor, currentSize, currentTool]);


  // --- Initialization ---
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    let camera: any = null;
    let hands: any = null;

    const initMediaPipe = async () => {
      try {
        hands = new window.Hands({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
          },
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.6, // Higher confidence to reduce jitter
          minTrackingConfidence: 0.6,
        });

        hands.onResults(onResults);

        if (typeof window.Camera === 'undefined') {
          setDebugMsg("Error: MediaPipe Camera Utils missing.");
          return;
        }

        camera = new window.Camera(videoElement, {
          onFrame: async () => {
            if (videoElement.readyState >= 2) {
              await hands.send({ image: videoElement });
            }
          },
          width: 1280,
          height: 720,
        });

        await camera.start();
        setDebugMsg("Camera Active. Show hand.");
      } catch (err) {
        console.error(err);
        setDebugMsg("Camera Error. Please allow permissions.");
      }
    };

    initMediaPipe();

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (camera) camera.stop();
      if (hands) hands.close();
      window.removeEventListener('resize', handleResize);
    };
  }, [onResults]);


  return (
    <div className="relative w-full h-full bg-gray-900 overflow-hidden">
      {/* Hidden Source Video (Logic only) */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        muted
      />
      
      {/* Main Rendering Canvas (Video + Ink + Particles) */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full block"
      />

      {/* React UI Layer */}
      <MenuLayer
        isOpen={isMenuOpen}
        currentTool={currentTool}
        currentColor={currentColor}
        currentSize={currentSize}
        onSelectTool={(t) => setCurrentTool(t)}
        onSelectColor={(c) => setCurrentColor(c)}
        onSelectSize={(s) => setCurrentSize(s)}
        cursorPos={cursorPos}
      />

      {/* Instructions / Status */}
      <div className="absolute top-4 left-4 p-4 rounded-xl bg-black/40 backdrop-blur-sm text-white/70 text-sm pointer-events-none select-none z-40 border border-white/10">
        <p className="font-bold text-white mb-1">{debugMsg}</p>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
            <span><b>Open Palm</b>: Toggle Menu</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
            <span><b>Pinch (Index+Thumb)</b>: Draw</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400"></span>
            <span><b>Peace Sign</b>: Dissolve Ink</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-400"></span>
            <span><b>Two Hands</b>: Zoom & Pan</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;