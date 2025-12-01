import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MenuLayer } from './components/MenuLayer';
import { Tool, Stroke, Point, HandGesture, HandLandmark, Results, Particle } from './types';
import { distance, lerpPoint, isOpenPalm, isVictorySign, isPointing } from './utils/geometry';

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
  
  // Logic State
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const canvasTransformRef = useRef({ x: 0, y: 0, scale: 1 });
  
  // Input Smoothing & Logic
  const lastPointRef = useRef<Point | null>(null);
  const gestureBufferRef = useRef<HandGesture[]>([]); // Buffer for debouncing
  const currentStableGestureRef = useRef<HandGesture>(HandGesture.NONE);
  const menuHoldProgressRef = useRef<number>(0); // 0 to 1
  
  // Pinch Logic
  const isPinchingRef = useRef<boolean>(false);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPinchCenterRef = useRef<Point | null>(null);

  // --- React State (UI Overlay only) ---
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [currentTool, setCurrentTool] = useState<Tool>(Tool.PEN);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  const [currentSize, setCurrentSize] = useState(6);
  const [cursorPos, setCursorPos] = useState<Point | null>(null); 
  const [debugMsg, setDebugMsg] = useState("Initializing Camera...");

  // --- Helpers ---
  
  const toCanvasPoint = (landmark: HandLandmark): Point => {
    // 1. Get raw screen coordinates (Mirrored X)
    const screenX = (1 - landmark.x) * window.innerWidth;
    const screenY = landmark.y * window.innerHeight;

    // 2. Inverse Transform to get World Space
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

  /**
   * Smooths the input point based on speed.
   * Fast movement = Low smoothing (Responsive).
   * Slow movement = High smoothing (Stable).
   */
  const smoothPoint = (current: Point, last: Point | null): Point => {
    if (!last) return current;
    const d = Math.sqrt(Math.pow(current.x - last.x, 2) + Math.pow(current.y - last.y, 2));
    
    // Dynamic alpha: If distance is large (fast), alpha is close to 1 (raw).
    // If distance is small (slow), alpha is small (smooth).
    // Thresholds: 2px (very slow) to 20px (fast)
    const minAlpha = 0.15;
    const maxAlpha = 0.8;
    const alpha = Math.min(maxAlpha, Math.max(minAlpha, d / 20));
    
    return lerpPoint(last, current, alpha);
  };

  // --- Main Loop ---
  const onResults = useCallback((results: Results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (canvas && video) {
      // 1. Resize Canvas if needed
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 2. Render Background (Video)
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(-1, 1); // Mirror
      ctx.translate(-canvas.width, 0);

      // Robust video drawing
      if (results.image) {
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      } else if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        // Fallback if video isn't ready
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();

      // --- 3. Gesture Recognition Logic ---
      let rawGesture = HandGesture.NONE;
      let primaryHand = null;
      let secondaryHand = null;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        primaryHand = results.multiHandLandmarks[0];
        if (results.multiHandLandmarks.length > 1) {
          secondaryHand = results.multiHandLandmarks[1];
        }

        const pinchDist = distance(primaryHand[8], primaryHand[4]);

        // Priority Chain
        if (secondaryHand && isPointing(primaryHand) && isPointing(secondaryHand)) {
          // Both hands pointing -> Zoom
           rawGesture = HandGesture.TWO_FINGER_ZOOM;
        } else if (isOpenPalm(primaryHand)) {
          rawGesture = HandGesture.OPEN_PALM;
        } else if (isVictorySign(primaryHand)) {
          rawGesture = HandGesture.PEACE_CLEAR;
        } else if (isPointing(primaryHand) && pinchDist > 0.1) {
          // Explicit pointing for menu selection
          rawGesture = HandGesture.POINTING;
        } else {
          // Hysteresis for Pinch (Drawing)
          // Enter pinch at < 0.035
          // Exit pinch at > 0.065
          if (isPinchingRef.current) {
            if (pinchDist < 0.065) rawGesture = HandGesture.PINCH_DRAW;
            else rawGesture = HandGesture.NONE;
          } else {
            if (pinchDist < 0.035) rawGesture = HandGesture.PINCH_DRAW;
            else rawGesture = HandGesture.NONE;
          }
        }
      }

      // --- 4. Debouncing / Stabilization ---
      // Add new gesture to buffer
      const buffer = gestureBufferRef.current;
      buffer.push(rawGesture);
      if (buffer.length > 6) buffer.shift(); // Keep last 6 frames

      // Find majority gesture
      const counts: Record<string, number> = {};
      buffer.forEach(g => counts[g] = (counts[g] || 0) + 1);
      
      let majorityGesture = HandGesture.NONE;
      let maxCount = 0;
      for (const g in counts) {
        if (counts[g] > maxCount) {
          maxCount = counts[g];
          majorityGesture = g as HandGesture;
        }
      }

      // Determine Stable Gesture (Require > 3/6 confidence)
      const isStable = maxCount > 3;
      // Special case: Pinch state needs immediate feedback to prevent laggy start
      // So if rawGesture is Pinch, we might favor it slightly faster, 
      // but for Mode Switching (Menu), we want stability.
      
      if (isStable) {
        currentStableGestureRef.current = majorityGesture;
      }

      // Is Pinching State Update
      isPinchingRef.current = (currentStableGestureRef.current === HandGesture.PINCH_DRAW);

      const activeGesture = currentStableGestureRef.current;

      // --- 5. Application Logic ---

      // GLOBAL: Menu Toggle Logic
      // Requirement: "Detect whole palm pops up UI... detect whole palm to exit"
      if (activeGesture === HandGesture.OPEN_PALM) {
        menuHoldProgressRef.current = Math.min(menuHoldProgressRef.current + 0.05, 1);
        
        // Draw Progress Circle around hand
        if (primaryHand) {
           const center = toScreenPoint(primaryHand[9]); // Middle finger MCP is roughly center
           ctx.beginPath();
           ctx.arc(center.x, center.y, 40, 0, Math.PI * 2 * menuHoldProgressRef.current);
           ctx.strokeStyle = isMenuOpen ? '#ef4444' : '#22c55e'; // Red to close, Green to open
           ctx.lineWidth = 5;
           ctx.stroke();
        }

        if (menuHoldProgressRef.current >= 1) {
           // Toggle
           setIsMenuOpen(prev => !prev);
           menuHoldProgressRef.current = 0; // Reset
           gestureBufferRef.current = []; // Clear buffer to prevent rapid toggle
        }
      } else {
        menuHoldProgressRef.current = Math.max(menuHoldProgressRef.current - 0.05, 0);
      }

      // MODE SPECIFIC
      if (isMenuOpen) {
        // --- MENU MODE ---
        // Only allow Pointing
        if (activeGesture === HandGesture.POINTING && primaryHand) {
          const rawPoint = { x: 1 - primaryHand[8].x, y: primaryHand[8].y };
          // Smooth the cursor for menu too
          setCursorPos(prev => {
             const px = prev ? prev.x : rawPoint.x;
             const py = prev ? prev.y : rawPoint.y;
             return {
               x: px + (rawPoint.x - px) * 0.3, 
               y: py + (rawPoint.y - py) * 0.3
             };
          });
        } else {
          setCursorPos(null);
        }
        
      } else {
        // --- CANVAS MODE ---
        setCursorPos(null); // Hide system cursor

        // 1. ZOOMING
        if (activeGesture === HandGesture.TWO_FINGER_ZOOM && primaryHand && secondaryHand) {
          const p1 = toScreenPoint(primaryHand[8]);
          const p2 = toScreenPoint(secondaryHand[8]);
          const currentDist = distance(p1, p2);
          const centerX = (p1.x + p2.x) / 2;
          const centerY = (p1.y + p2.y) / 2;

          if (lastPinchDistRef.current !== null && lastPinchCenterRef.current !== null) {
             const deltaScale = currentDist / lastPinchDistRef.current;
             const prev = canvasTransformRef.current;
             const newScale = Math.min(Math.max(prev.scale * deltaScale, 0.5), 5);
             const newX = centerX - (centerX - prev.x) * (newScale / prev.scale);
             const newY = centerY - (centerY - prev.y) * (newScale / prev.scale);

             canvasTransformRef.current = { x: newX, y: newY, scale: newScale };
          }
          lastPinchDistRef.current = currentDist;
          lastPinchCenterRef.current = { x: centerX, y: centerY };
          currentStrokeRef.current = null; // Cancel drawing if zooming
        } else {
          lastPinchDistRef.current = null;
        }

        // 2. CLEARING (Snow)
        if (activeGesture === HandGesture.PEACE_CLEAR && strokesRef.current.length > 0) {
           // Create explosion effect
           strokesRef.current.forEach(s => {
             // Sample points to reduce particle count
             for (let i = 0; i < s.points.length; i += 2) {
               const p = s.points[i];
               particlesRef.current.push({
                 x: p.x,
                 y: p.y,
                 vx: (Math.random() - 0.5) * 4,
                 vy: (Math.random() * -3) - 1,
                 color: s.color,
                 size: Math.random() * s.size * 0.8,
                 life: 1.0 + Math.random()
               });
             }
           });
           strokesRef.current = []; // Clear ink
        }

        // 3. DRAWING
        if (activeGesture === HandGesture.PINCH_DRAW && primaryHand) {
          const rawTarget = toCanvasPoint(primaryHand[8]); // Index tip is the pen
          
          // Apply Dynamic Smoothing
          const point = smoothPoint(rawTarget, lastPointRef.current);
          lastPointRef.current = point;

          if (!currentStrokeRef.current) {
             // Start Stroke
             currentStrokeRef.current = {
               points: [point],
               color: currentTool === Tool.ERASER ? '#000000' : currentColor,
               size: currentSize,
               isEraser: currentTool === Tool.ERASER
             };
          } else {
             // Continue Stroke
             const pts = currentStrokeRef.current.points;
             const lastP = pts[pts.length - 1];
             if (distance(lastP, point) > 2) { // Minimum distance
               pts.push(point);
             }
          }
        } else {
          // Stop Drawing
          if (currentStrokeRef.current) {
            strokesRef.current.push(currentStrokeRef.current);
            currentStrokeRef.current = null;
          }
          lastPointRef.current = null; // Reset smoothing anchor
        }
      }

      // --- 6. Render Canvas Elements ---
      const t = canvasTransformRef.current;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw Ink
      const drawStroke = (s: Stroke) => {
        if (s.points.length < 2) return;
        ctx.beginPath();
        ctx.lineWidth = s.size;
        ctx.strokeStyle = s.color;
        ctx.globalCompositeOperation = s.isEraser ? 'destination-out' : 'source-over';
        
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

      strokesRef.current.forEach(drawStroke);
      if (currentStrokeRef.current) drawStroke(currentStrokeRef.current);

      // Draw Particles
      if (particlesRef.current.length > 0) {
        ctx.globalCompositeOperation = 'source-over';
        particlesRef.current.forEach(p => {
          ctx.beginPath();
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
          
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.2; // Gravity
          p.vx *= 0.95; // Drag
          p.life -= 0.02; 
          p.size *= 0.98;
        });
        ctx.globalAlpha = 1.0;
        particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      }

      ctx.restore();

      // Debug Text
      if (!isMenuOpen) {
        setDebugMsg(`Gesture: ${activeGesture.replace('_', ' ')}`);
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
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7, // Higher confidence to reduce ghosting
          minTrackingConfidence: 0.7,
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
        setDebugMsg("Camera Active");
      } catch (err) {
        console.error(err);
        setDebugMsg("Camera access needed.");
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
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full block" />

      <MenuLayer
        isOpen={isMenuOpen}
        currentTool={currentTool}
        currentColor={currentColor}
        currentSize={currentSize}
        onSelectTool={setCurrentTool}
        onSelectColor={setCurrentColor}
        onSelectSize={setCurrentSize}
        cursorPos={cursorPos}
      />

      <div className="absolute top-4 left-4 p-4 rounded-xl bg-black/50 backdrop-blur-sm text-white/80 pointer-events-none select-none z-40 border border-white/10 shadow-xl">
        <p className="font-bold text-white mb-2 text-lg">{debugMsg}</p>
        <div className="space-y-2 text-xs opacity-90">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span><b>Hold Open Palm</b>: Toggle Menu</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            <span><b>Pinch (Index+Thumb)</b>: Draw</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            <span><b>Peace Sign (✌️)</b>: Dissolve Art</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
