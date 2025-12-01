import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Pen } from 'lucide-react';
import { Tool, Point } from '../types';

interface MenuLayerProps {
  isOpen: boolean;
  currentTool: Tool;
  currentColor: string;
  currentSize: number;
  onSelectTool: (tool: Tool) => void;
  onSelectColor: (color: string) => void;
  onSelectSize: (size: number) => void;
  cursorPos: Point | null; // Normalized 0-1 (Screen Space)
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#000000'];
const SIZES = [2, 6, 12, 24];

export const MenuLayer: React.FC<MenuLayerProps> = ({
  isOpen,
  currentTool,
  currentColor,
  currentSize,
  onSelectTool,
  onSelectColor,
  onSelectSize,
  cursorPos,
}) => {
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  
  // Convert normalized cursor to screen pixels
  const screenCursor = cursorPos ? {
    x: cursorPos.x * window.innerWidth,
    y: cursorPos.y * window.innerHeight
  } : null;

  // Interaction logic: Dwell to click
  useEffect(() => {
    if (!isOpen || !screenCursor) {
      setHoverTarget(null);
      setProgress(0);
      return;
    }

    const elements = document.querySelectorAll('[data-interactable]');
    let found = false;

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (
        screenCursor.x >= rect.left &&
        screenCursor.x <= rect.right &&
        screenCursor.y >= rect.top &&
        screenCursor.y <= rect.bottom
      ) {
        const id = el.getAttribute('data-id');
        if (id) {
          found = true;
          if (hoverTarget !== id) {
            setHoverTarget(id);
            setProgress(0);
          } else {
            // Increment progress
            setProgress((prev) => {
              const next = prev + 4; // Faster selection
              if (next >= 100) {
                // Trigger click
                handleInteraction(id);
                return 0;
              }
              return next;
            });
          }
        }
      }
    });

    if (!found) {
      setHoverTarget(null);
      setProgress(0);
    }
  }, [screenCursor, isOpen, hoverTarget]);

  const handleInteraction = (id: string) => {
    if (id === 'tool-pen') onSelectTool(Tool.PEN);
    else if (id === 'tool-eraser') onSelectTool(Tool.ERASER);
    else if (id.startsWith('color-')) onSelectColor(id.replace('color-', ''));
    else if (id.startsWith('size-')) onSelectSize(parseInt(id.replace('size-', '')));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md transition-opacity duration-300">
      <div className="bg-white/95 p-8 rounded-3xl shadow-2xl w-[90%] max-w-2xl flex flex-col gap-8 relative border border-white/50 animate-in fade-in zoom-in duration-300">
        
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800">Toolbox</h2>
          <p className="text-gray-500 text-sm">Hover index finger to select</p>
        </div>

        {/* Tools */}
        <div className="flex justify-center gap-8">
          <div
            data-interactable
            data-id="tool-pen"
            className={`p-6 rounded-2xl transition-all duration-200 transform ${currentTool === Tool.PEN ? 'bg-blue-100 ring-4 ring-blue-500 scale-105' : 'bg-gray-100'}`}
          >
            <Pen size={48} className={currentTool === Tool.PEN ? 'text-blue-600' : 'text-gray-600'} />
            <span className="block text-center mt-2 font-semibold">Pen</span>
          </div>
          <div
            data-interactable
            data-id="tool-eraser"
            className={`p-6 rounded-2xl transition-all duration-200 transform ${currentTool === Tool.ERASER ? 'bg-red-100 ring-4 ring-red-500 scale-105' : 'bg-gray-100'}`}
          >
            <Eraser size={48} className={currentTool === Tool.ERASER ? 'text-red-600' : 'text-gray-600'} />
            <span className="block text-center mt-2 font-semibold">Eraser</span>
          </div>
        </div>

        {/* Colors */}
        <div className="space-y-2">
          <h3 className="text-gray-600 font-medium ml-1">Color</h3>
          <div className="flex flex-wrap justify-center gap-4">
            {COLORS.map((c) => (
              <div
                key={c}
                data-interactable
                data-id={`color-${c}`}
                className={`w-12 h-12 rounded-full shadow-sm border-4 transition-transform ${currentColor === c ? 'scale-125 border-gray-800' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Sizes */}
        <div className="space-y-2">
          <h3 className="text-gray-600 font-medium ml-1">Size</h3>
          <div className="flex items-center justify-center gap-6 bg-gray-100 p-4 rounded-xl">
            {SIZES.map((s) => (
              <div
                key={s}
                data-interactable
                data-id={`size-${s}`}
                className={`rounded-full bg-gray-800 transition-opacity ${currentSize === s ? 'opacity-100 ring-2 ring-offset-2 ring-gray-800' : 'opacity-40'}`}
                style={{ width: s * 2, height: s * 2 }}
              />
            ))}
          </div>
        </div>
        
        {/* Instruction Footer */}
        <div className="absolute -bottom-20 w-full text-center text-white/90 font-medium bg-black/50 p-2 rounded-lg backdrop-blur-sm">
          Show <span className="font-bold text-yellow-400">Open Palm</span> to Close
        </div>
      </div>

      {/* Virtual Cursor */}
      {screenCursor && (
        <div
          className="fixed pointer-events-none z-[60]"
          style={{
            left: screenCursor.x,
            top: screenCursor.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="relative">
            {/* Cursor Dot */}
            <div className={`w-6 h-6 rounded-full shadow-lg border-2 border-white transition-colors duration-200 ${progress > 0 ? 'bg-blue-500 scale-125' : 'bg-red-500'}`} />
            
            {/* Loading Ring */}
            {progress > 0 && (
              <svg className="absolute top-[-22px] left-[-22px] w-[50px] h-[50px] rotate-[-90deg]">
                <circle
                  cx="25"
                  cy="25"
                  r="20"
                  stroke="white"
                  strokeWidth="4"
                  fill="transparent"
                  className="opacity-30"
                />
                <circle
                  cx="25"
                  cy="25"
                  r="20"
                  stroke={currentTool === Tool.ERASER ? '#ef4444' : '#3b82f6'}
                  strokeWidth="4"
                  fill="transparent"
                  strokeDasharray="125.6"
                  strokeDashoffset={125.6 - (125.6 * progress) / 100}
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  );
};